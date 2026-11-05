import { httpsUrl } from "../extension/core/source.js";
import { parseCaptions } from "../extension/core/transcript.js";

async function readBounded(url, signal) {
  const timeout = AbortSignal.timeout(8000);
  const response = await fetch(url, { redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok || !response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > 4 * 1024 * 1024) return "";
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

// Loom's share page includes the transcript records in its initial player state.
// Parse that data as JSON; never evaluate the scripts in the response.
export async function loomCaptions(id, signal) {
  const html = await readBounded("https://www.loom.com/share/" + id, signal);
  const state = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[^\r\n]*\})\s*;/)?.[1];
  if (!state) return null;
  const data = JSON.parse(state);
  const transcript = Object.values(data).find(item => item?.__typename === "VideoTranscriptDetails" && item.video_id === id);
  if (!transcript) return null;
  for (const [url, format] of [[transcript.captions_source_url, "vtt"], [transcript.source_url, "json"]]) {
    const target = httpsUrl(url);
    if (target?.hostname !== "cdn.loom.com" || !target.pathname.startsWith("/mediametadata/")) continue;
    const raw = await readBounded(target, signal).catch(() => {
      signal?.throwIfAborted();
      return "";
    });
    const text = parseCaptions(raw, format);
    if (text) return {
      text, method: "Existing captions",
      title: data["RegularUserVideo:" + id]?.name?.slice(0, 250),
      language: typeof transcript.language === "string" ? transcript.language : undefined,
    };
  }
  return null;
}
