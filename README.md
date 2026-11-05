# Video2MD

<img src="extension/icons/video2md-128.png" width="72" height="72" alt="Video2MD icon">

**Turn a video into a Markdown transcript from your browser toolbar.**

Video2MD finds videos in your active tab and uses existing captions when it can. If captions are unavailable, the local helper can fetch the audio and transcribe it with Whisper on your computer. Copy the result or download an `.md` file with the video title, source link when available, and transcript text without cue timestamps.

[Install](#install) · [Use the extension](#use-the-extension) · [Command line](#command-line) · [MIT License](LICENSE)

## Browser and source support

| Platform | Local transcription |
| --- | --- |
| macOS | Verified end to end in Google Chrome |
| Linux | Verified in Chromium on Debian 12 ARM64. The installer also supports Google Chrome on Linux. |
| Windows | A Windows native helper launcher and registration are still needed. |

Video2MD supports **YouTube, Vimeo, Wistia, Loom, and Skool**. It can also read standard HTML video caption tracks exposed by other sites. Skool lessons use the current lesson’s embedded player or Mux stream. Access to captions and audio varies by video and provider.

Captions exposed directly by the page can be exported with the extension alone. Fetching media and transcribing audio require the native helper. macOS and Linux use the same Whisper Base model file with their respective builds of the transcription tools.

## Install

### 1. Load the extension

```sh
git clone https://github.com/userfirstdigital/Video2MD.git
cd Video2MD
```

In Chrome or Chromium, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the **extension** folder. Pin **Video2MD** from the Extensions menu and copy its extension ID for the next step.

### 2. Install the local transcription tools

The helper requires Node.js 22+, FFmpeg, yt-dlp, and `whisper-cli`. It uses Deno for YouTube extraction.

**macOS.** Install the tools with Homebrew.

```sh
brew install node yt-dlp ffmpeg whisper.cpp deno
```

**Linux.** Install Node.js, FFmpeg, and yt-dlp using your distribution or the upstream installation instructions. Install [whisper.cpp](https://github.com/ggml-org/whisper.cpp#quick-start) and [Deno](https://docs.deno.com/runtime/getting_started/installation/), then confirm `node`, `ffmpeg`, `yt-dlp`, `whisper-cli`, and `deno` are on your `PATH`. These steps target standard desktop Chrome or Chromium packages. Snap and Flatpak browser builds use different paths and sandbox rules.

### 3. Download the model and register the helper

Download the multilingual Whisper Base model, about 142 MiB.

```sh
mkdir -p ~/.local/share/video-transcript-downloader
curl --fail --location --retry 2 \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin \
  --output ~/.local/share/video-transcript-downloader/ggml-base.bin
```

Run the command for your browser from the Video2MD directory. Replace `YOUR_EXTENSION_ID` with the ID copied from the Extensions page.

```sh
# Google Chrome
npm run install:chrome -- YOUR_EXTENSION_ID

# Chromium
npm run install:chrome -- YOUR_EXTENSION_ID --browser chromium
```

To use another model, append `--model /absolute/path/to/model.bin`. On Linux, if you start the browser with a custom user data directory, set `CHROME_USER_DATA_DIR` to the same absolute path when registering the helper. If you move the checkout, load the extension from its new location and register the helper again.

## Use the extension

1. Open a video or Skool lesson and click the **Video2MD** toolbar icon. If the player loads on demand, press play briefly before opening the popup.
2. Select the video if there’s more than one, then click **Get transcript**. You can close the popup while it works and reopen it on the same tab.
3. Use **Copy Markdown**, the overlapping squares, or **Download Markdown**, the down arrow. A checkmark confirms that the copy reached your clipboard.

### When a video can only play in the tab

Use **Record tab audio** when the video plays in Chrome but the helper can’t fetch it. The mic icon opens a recording tab and captures the selected browser tab’s audio. It leaves your microphone off.

1. In the recording tab, click **Record tab audio** and select the original video tab in Chrome’s picker. Enable **Also share tab audio**.
2. Play the video from the start. Recording takes place in real time and includes all audio from that tab.
3. Return to the recording tab and click **Stop and transcribe**. Copy or download the result when it’s ready.

Direct transcription accepts videos up to two hours and media downloads up to 256 MB. Process videos you have permission to use.

## Command line

The CLI uses the same caption selection, speech recognition, and Markdown formatting as the extension. Markdown goes to stdout by default, progress goes to stderr, and failed runs return a nonzero exit code.

```sh
# Print existing captions as Markdown.
node native/cli.mjs 'https://www.youtube.com/watch?v=jNQXAC9IVRw' --captions-only

# Transcribe a local file and save the result.
node native/cli.mjs --audio ./lesson.webm --title 'Lesson transcript' --output transcript.md
```

Run `node native/cli.mjs --help` for all options. Use `--quiet` to suppress progress or `--model` to select a different Whisper model. For signed-in Skool lessons, use the extension to resolve the lesson in Chrome. If a headless caller already has an authorized Mux playback URL, it can pass that URL with `--source` to include the lesson link in the export.

## Privacy and troubleshooting

Video2MD reads the active tab and supported player frames when you invoke it. When the helper needs captions or media, it requests them from the provider and processes audio locally. It uses temporary files for processing and removes them after each job. The helper does not copy browser cookies or send audio to a transcription service.

- **No video found.** Play the video briefly, then reopen the popup on that tab.
- **The helper could not start.** Check that the browser and extension ID match what you registered. Register the helper again if you moved the project or changed the browser’s profile path.
- **A previously working source fails.** Update yt-dlp. If the video still plays in your browser, try **Record tab audio**.

## Development and contributions

Run `npm test` from the repository root. Reload the unpacked extension after editing `extension/`. Chrome launches the native helper from the checkout for each job.

| Directory | Contents |
| --- | --- |
| `extension/` | Popup, video detection, and background job handling |
| `extension/core/` | Shared URL handling and Markdown formatting |
| `native/` | Native messaging host, transcription pipeline, installer, and CLI |
| `test/` | Provider detection, caption cleanup, and Skool lesson selection tests |

Bug reports and pull requests are welcome. When reporting an issue, include your operating system, browser, and video provider. [Open an issue](https://github.com/userfirstdigital/Video2MD/issues/new)

## License

Video2MD is available under the [MIT License](LICENSE), which includes a warranty disclaimer and limitation of liability. Upstream tools and models retain their own licenses.
