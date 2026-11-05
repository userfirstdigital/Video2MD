import { filename, markdown } from "./core/transcript.js";

const HOST = "com.userfirstdigital.video_transcript";
const id = new URLSearchParams(location.search).get("id");
const el = Object.fromEntries([...document.querySelectorAll("[id]")].map(node => [node.id, node]));
let job;
let output;
let active;
let busy = false;
let tabId;
const popup = !id;
if (popup) document.body.classList.add("popup");

function status(message = "") { el.status.textContent = message; }
function error(message = "") {
  el.error.hidden = !message;
  el.error.textContent = message;
}
function update() {
  el.run.hidden = !job?.candidates.length;
  el.record.hidden = !job?.fallback;
  el.hint.hidden = !job?.fallback || busy || Boolean(popup && job.candidates.length && !job.error);
  el.cancel.hidden = popup ? !job?.progress : !active;
  el.stop.hidden = active?.recorder?.state !== "recording";
  el.run.disabled = el.record.disabled = el.videos.disabled = busy;
}
function load(data) {
  if (!data || data.expires < Date.now()) {
    status("");
    error("This scan expired. Reopen the extension on the video tab.");
    return;
  }
  const previousSelection = job?.revision === data.revision ? el.videos.value : "";
  job = data;
  el.page.hidden = !job.title;
  el.page.textContent = job.title ?? "";
  el.page.title = job.title ?? "";
  el.videos.replaceChildren(...job.candidates.map(candidate => {
    const option = document.createElement("option");
    option.value = candidate.key;
    option.textContent = candidate.provider + " — " + candidate.title;
    return option;
  }));
  const selection = previousSelection || job.selected;
  if (job.candidates.some(candidate => candidate.key === selection)) el.videos.value = selection;
  el.choice.hidden = job.candidates.length < 2;
  if (popup) busy = Boolean(job.progress);
  update();
  error(job.error);
  if (job.result) {
    finish(job.result, job.result);
    return;
  }
  el.output.hidden = true;
  status(job.progress || job.status || (job.error ? "" : job.candidates.length ? "Ready to check for captions."
    : job.recording ? "Share the video tab to record its audio." : job.fallback ? "No caption source detected."
    : "Play a video on this tab, then reopen the extension."));
}
function finish(candidate, result) {
  const title = job?.preferPageTitle ? job.title : result.title || candidate.title;
  output = { title, markdown: markdown({ title, source: candidate.source, text: result.text }) };
  resetCopyFeedback();
  el.preview.textContent = result.text;
  el.method.textContent = result.method + (result.language ? " · " + result.language : "");
  el.output.hidden = false;
  status("Transcript ready.");
}
function resetTask() {
  const task = active;
  active = undefined;
  busy = false;
  if (task) {
    clearTimeout(task.timer);
    if (task.recorder?.state === "recording") task.recorder.stop();
    task.stream?.getTracks().forEach(track => track.stop());
    task.port?.disconnect();
  }
  update();
}
function fail(message) {
  resetTask();
  status("");
  error(message);
}
function connect(task, message, onReady) {
  const port = chrome.runtime.connectNative(HOST);
  task.port = port;
  port.onMessage.addListener(response => {
    if (active !== task) return;
    switch (response.type) {
      case "progress": status(response.message); break;
      case "ready":
        onReady?.().catch(() => fail("Chrome could not start recording tab audio."));
        break;
      case "result":
        resetTask();
        finish(task.candidate, response.result);
        break;
      case "error": fail(response.error); break;
    }
  });
  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message ?? "";
    if (active !== task) return;
    fail(/not found|access|forbidden|failed to start/i.test(reason)
      ? "Chrome could not start the local helper. Register it with your extension ID using the README."
      : "The local helper stopped before finishing. Try again.");
  });
  port.postMessage(message);
}

async function request(type, candidate) {
  error();
  try {
    const reply = await chrome.runtime.sendMessage({ type, tabId, candidate, revision: job?.revision });
    if (reply?.error) throw new Error(reply.error);
  } catch (cause) {
    error(cause.message || "Could not reach the extension. Reopen the popup and try again.");
  }
}

el.run.addEventListener("click", async () => {
  if (!popup || busy || !el.videos.value) return;
  busy = true;
  update();
  await request("run", el.videos.value);
  busy = Boolean(job?.progress);
  update();
});

function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

el.record.addEventListener("click", async () => {
  if (busy || !job?.fallback) return;
  if (popup) {
    await request("record");
    return;
  }
  error();
  busy = true;
  const task = active = { candidate: job.fallback };
  update();
  status("Choose the video tab and share its audio.");
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser" }, audio: { suppressLocalAudioPlayback: false },
      selfBrowserSurface: "exclude", surfaceSwitching: "exclude", monitorTypeSurfaces: "exclude",
      systemAudio: "exclude", windowAudio: "exclude",
    });
    if (active !== task) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    task.stream = stream;
    if (stream.getVideoTracks()[0]?.getSettings().displaySurface !== "browser" || !stream.getAudioTracks().length) {
      fail("Choose a Chrome tab and turn on Also share tab audio.");
      return;
    }
    connect(task, { type: "record-start" }, async () => {
      const recorder = task.recorder = new MediaRecorder(new MediaStream(stream.getAudioTracks()), {
        mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 64_000,
      });
      let queue = Promise.resolve();
      recorder.addEventListener("error", () => { if (active === task) fail("Chrome could not record this tab’s audio."); });
      recorder.addEventListener("dataavailable", event => {
        queue = queue.then(async () => {
          if (!event.data.size || active !== task) return;
          const bytes = new Uint8Array(await event.data.arrayBuffer());
          if (active !== task) return;
          for (let i = 0; i < bytes.length; i += 180_000) {
            task.port.postMessage({ type: "record-chunk", data: base64(bytes.subarray(i, i + 180_000)) });
          }
        }).catch(() => { if (active === task) fail("Could not send audio to the local helper."); });
      });
      recorder.addEventListener("stop", async () => {
        clearTimeout(task.timer);
        stream.getTracks().forEach(track => track.stop());
        await queue;
        if (active !== task) return;
        status("Finishing the recording…");
        update();
        try { task.port.postMessage({ type: "record-finish" }); }
        catch { fail("Could not send audio to the local helper."); }
      });
      const stop = () => { if (recorder.state === "recording") recorder.stop(); };
      stream.getTracks().forEach(track => track.addEventListener("ended", stop, { once: true }));
      task.timer = setTimeout(stop, 2 * 60 * 60_000);
      recorder.start(1000);
      status("Recording tab audio. Play the video, then stop when it ends.");
      update();
    });
  } catch {
    if (active === task) fail("Tab audio wasn’t shared. Try again and choose the tab playing the video.");
  }
});
el.stop.addEventListener("click", () => {
  if (active?.recorder?.state === "recording") {
    active.recorder.stop();
    update();
  }
});
el.cancel.addEventListener("click", () => {
  if (popup) {
    void request("cancel");
    return;
  }
  resetTask();
  status("Canceled.");
});
function resetCopyFeedback() {
  el.copy.removeAttribute("data-copied");
  el["copy-status"].textContent = "";
  el["copy-status"].removeAttribute("data-error");
}

el.copy.addEventListener("click", async () => {
  const current = output;
  if (!current) return;
  const feedback = el["copy-status"];
  resetCopyFeedback();
  try {
    await navigator.clipboard.writeText(current.markdown);
    if (output !== current) return;
    el.copy.setAttribute("data-copied", "");
    feedback.textContent = "Markdown copied.";
  } catch {
    if (output !== current) return;
    feedback.setAttribute("data-error", "");
    feedback.textContent = "Couldn’t copy Markdown. Try again or use Download.";
  }
});
el.download.addEventListener("click", () => {
  if (!output) return;
  const url = URL.createObjectURL(new Blob([output.markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename(output.title);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});
if (popup) {
  el.hint.textContent = "If the video can only play in Chrome, record its tab audio in a separate recording tab.";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    status("");
    error("Open a video tab to get its transcript.");
  } else {
    tabId = tab.id;
    const key = "tab:" + tabId;
    const stored = await chrome.runtime.sendMessage({ type: "scan", tabId }).catch(() => null);
    if (stored?.ok) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "session" && changes[key]?.newValue) load(changes[key].newValue);
      });
      load((await chrome.storage.session.get(key))[key]);
    } else {
      status("");
      error(stored?.error || "Could not scan this tab. Reopen the popup to try again.");
    }
  }
} else if (/^[\da-f-]{36}$/.test(id)) {
  load((await chrome.storage.session.get(id))[id]);
} else load(null);
