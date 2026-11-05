import { mkdir, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const host = "com.userfirstdigital.video_transcript";
const usage = "Usage: npm run install:chrome -- <extension-id> [--browser chrome|chromium] [--model /path/to/ggml-base.bin]";
let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: { browser: { type: "string", default: "chrome" }, model: { type: "string" } },
  });
} catch {
  console.error(usage);
  process.exit(2);
}
const { positionals: [id], values: { browser, model } } = args;
if (args.positionals.length !== 1 || !/^[a-p]{32}$/.test(id)
    || !["chrome", "chromium"].includes(browser) || model === "") {
  console.error(usage);
  process.exit(2);
}
if (process.platform !== "darwin" && process.platform !== "linux") {
  console.error("The browser helper installer supports macOS and Linux.");
  process.exit(2);
}

const home = homedir();
const chromium = browser === "chromium";
const browserName = chromium ? "Chromium" : "Google Chrome";
const configHome = [process.env.CHROME_CONFIG_HOME, process.env.XDG_CONFIG_HOME]
  .find(path => path && isAbsolute(path)) ?? join(home, ".config");
const linuxProfile = process.env.CHROME_USER_DATA_DIR;
const browserData = process.platform === "darwin"
  ? join(home, "Library", "Application Support", ...(chromium ? ["Chromium"] : ["Google", "Chrome"]))
  : linuxProfile && isAbsolute(linuxProfile)
    ? linuxProfile
    : join(configHome, chromium ? "chromium" : "google-chrome");
const manifests = join(browserData, "NativeMessagingHosts");
const dataDir = join(home, ".local", "share", "video-transcript-downloader");
const launcher = join(dataDir, browser + "-host");
const script = join(dirname(fileURLToPath(import.meta.url)), "host.mjs");
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const searchPath = [...new Set([dirname(process.execPath), ...(process.env.PATH ?? "").split(":"),
  "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].filter(p => p.startsWith("/")))].join(":");
await mkdir(dataDir, { recursive: true, mode: 0o700 });
await mkdir(manifests, { recursive: true });
await writeFile(launcher, [
  "#!/bin/sh", "export PATH=" + quote(searchPath),
  ...(model ? ["export TRANSCRIPT_WHISPER_MODEL=" + quote(resolve(model))] : []),
  "exec " + quote(process.execPath) + " " + quote(script) + ' "$@"', "",
].join("\n"), { mode: 0o700 });
await chmod(launcher, 0o700);
await writeFile(join(manifests, host + ".json"), JSON.stringify({
  name: host, description: "Local captions and Whisper transcription", path: launcher,
  type: "stdio", allowed_origins: ["chrome-extension://" + id + "/"],
}, null, 2) + "\n", { mode: 0o600 });
console.log("Registered the local helper for " + browserName + " extension " + id + ".");
