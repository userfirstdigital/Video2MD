const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lrm: "", rlm: "" };
const cueTime = /^(?:(?:\d{1,3}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*(?:(?:\d{1,3}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)(?:\s|$)/;
const stamp = /^(?:(?:\d{1,3}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)$/;

function plain(value) {
  return value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>\n]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      const key = entity.toLowerCase();
      if (!key.startsWith("#")) return Object.hasOwn(entities, key) ? entities[key] : match;
      const n = key[1] === "x" ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : match;
    }).replace(/[\u0000-\u001f\u007f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
}

export function joinCues(cues) {
  const paragraphs = [];
  let words = [];
  let previous = [];
  for (const cue of cues) {
    if (typeof cue !== "string") continue;
    const current = plain(cue).split(" ").filter(Boolean);
    if (!current.length) continue;
    let overlap = Math.min(previous.length, current.length, 60);
    while (overlap && previous.slice(-overlap).join(" ") !== current.slice(0, overlap).join(" ")) overlap--;
    // Rolling captions repeat a phrase; a single shared word can be real speech.
    if (overlap === 1 && current.length > 1 && previous.length > 1) overlap = 0;
    words.push(...current.slice(overlap));
    previous = current;
    if (words.length >= 55 && /[.!?。！？]["”']?$/.test(words.at(-1)) || words.length >= 110) {
      paragraphs.push(words.join(" "));
      words = [];
    }
  }
  if (words.length) paragraphs.push(words.join(" "));
  return paragraphs.join("\n\n");
}

export function parseCaptions(input, format = "") {
  if (typeof input !== "string") return "";
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (/^[{\[]/.test(text)) {
    try {
      const data = JSON.parse(text);
      const entries = Array.isArray(data) ? data : data.events ?? data.segments ?? data.transcription ?? data.cues ?? data.phrases ?? data.words;
      if (Array.isArray(entries)) return joinCues(entries.map(item => item?.segs?.map?.(s => s?.utf8 ?? "").join("")
        ?? item?.text ?? item?.content ?? item?.value ?? item?.word ?? (typeof item === "string" ? item : "")));
      return typeof data.text === "string" ? joinCues([data.text]) : "";
    } catch { /* Some plain-text captions start with a bracket. */ }
  }
  if (/<(?:tt\b|transcript\b|timedtext\b)/i.test(text)) {
    return joinCues([...text.matchAll(/<(p|text)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(match => match[2]));
  }
  if (/^WEBVTT\b|^\d+\n\d{1,3}:/i.test(text) || text.split("\n").some(line => cueTime.test(line.trim()))) {
    const cues = [];
    for (const block of text.split(/\n[ \t]*\n/)) {
      const lines = block.split("\n");
      if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) continue;
      const index = lines.findIndex(line => cueTime.test(line.trim()));
      if (index !== -1) cues.push(lines.slice(index + 1).join(" "));
    }
    return joinCues(cues);
  }
  if (/^(?:vtt|srt|json3|ttml|srv[123]|xml)$/i.test(format) || /^\s*<(?:!doctype|html)/i.test(text)) return "";
  return joinCues(text.split("\n").filter(line => !stamp.test(line.trim())).map(
    line => line.replace(/^\s*(?:\[(?:\d{1,3}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\]|(?:\d{1,3}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s+)\s*/, ""),
  ));
}

const escapeMarkdown = (value) => value.replace(/[\\`*_{}\[\]<>#+.!|~()\-]/g, "\\$&").replace(/&/g, "&amp;");

export function markdown({ title, source, text }) {
  const heading = escapeMarkdown(String(title || "Video transcript").replace(/\s+/g, " ").trim())
    .replace(/\\([.!()-])/g, "$1");
  return "# " + heading + "\n\n" + (source ? "Source: <" + source + ">\n\n" : "")
    + text.split(/\n\s*\n/).map(p => escapeMarkdown(p).replace(/\\([.!()-])/g, "$1")
      .replace(/^(-|\d+[.)])(?=\s)/, item => item.slice(0, -1) + "\\" + item.at(-1))).join("\n\n") + "\n";
}

export function filename(title) {
  const name = String(title || "").normalize("NFKC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ").trim().replace(/^[.]+|[. ]+$/g, "");
  const safe = [...name].slice(0, 100).join("").trim().replace(/[. ]+$/, "");
  return (!safe || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? "transcript" : safe) + ".md";
}
