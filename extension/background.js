import { inspectPage } from "./probe.js";
import { publicPage, sourceFrom } from "./core/source.js";
import { joinCues, parseCaptions } from "./core/transcript.js";

function collect(frames, tab) {
  const top = frames.find(frame => frame.frameId === 0)?.result;
  const title = (top?.title || tab.title || "Video transcript").slice(0, 250);
  const page = publicPage(tab.url);
  const candidates = new Map();
  const topSource = sourceFrom(tab.url);
  if (topSource) candidates.set(topSource.key, { ...topSource, title, source: page });
  let fallback = topSource ? { key: "tab", provider: "Tab audio", title, source: page } : null;
  const needsLessonTitle = /(?:^|\.)skool\.com$/.test(new URL(tab.url).hostname);
  const encoder = new TextEncoder();
  let captionBudget = 3_500_000;
  for (const { frameId, result } of frames) {
    if (!result) continue;
    const muxKeys = new Set();
    for (const item of result.items ?? []) {
      const found = sourceFrom(item.url);
      if (!found) continue;
      if (found.provider === "Skool" && !needsLessonTitle) continue;
      if (found.provider === "Skool") muxKeys.add(found.key);
      const name = item.title && !/^(?:video|wistia|vimeo|youtube video player|loom)$/i.test(item.title)
        ? item.title : "";
      const existing = candidates.get(found.key);
      if (!existing || (!existing.url.includes("?") && found.url.includes("?"))) {
        candidates.set(found.key, { ...existing, ...found, title: name || existing?.title || title, source: page });
      } else if (existing.title === title && name && frameId !== 0) {
        existing.title = name;
      }
    }
    for (const [index, caption] of (result.captions ?? []).entries()) {
      const text = caption.raw ? parseCaptions(caption.raw, caption.format) : joinCues(caption.cues ?? []);
      if (!text || text.length > 550_000) continue;
      captionBudget -= encoder.encode(text).length;
      if (captionBudget < 0) break;
      const matched = sourceFrom(caption.media)?.key ?? sourceFrom(result.url)?.key
        ?? (frameId === 0 && muxKeys.size === 1 && result.captions.length === 1 ? [...muxKeys][0] : null);
      const candidate = matched ? candidates.get(matched) : undefined;
      if (candidate && (!candidate.text || /^en(?:g$|[-_]|$)/i.test(caption.language ?? ""))) {
        Object.assign(candidate, { text, language: caption.language });
      } else if (!matched) {
        const key = "page:" + frameId + ":" + index;
        candidates.set(key, { key, provider: "On-page captions", title, source: page, text, language: caption.language });
      }
    }
    if (result.playable) fallback ??= { key: "tab", provider: "Tab audio", title, source: page };
  }
  return { title, page, preferPageTitle: needsLessonTitle, candidates: [...candidates.values()].slice(0, 12), fallback };
}

const HOST = "com.userfirstdigital.video_transcript";
const active = new Map();
const queues = new Map();
const tabKey = (tabId) => "tab:" + tabId;
const ttl = 30 * 60 * 1000;

function inOrder(key, action) {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
  queues.set(key, next);
  const release = () => { if (queues.get(key) === next) queues.delete(key); };
  next.then(release, release);
  return next;
}

async function save(key, state) {
  await chrome.storage.session.set({ [key]: { ...state, expires: Date.now() + ttl } });
}

async function prune(key, reservedBytes) {
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter(k => k !== key && !active.has(k) && !queues.has(k));
  keys.sort((a, b) => all[a].expires - all[b].expires);
  let used = await chrome.storage.session.getBytesInUse(null) - await chrome.storage.session.getBytesInUse(key);
  for (const oldKey of keys) {
    if (all[oldKey].expires >= Date.now() && used + reservedBytes <= 9_000_000) break;
    used -= await chrome.storage.session.getBytesInUse(oldKey);
    await chrome.storage.session.remove(oldKey);
  }
}

async function scan(tab, key, previous) {
  if (previous && previous.url === tab.url && (active.has(key) || (previous.candidates?.length && previous.expires > Date.now()))) {
    if (previous.progress && !active.has(key)) {
      await save(key, { ...previous, progress: "", error: "The local helper stopped. Try again." });
    }
    return;
  }
  stop(key);
  const revision = crypto.randomUUID();
  const url = tab.url ?? "";
  if (!/^https?:/.test(url)) {
    await save(key, { url, revision, candidates: [] });
    return;
  }
  const inject = (target) => chrome.scripting.executeScript({ target, world: "MAIN", func: inspectPage });
  const frames = await inject({ tabId: tab.id, allFrames: true })
    .catch(() => inject({ tabId: tab.id }).catch(() => []));
  const current = await chrome.tabs.get(tab.id);
  if (current.url !== url || (frames.find(frame => frame.frameId === 0)?.result?.url ?? url) !== url) {
    await chrome.storage.session.remove(key);
    throw new Error("The tab changed while scanning. Reopen the popup to scan the current video.");
  }
  const state = { ...collect(frames, tab), url, revision };
  await prune(key, new TextEncoder().encode(JSON.stringify(state)).length + 1_100_000);
  await save(key, state);
}

function stop(key) {
  const port = active.get(key);
  active.delete(key);
  port?.disconnect();
}

async function run(key, state, candidate) {
  if (active.has(key)) return;
  const next = { ...state, result: null, error: "", status: "", selected: candidate.key };
  const finish = (result) => ({
    ...next,
    progress: "",
    result: {
      ...result,
      title: state.preferPageTitle ? state.title : result.title || candidate.title,
      source: candidate.source,
    },
  });
  if (candidate.text) {
    await save(key, finish({ text: candidate.text, language: candidate.language, method: "Existing captions" }));
    return;
  }

  await save(key, { ...next, progress: "Starting the local helper…" });
  const port = chrome.runtime.connectNative(HOST);
  active.set(key, port);
  function update(state, done = false) {
    void inOrder(key, async () => {
      if (active.get(key) !== port) return;
      if (done) stop(key);
      await save(key, state);
    }).catch(() => stop(key));
  }
  port.onMessage.addListener(message => {
    if (message.type === "progress") update({ ...next, progress: message.message });
    if (message.type === "result") update(finish(message.result), true);
    if (message.type === "error") update({ ...next, error: message.error, progress: "" }, true);
  });
  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message ?? "";
    const error = /not found|access|forbidden|failed to start/i.test(reason)
      ? "Chrome could not start the local helper. See the README for setup."
      : "The local helper stopped before finishing. Try again.";
    update({ ...next, error, progress: "" }, true);
  });
  try {
    port.postMessage({ type: "run", url: candidate.url, source: candidate.source });
  } catch {
    stop(key);
    await save(key, { ...next, error: "Chrome could not start the local helper.", progress: "" });
  }
}

async function handle(message, key) {
  const state = (await chrome.storage.session.get(key))[key];
  if (message.type === "cancel" && state?.revision === message.revision && active.has(key)) {
    stop(key);
    await save(key, { ...state, progress: "", status: "Canceled." });
    return;
  }
  const tab = await chrome.tabs.get(message.tabId);
  if (message.type === "scan") {
    await scan(tab, key, state);
    return;
  }
  if (!state || state.revision !== message.revision || state.url !== tab.url) {
    throw new Error("The tab changed. Reopen the popup to scan the current video.");
  }
  if (message.type === "run") {
    const candidate = state.candidates.find(item => item.key === message.candidate);
    if (candidate) await run(key, state, candidate);
  }
  if (message.type === "record" && state.fallback && !active.has(key)) {
    const id = crypto.randomUUID();
    await save(id, { title: state.title, candidates: [], fallback: state.fallback, recording: true });
    await chrome.tabs.create({ url: chrome.runtime.getURL("job.html") + "?id=" + id, index: tab.index + 1 });
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.url !== chrome.runtime.getURL("job.html") || !Number.isInteger(message?.tabId)) return;
  if (!["scan", "run", "cancel", "record"].includes(message.type)) return;
  const key = tabKey(message.tabId);
  inOrder(key, () => handle(message, key)).then(
    () => reply({ ok: true }),
    error => reply({ error: error.message || "Could not complete the request. Try again." }),
  );
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  const key = tabKey(tabId);
  void inOrder(key, async () => {
    stop(key);
    await chrome.storage.session.remove(key);
  }).catch(() => {});
});
