import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromAudio, fromVideo, ensureWhisper, defaultModel, recordingLimit, UserError } from "./pipeline.mjs";

const controller = new AbortController();
const { signal } = controller;
const model = process.env.TRANSCRIPT_WHISPER_MODEL || defaultModel;
const maxInput = 512 * 1024;
let recording;
let dir;
let bytes = 0;
const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function send(message) {
  let body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length >= 1_000_000) {
    body = Buffer.from(JSON.stringify({ type: "error", error: "This transcript exceeds Chrome’s message limit. Use the CLI to save it." }));
  }
  const length = Buffer.alloc(4);
  littleEndian ? length.writeUInt32LE(body.length) : length.writeUInt32BE(body.length);
  process.stdout.write(Buffer.concat([length, body]));
}

async function* messages() {
  let buffer = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const size = littleEndian ? buffer.readUInt32LE() : buffer.readUInt32BE();
      if (!size || size > maxInput) throw new UserError("Invalid message size from the extension.");
      if (buffer.length < 4 + size) break;
      yield JSON.parse(buffer.subarray(4, 4 + size).toString("utf8"));
      buffer = buffer.subarray(4 + size);
    }
  }
}

const progress = (message) => send({ type: "progress", message });

for (const name of ["SIGTERM", "SIGINT"]) process.on(name, () => {
  controller.abort();
  process.stdin.destroy();
});

try {
  for await (const msg of messages()) {
    if (msg?.type === "run" && !recording) {
      const result = await fromVideo(msg.url, { source: msg.source, model, signal, progress });
      send({ type: "result", result });
      break;
    }
    if (msg?.type === "record-start" && !recording) {
      await ensureWhisper(model);
      dir = await mkdtemp(join(tmpdir(), "video-transcript-recording-"));
      recording = await open(join(dir, "tab.webm"), "wx", 0o600);
      send({ type: "ready" });
      continue;
    }
    if (msg?.type === "record-chunk" && recording && typeof msg.data === "string") {
      const data = Buffer.from(msg.data, "base64");
      bytes += data.length;
      if (bytes > recordingLimit) throw new UserError("Recording exceeds the 256 MB limit.");
      await recording.writeFile(data);
      continue;
    }
    if (msg?.type === "record-finish" && recording && bytes > 0) {
      await recording.close();
      recording = undefined;
      const result = await fromAudio(join(dir, "tab.webm"), { model, signal, progress });
      send({ type: "result", result });
      break;
    }
    throw new UserError("No audio was received or the extension sent an unexpected message.");
  }
} catch (error) {
  if (!signal.aborted) send({ type: "error", error: error instanceof UserError ? error.message : "The local helper could not finish this job." });
} finally {
  await recording?.close().catch(() => {});
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
}
