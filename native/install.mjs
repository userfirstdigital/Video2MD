import { mkdir, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const host = "com.userfirstdigital.video_transcript";
const [id, ...flags] = process.argv.slice(2);
const modelIndex = flags.indexOf("--model");
if (!/^[a-p]{32}$/.test(id ?? "") || (flags.length && (flags.length !== 2 || modelIndex !== 0 || !flags[1]))) {
  console.error("Usage: npm run install:chrome -- <extension-id> [--model /path/to/ggml-base.bin]");
  process.exit(2);
}
if (process.platform !== "darwin" && process.platform !== "linux") {
  console.error("The Chrome helper installer supports macOS and Linux.");
  process.exit(2);
}

const home = homedir();
const manifests = process.platform === "darwin"
  ? join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts")
  : join(home, ".config", "google-chrome", "NativeMessagingHosts");
const dataDir = join(home, ".local", "share", "video-transcript-downloader");
const launcher = join(dataDir, "chrome-host");
const script = join(dirname(fileURLToPath(import.meta.url)), "host.mjs");
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const searchPath = [...new Set([dirname(process.execPath), ...(process.env.PATH ?? "").split(":"),
  "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].filter(p => p.startsWith("/")))].join(":");
await mkdir(dataDir, { recursive: true, mode: 0o700 });
await mkdir(manifests, { recursive: true });
await writeFile(launcher, [
  "#!/bin/sh", "export PATH=" + quote(searchPath),
  ...(flags[1] ? ["export TRANSCRIPT_WHISPER_MODEL=" + quote(resolve(flags[1]))] : []),
  "exec " + quote(process.execPath) + " " + quote(script) + ' "$@"', "",
].join("\n"), { mode: 0o700 });
await chmod(launcher, 0o700);
await writeFile(join(manifests, host + ".json"), JSON.stringify({
  name: host, description: "Local captions and Whisper transcription", path: launcher,
  type: "stdio", allowed_origins: ["chrome-extension://" + id + "/"],
}, null, 2) + "\n", { mode: 0o600 });
console.log("Registered the local helper for Chrome extension " + id + ".");
