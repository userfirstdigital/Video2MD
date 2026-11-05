// Chrome serializes this function into the current document. Keep it self-contained.
export async function inspectPage() {
  const out = { url: location.href, title: document.title.slice(0, 250), items: [], playable: false };
  const add = (url, title) => {
    if (typeof url !== "string" || url.length > 8192 || out.items.length >= 30) return;
    try { out.items.push({ url: new URL(url, location.href).href, title: title?.slice(0, 250) }); } catch {}
  };
  const wistia = (id, title) => {
    if (/^[a-z0-9]{10}$/.test(id ?? "")) add("https://fast.wistia.net/embed/iframe/" + id, title);
  };
  const readText = async (url, limit = 512_000) => {
    try {
      const result = await fetch(url, { signal: AbortSignal.timeout(3500), credentials: "same-origin" });
      if (!result.ok || !result.body) return "";
      const reader = result.body.getReader();
      const decoder = new TextDecoder();
      let text = "", size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return text + decoder.decode();
          size += value.byteLength;
          if (size > limit) return "";
          text += decoder.decode(value, { stream: true });
        }
      } finally { await reader.cancel().catch(() => {}); }
    } catch { return ""; }
  };
  const tracksFor = (video) => [...video.textTracks].filter(t => ["captions", "subtitles"].includes(t.kind))
    .map(t => ({ language: t.language, cues: Array.from(t.cues ?? [], c => c.text).slice(0, 12_000) }))
    .filter(t => t.cues.length).slice(0, 4);
  const rank = (language) => /^en(?:g$|[-_]|$)/i.test(language ?? "") ? 0 : 1;
  const pageCaptions = [];
  add(location.href, out.title);

  for (const frame of [...document.querySelectorAll("iframe[src], iframe[data-src]")].slice(0, 60)) {
    const value = frame.getAttribute("src") || frame.getAttribute("data-src");
    if (!/(?:youtube|youtu\.be|vimeo|loom|wistia|mux)/i.test(value)) continue;
    out.playable = true;
    add(value, frame.title);
  }
  const wistiaPlayers = [...document.querySelectorAll("wistia-player, [data-wistia-id], [data-wistiaid], [class*='wistia_async_']")].slice(0, 20);
  for (const element of wistiaPlayers) {
    const id = element.getAttribute("media-id") ?? element.getAttribute("data-wistia-id")
      ?? element.getAttribute("data-wistiaid") ?? element.className?.match?.(/\bwistia_async_([a-z0-9]{10})\b/)?.[1];
    wistia(id, element.title);
    const text = element.querySelector(".wistia_preload_transcript_text")?.textContent?.trim();
    if (text && /^[a-z0-9]{10}$/.test(id ?? "")) {
      pageCaptions.push({ media: "https://fast.wistia.net/embed/iframe/" + id, raw: text.slice(0, 512_000) });
    }
    out.playable = true;
  }
  for (const script of [...document.querySelectorAll("script[src*='wistia.'][src*='/embed/']")].slice(0, 20)) {
    wistia(script.src.match(/\/embed\/([a-z0-9]{10})\.js(?:[?#]|$)/)?.[1]);
  }

  const isSkool = /(?:^|\.)skool\.com$/.test(location.hostname) && /\/classroom\//.test(location.pathname);
  if (isSkool) {
    const lessonId = new URLSearchParams(location.search).get("md");
    const useLesson = (next, fetched = false) => {
      if (!next || next.length > 5_000_000) return false;
      try {
        const data = JSON.parse(next);
        const pp = data.props?.pageProps;
        const rd = pp?.renderData ?? pp;
        const lesson = rd?.module ?? rd?.lesson ?? pp?.module ?? pp?.lesson;
        const active = fetched || data.query?.md === lessonId || (lessonId && lesson?.id === lessonId) || (!lessonId && !data.query?.md);
        if (active) {
          const videos = [pp?.video, rd?.video, lesson?.video,
            ...(Array.isArray(pp?.videos) ? pp.videos.slice(0, 6) : []),
            ...(Array.isArray(rd?.videos) ? rd.videos.slice(0, 6) : [])];
          for (const video of videos) {
            const id = video?.playbackId;
            const token = video?.playbackToken;
            if (typeof id === "string" && /^[a-zA-Z\d_-]{6,200}$/.test(id)) {
              add("https://stream.mux.com/" + id + ".m3u8" + (typeof token === "string" ? "?token=" + encodeURIComponent(token) : ""));
            }
          }
          for (const link of [rd?.videoLink, pp?.videoLink, lesson?.videoLink, lesson?.metadata?.videoLink]) add(link);
          return true;
        }
      } catch {}
      return false;
    };
    if (!useLesson(document.querySelector("#__NEXT_DATA__")?.textContent) && /^[\w-]{1,100}$/.test(lessonId ?? "")) {
      const lessonPage = new URL(location.pathname, location.origin);
      lessonPage.searchParams.set("md", lessonId);
      const html = await readText(lessonPage.href, 5_000_000);
      if (html) {
        const next = new DOMParser().parseFromString(html, "text/html").querySelector("#__NEXT_DATA__")?.textContent;
        useLesson(next, true);
      }
    }
    out.playable = true;
  }

  const muxPlayers = [...document.querySelectorAll("mux-player")].slice(0, 12);
  const videos = [...document.querySelectorAll("video"), ...[...wistiaPlayers, ...muxPlayers]
    .flatMap(player => [...(player.shadowRoot?.querySelectorAll("video") ?? [])])].slice(0, 8);
  if (videos.length) out.playable = true;
  const htmlTracks = [];
  for (const video of videos) {
    const media = video.currentSrc || video.getAttribute("src");
    if (media) add(media, video.title);
    const host = video.getRootNode().host;
    const mux = video.closest("mux-player") ?? (host?.localName === "mux-player" ? host : null);
    const playback = mux?.getAttribute("playback-id");
    if (isSkool && /^[a-zA-Z\d_-]{6,200}$/.test(playback ?? "")) {
      const token = mux.getAttribute("playback-token");
      add("https://stream.mux.com/" + playback + ".m3u8" + (token ? "?token=" + encodeURIComponent(token) : ""));
    }
    const embedded = tracksFor(video);
    const files = [...video.querySelectorAll("track[kind='subtitles'], track[kind='captions']")]
      .filter(t => /^https?:/.test(t.src)).map(t => ({ url: t.src, language: t.srclang }));
    const wistiaId = host?.localName === "wistia-player" ? host.getAttribute("media-id") : null;
    const captionSource = /^[a-z0-9]{10}$/.test(wistiaId ?? "") ? "https://fast.wistia.net/embed/iframe/" + wistiaId
      : isSkool && /^[a-zA-Z\d_-]{6,200}$/.test(playback ?? "") ? "https://stream.mux.com/" + playback + ".m3u8" : media;
    htmlTracks.push({ media: captionSource, tracks: embedded, files });
  }
  if (isSkool && videos.some(video => !video.paused || video.currentTime > 0) &&
      !out.items.some(item => item.url.startsWith("https://stream.mux.com/"))) {
    const latest = performance.getEntriesByType("resource").slice(-120).reverse().find(
      entry => /^https:\/\/stream\.mux\.com\/[a-zA-Z\d_-]{6,200}\.m3u8(?:\?|$)/.test(entry.name));
    if (latest) add(latest.name);
  }

  const youtube = /(?:^|\.)youtube(?:-nocookie)?\.com$/.test(location.hostname);
  const pageId = new URLSearchParams(location.search).get("v") ?? location.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1];
  const player = youtube ? document.querySelector("#movie_player") : null;
  let response;
  if (youtube) {
    try { response = player?.getPlayerResponse?.() ?? globalThis.ytInitialPlayerResponse; } catch {}
  }
  const work = htmlTracks.slice(0, 6).map(async ({ media, tracks, files }) => {
    const best = tracks.sort((a, b) => rank(a.language) - rank(b.language))[0];
    if (best && rank(best.language) === 0) return { media, ...best };
    for (const file of files.sort((a, b) => rank(a.language) - rank(b.language)).slice(0, 2)) {
      if (best && rank(file.language) >= rank(best.language)) break;
      const raw = await readText(file.url);
      if (raw) return { media, raw, format: "vtt", language: file.language };
    }
    return best && { media, ...best };
  });
  if (youtube && /^[\w-]{11}$/.test(pageId ?? "")) work.push((async () => {
    const panel = [...document.querySelectorAll("ytd-transcript-segment-renderer .segment-text")].slice(0, 12_000)
      .map(n => n.textContent.trim()).filter(Boolean);
    if (panel.length) return { cues: panel };
    if (response?.videoDetails?.videoId !== pageId) return null;
    const tracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks)) return null;
    for (const track of tracks.slice(0, 50).sort((a, b) => rank(a?.languageCode) - rank(b?.languageCode)
      || Number(a?.kind === "asr") - Number(b?.kind === "asr")).slice(0, 2)) {
      try {
        const url = new URL(track.baseUrl);
        if (url.origin !== location.origin || url.pathname !== "/api/timedtext") continue;
        url.searchParams.set("fmt", "json3");
        const raw = await readText(url.href);
        if (raw) return { raw, format: "json3", language: track.languageCode };
      } catch {}
    }
    return null;
  })());
  const loomId = /(?:^|\.)loom\.com$/.test(location.hostname)
    && location.pathname.match(/^\/(?:share|embed)\/([a-f\d]{32})\/?$/i)?.[1];
  if (loomId) work.push((async () => {
    const state = globalThis.__APOLLO_STATE__;
    if (!state || typeof state !== "object") return null;
    const track = Object.values(state).find(item => item?.__typename === "VideoTranscriptDetails" && item.video_id === loomId);
    for (const [value, format] of [[track?.captions_source_url, "vtt"], [track?.source_url, "json"]]) {
      try {
        const url = new URL(value);
        if (url.origin !== "https://cdn.loom.com" || !url.pathname.startsWith("/mediametadata/")) continue;
        const raw = await readText(url.href);
        if (raw) return { raw, format, language: track.language };
      } catch {}
    }
    return null;
  })());
  out.captions = [...pageCaptions, ...(await Promise.all(work)).filter(Boolean)];
  return out;
}
