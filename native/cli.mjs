import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { defaultModel, fromAudio, fromVideo, toMarkdown, UserError } from "./pipeline.mjs";

const usage = "Usage: node native/cli.mjs <video-url> [--captions-only] [--source <lesson-url>] [--output <file.md>]\n"
  + "       node native/cli.mjs --audio <local-file> [--title <title>] [--output <file.md>]\n"
  + "       Options: --model <path> --quiet --help";
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true, options: {
      audio: { type: "string" }, title: { type: "string" }, source: { type: "string" },
      output: { type: "string", short: "o" }, model: { type: "string" },
      "captions-only": { type: "boolean" }, quiet: { type: "boolean" }, help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(usage);
  } else {
    if (values.audio ? positionals.length || values["captions-only"] : positionals.length !== 1) throw new UserError(usage);
    const options = {
      model: resolve(values.model || process.env.TRANSCRIPT_WHISPER_MODEL || defaultModel),
      source: values.source, captionsOnly: values["captions-only"],
      progress: message => { if (!values.quiet) console.error(message); },
    };
    const result = values.audio ? await fromAudio(resolve(values.audio), options) : await fromVideo(positionals[0], options);
    const document = toMarkdown(result, { title: values.title, source: values.source ?? positionals[0] });
    if (values.output) await writeFile(values.output, document, { flag: "wx", mode: 0o600 });
    else process.stdout.write(document);
  }
} catch (error) {
  console.error(error instanceof UserError || String(error.code).startsWith("ERR_PARSE_ARGS")
    ? error.message : error.code === "EEXIST" ? "The output file already exists." : "Could not complete the transcript.");
  process.exitCode = 1;
}
