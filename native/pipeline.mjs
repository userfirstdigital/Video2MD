import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { sourceFrom, publicPage } from "../extension/core/source.js";
import { markdown, parseCaptions } from "../extension/core/transcript.js";
import { loomCaptions } from "./loom.mjs";

const exec = promisify(execFile);
const audioLimit = 256 * 1024 * 1024;
export const recordingLimit = audioLimit;
export const defaultModel = join(homedir(), ".local", "share", "video-transcript-downloader", "ggml-base.bin");

export class UserError extends Error {}

async function run(tool, args, cwd, signal, timeout) {
  return exec(tool, args, { cwd, signal, timeout, maxBuffer: 24 * 1024 * 1024, killSignal: "SIGKILL" });
}

async function temporary(fn) {
  const dir = await mkdtemp(join(tmpdir(), "video-transcript-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

const preference = (lang) => /^en(?:g$|[-_]|$)/i.test(lang) ? 0 : 1;
const languagePattern = /^[A-Za-z0-9_-]{1,48}$/;
const formats = "vtt/srt/json3/ttml/srv3/json/best";
export function selectTracks(info) {
  return [[info.subtitles, false], [info.automatic_captions, true]].flatMap(([tracks, automatic]) =>
    Object.entries(tracks ?? {}).filter(([lang, entries]) => languagePattern.test(lang) && lang !== "live_chat" &&
      Array.isArray(entries) && entries.some(item => item?.url || item?.data))
      .map(([language]) => ({ language, automatic })))
    .sort((a, b) => preference(a.language) - preference(b.language) || Number(a.automatic) - Number(b.automatic)
      || Number(b.language === "en") - Number(a.language === "en"));
}

function ytArgs(url, source) {
  const page = publicPage(source);
  const referer = page ? new URL(page).origin + "/" : "";
  return [
    "--ignore-config", "--no-plugin-dirs", "--no-playlist", "--playlist-items", "1", "--no-progress",
    "--socket-timeout", "15", "--retries", "1", "--fragment-retries", "1",
    "--js-runtimes", "deno", "--no-cache-dir",
    ...(referer && new URL(url).origin !== new URL(referer).origin ? ["--referer", referer] : []),
  ];
}

function commandError(error, missing, failure) {
  if (error.name === "AbortError") throw error;
  return new UserError(error.code === "ENOENT" ? missing : failure);
}

async function lookup(url, args, dir, signal) {
  const { stdout } = await run("yt-dlp", [
    ...args, "--dump-single-json", "--skip-download", "--ignore-no-formats-error", "--", url,
  ], dir, signal, 90_000);
  const info = JSON.parse(stdout);
  if (!info || info._type === "playlist" || info.is_live) throw new UserError("Open a single, finished video.");
  return info;
}

async function captions(info, args, dir, signal) {
  const selected = selectTracks(info).slice(0, 4);
  if (!selected.length) return null;
  const metadata = join(dir, "metadata.json");
  await writeFile(metadata, JSON.stringify(info), { mode: 0o600 });
  for (const { language, automatic } of selected) {
    const base = "captions-" + (automatic ? "auto-" : "manual-") + language;
    try {
      await run("yt-dlp", [
        ...args, "--load-info-json", metadata, "--skip-download", automatic ? "--write-auto-subs" : "--write-subs",
        "--sub-langs", "^" + language + "$", "--sub-format", formats, "-o", base + ".%(ext)s",
      ], dir, signal, 35_000);
    } catch (error) {
      if (error.name === "AbortError") throw error;
    }
    for (const file of (await readdir(dir)).filter(name => name.startsWith(base + "."))) {
      const path = join(dir, file);
      if ((await stat(path)).size > 8 * 1024 * 1024) continue;
      const text = parseCaptions(await readFile(path, "utf8"), file.split(".").at(-1));
      if (text) return { text, language, method: automatic ? "Automatic captions" : "Existing captions" };
    }
  }
  return null;
}

export async function ensureWhisper(model) {
  try { await access(model); } catch {
    throw new UserError("Whisper model not found. Set up local transcription using the README.");
  }
}

async function transcribe(input, dir, { model, signal, progress }) {
  await ensureWhisper(model);
  progress("Preparing audio…");
  const wav = join(dir, "speech.wav");
  try {
    await run("ffmpeg", [
      "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", input,
      "-map", "0:a:0", "-t", "7201", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav,
    ], dir, signal, 10 * 60_000);
  } catch (error) {
    throw commandError(error, "Install FFmpeg to transcribe audio.", "The audio could not be decoded.");
  }
  if ((await stat(wav)).size > 7200 * 32000 + 4096) throw new UserError("Audio is longer than the two-hour transcription limit.");
  const output = join(dir, "speech");
  progress("Transcribing audio on this computer…");
  try {
    await run("whisper-cli", [
      "-m", model, "-f", wav, "-l", "auto", "-otxt", "-of", output,
    ], dir, signal, 3 * 60 * 60_000);
  } catch (error) {
    throw commandError(error, "Install whisper.cpp to transcribe audio.", "Whisper could not finish the transcription.");
  }
  const text = parseCaptions(await readFile(output + ".txt", "utf8"));
  if (!text) throw new UserError("Whisper did not find speech in this audio.");
  return { text, method: "Transcribed locally" };
}

export async function fromAudio(path, options = {}) {
  return temporary(dir => transcribe(path, dir, { model: defaultModel, progress: () => {}, ...options }));
}

export async function fromVideo(value, {
  source, captionsOnly = false, signal, progress = () => {}, model = defaultModel,
} = {}) {
  const video = sourceFrom(value);
  if (!video) throw new UserError("Use a supported video URL. For Skool, use the extension on the lesson page.");
  const args = ytArgs(video.url, source);
  return temporary(async dir => {
    progress("Checking the video for captions…");
    if (video.provider === "Loom") {
      const existing = await loomCaptions(video.key.split(":")[1], signal).catch(() => {
        signal?.throwIfAborted();
        return null;
      });
      if (existing) return existing;
    }
    let info;
    try {
      info = await lookup(video.url, args, dir, signal);
    } catch (error) {
      if (error instanceof UserError) throw error;
      throw commandError(error, "Install yt-dlp to fetch captions and audio.",
        "The helper could not open this video. If it plays in Chrome, try recording tab audio.");
    }
    const title = typeof info.title === "string" && video.provider !== "Skool" ? info.title.slice(0, 250) : undefined;
    const existing = await captions(info, args, dir, signal);
    if (existing) return { title, ...existing };
    if (captionsOnly) throw new UserError("No readable captions were found.");
    await ensureWhisper(model);
    if (info.duration > 7200) throw new UserError("Videos longer than two hours cannot be transcribed in one pass.");
    progress("No readable captions. Getting audio for transcription…");
    try {
      await run("yt-dlp", [
        ...args, "--max-filesize", "256M", "--match-filters", "!is_live & duration <=? 7200",
        // A provider may only offer combined streams, including a large original.
        // Transcription needs the audio, so prefer a smaller combined rendition.
        "-f", "bestaudio/worst", "-o", "media.%(ext)s", "--", video.url,
      ], dir, signal, 45 * 60_000);
    } catch (error) {
      throw commandError(error, "Install yt-dlp to get the audio.",
        "The audio was unavailable to the helper. If it plays in Chrome, try recording tab audio.");
    }
    const file = (await readdir(dir)).find(name => /^media\.[A-Za-z0-9]+$/.test(name));
    const input = file && join(dir, file);
    if (!input || (await stat(input)).size > audioLimit) {
      throw new UserError("The helper could not get audio within the 256 MB limit. Try recording tab audio.");
    }
    return { title, ...await transcribe(input, dir, { model, signal, progress }) };
  });
}

export function toMarkdown(result, { title, source } = {}) {
  return markdown({ title: title || result.title, source: publicPage(source), text: result.text });
}
