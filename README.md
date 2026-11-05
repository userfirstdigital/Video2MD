# Video2MD

<img src="extension/icons/video2md-128.png" width="72" height="72" alt="Video2MD">

Video2MD turns videos in your active Chrome tab into Markdown transcripts. It reuses existing captions when available and runs Whisper on your computer when it needs to transcribe audio. Copy the Markdown straight to your clipboard or download an `.md` file. Both exports include the title, source link when available, and transcript text without cue timestamps.

**Local audio transcription uses the same Video2MD extension and Whisper Base model on macOS and Linux.**

| Platform | Local audio transcription |
| --- | --- |
| macOS | Verified end to end in Google Chrome using the native helper and Whisper Base |
| Linux | Verified transcription and Markdown download in Chromium on Debian 12 (ARM64). The installer also supports Google Chrome. |
| Windows | Requires a Windows native helper launcher, Chrome registration, and end-to-end testing. |

Linux and Windows each need their own native helper setup and compatible builds of the transcription tools. A compatible build of whisper.cpp can reuse the same GGML Whisper model file. [whisper.cpp platform and model documentation](https://github.com/ggml-org/whisper.cpp#quick-start)

Caption export is a separate path. The extension can export captions exposed directly by the page without running Whisper or installing the local helper.

## Supported sources

| Source | What Video2MD looks for |
| --- | --- |
| YouTube | Captions and audio from watch pages and embedded players |
| Vimeo | Captions and audio from videos and embedded players |
| Wistia | Captions and audio from videos and embedded players |
| Loom | Existing captions or transcripts, then audio when available |
| Skool | The current lesson’s embedded player or Mux stream |
| Other sites | Standard HTML video caption tracks exposed by the page |

Access varies by video and provider. Use Video2MD with videos you’re allowed to process.

## Install for local transcription on macOS

Use Google Chrome 116 or later and Node.js 22 or later. These steps configure the native helper for Google Chrome on macOS.

1. Clone the repository and open its directory.

   ```sh
   git clone https://github.com/userfirstdigital/Video2MD.git
   cd Video2MD
   ```

2. Install the tools with Homebrew.

   ```sh
   brew install node yt-dlp ffmpeg whisper.cpp deno
   ```

3. Download the multilingual Whisper Base model (about 142 MiB).

   ```sh
   mkdir -p ~/.local/share/video-transcript-downloader
   curl --fail --location --retry 2 \
     https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin \
     --output ~/.local/share/video-transcript-downloader/ggml-base.bin
   ```

4. Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the repository’s **extension** folder. Pin **Video2MD** from Chrome’s Extensions menu.
5. Copy the extension ID shown on the Extensions page. Register the local helper from the repository root.

   ```sh
   npm run install:chrome -- YOUR_EXTENSION_ID
   ```

If you move the checkout, reload the unpacked extension from its new location and register the helper again. To use another Whisper model, append `--model /absolute/path/to/model.bin` to the registration command.

## Install for local transcription on Linux

Use a standard desktop install of Google Chrome or Chromium, version 116 or later. Snap and Flatpak browser builds can use different native messaging paths and sandbox rules and are outside this setup.

1. Clone Video2MD and install Node.js 22+, FFmpeg, yt-dlp, and the `whisper-cli` executable from [whisper.cpp](https://github.com/ggml-org/whisper.cpp#quick-start). Install [Deno](https://docs.deno.com/runtime/getting_started/installation/) for YouTube extraction. Confirm these commands are on your `PATH` before registering the helper.
2. Download `ggml-base.bin` using the macOS model command above. The model and its default location are the same on Linux.
3. Load the **extension** folder from `chrome://extensions` and copy its extension ID.
4. From the Video2MD directory, register the helper for the browser you use.

   ```sh
   # Google Chrome
   npm run install:chrome -- YOUR_EXTENSION_ID

   # Chromium
   npm run install:chrome -- YOUR_EXTENSION_ID --browser chromium
   ```

If you launch the browser with a custom user data directory, set `CHROME_USER_DATA_DIR` to that same absolute path when running the installer. A custom model path can be passed with `--model` for either browser.

## Use the popup

1. Open a video or Skool lesson and click the Video2MD toolbar icon. Start playback briefly if the video player loads only after you press play.
2. Select a video if the popup finds more than one, then click **Get transcript**. Video2MD checks for captions before starting local transcription. You can close the popup and reopen it on the same tab to check progress.
3. Use the overlapping-squares **Copy Markdown** icon to copy the full export. A checkmark confirms it’s on your clipboard. Use the arrow **Download Markdown** icon to save the same text to a file.

### Record tab audio

Use the mic-shaped **Record tab audio** button if Video2MD can’t fetch a video that plays in Chrome. It records audio from the tab you share and leaves your microphone off.

1. Click **Record tab audio** in the popup to open the recording tab. Click **Record tab audio** there to open Chrome’s picker.
2. Select the original video tab, enable **Also share tab audio**, and play the video from the start. Recording runs in real time and includes all audio from the selected tab.
3. Return to the recording tab and click **Stop and transcribe**. Copy or download the Markdown when it’s ready.

## Use the command line

The CLI uses the same caption selection, speech recognition, and Markdown formatting as the extension. It writes Markdown to stdout and progress to stderr. An unsuccessful run returns a nonzero exit code.

```sh
node native/cli.mjs 'https://www.youtube.com/watch?v=jNQXAC9IVRw' --captions-only
node native/cli.mjs --audio /path/to/lesson.webm --title 'Lesson transcript' --output transcript.md
```

| Option | Behavior |
| --- | --- |
| `--captions-only` | Use existing captions and skip speech recognition |
| `--audio <file>` | Transcribe a local audio or video file |
| `--output <file>` or `-o <file>` | Create a Markdown file instead of writing to stdout |
| `--title <title>` | Set the Markdown heading |
| `--source <url>` | Set the source link |
| `--model <path>` | Override the default Whisper model |
| `--quiet` | Suppress progress messages |
| `--help` | Show usage |

For a signed-in Skool lesson, use Chrome to resolve the current lesson. A headless caller that already has an authorized Mux playback URL can pass that URL and use `--source` to include the lesson link.

## Troubleshooting

- **No video found.** Play the video briefly and reopen the popup on that tab.
- **The helper could not start.** Check that you registered the ID shown in `chrome://extensions`. Run the registration command again if you moved the project.
- **A video plays in Chrome but can’t be fetched.** Use **Record tab audio**. If a previously working source starts failing, update yt-dlp.
- **A video is too long or the media is too large.** Direct transcription accepts videos up to two hours and downloaded media up to 256 MB.

## Development

```sh
npm test
```

- `extension/` contains the Chrome popup, active-tab detection, and background job tracking.
- `extension/core/` contains shared URL parsing and Markdown formatting.
- `native/` contains the Chrome native messaging host, transcription pipeline, installer, and CLI.
- `test/` covers provider URL handling, caption cleanup, and Skool lesson selection after navigation.

Reload the unpacked extension after editing `extension/`. Chrome launches the native helper from the checkout for each job.

Video2MD reads the active page and supported player frames when invoked. The helper requests media from the provider and processes the audio locally. It removes its temporary files after each job. It does not copy browser cookies, send audio to a transcription service, or expose a local HTTP server.

Built with [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [yt-dlp](https://github.com/yt-dlp/yt-dlp), and [whisper.cpp](https://github.com/ggml-org/whisper.cpp).
