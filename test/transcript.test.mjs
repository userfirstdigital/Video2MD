import test from "node:test";
import assert from "node:assert/strict";
import { filename, markdown, parseCaptions } from "../extension/core/transcript.js";
import { publicPage, sourceFrom } from "../extension/core/source.js";
import { selectTracks } from "../native/pipeline.mjs";

test("removes WebVTT headers, timestamps, styling and rolling caption duplication", () => {
  const raw = "WEBVTT\r\n\r\nNOTE editorial\r\nDo not include this\r\n\r\ncue-1\r\n00:00:01.000 --> 00:00:03.000 align:start\r\n<c>Welcome to the show</c>\r\n\r\n00:00:03.000 --> 00:00:04.000\r\nthe show &amp; thanks for joining.\r\n";
  assert.equal(parseCaptions(raw), "Welcome to the show & thanks for joining.");
  assert.equal(parseCaptions("1\n00:01:00,100 --> 00:01:02,000\nWe start at 10:30.\n"), "We start at 10:30.");
});

test("reads YouTube JSON3, Loom phrases and XML captions", () => {
  assert.equal(parseCaptions(JSON.stringify({ events: [
    { tStartMs: 1, segs: [{ utf8: "You " }, { utf8: "made it." }] },
    { tStartMs: 2 },
  ] })), "You made it.");
  assert.equal(parseCaptions(JSON.stringify({ phrases: [{ ts: 20.5, value: "One more step." }] })), "One more step.");
  assert.equal(parseCaptions('<tt><body><p begin="2s">First<br/>line.</p></body></tt>'), "First line.");
  assert.equal(parseCaptions("WEBVTT\n\nNOTE nothing here", "vtt"), "");
  assert.equal(parseCaptions("<html>Session expired</html>"), "");
});

test("exports literal speech and a safe Markdown filename", () => {
  const document = markdown({ title: "Lesson #2", source: "https://example.com/lesson",
    text: "1. Start here.\n\n- A literal dash.\n\n<script>alert(1)</script>" });
  assert.match(document, /^# Lesson \\#2\n\nSource: <https:\/\/example\.com\/lesson>/);
  assert.ok(document.includes("1\\. Start here."));
  assert.ok(document.includes("\\- A literal dash."));
  assert.ok(!document.includes("<script>"));
  assert.equal(filename("../"), "transcript.md");
  assert.equal(filename("Con"), "transcript.md");
  assert.equal(filename("Tutorial: captions / audio"), "Tutorial captions audio.md");
});

test("recognizes one video per provider and keeps signed media out of exported source links", () => {
  const cases = [
    ["https://youtu.be/jNQXAC9IVRw?list=playlist", "YouTube", "https://www.youtube.com/watch?v=jNQXAC9IVRw"],
    ["https://vimeo.com/76979871", "Vimeo", "https://player.vimeo.com/video/76979871"],
    ["https://vimeo.com/123456/abcdef1234", "Vimeo", "https://player.vimeo.com/video/123456?h=abcdef1234"],
    ["https://example.wistia.com/medias/2t267lavm8", "Wistia", "https://fast.wistia.net/embed/iframe/2t267lavm8"],
    ["https://www.loom.com/embed/9458bcbf79784162aa62ffb8dd66201b", "Loom", "https://www.loom.com/embed/9458bcbf79784162aa62ffb8dd66201b"],
    ["https://stream.mux.com/lesson123.m3u8?token=abc.def.ghi", "Skool", "https://stream.mux.com/lesson123.m3u8?token=abc.def.ghi"],
  ];
  for (const [value, provider, url] of cases) assert.deepEqual(
    [sourceFrom(value)?.provider, sourceFrom(value)?.url], [provider, url]);
  assert.equal(publicPage(cases.at(-1)[0]), "");
  assert.equal(publicPage("https://www.skool.com/club/classroom/course?md=lesson&token=private#thing"),
    "https://www.skool.com/club/classroom/course?md=lesson");
  for (const value of [
    "http://vimeo.com/123", "https://vimeo.com.example.org/123", "https://x@y.com/",
    "https://www.youtube.com/playlist?list=playlists", "https://stream.mux.com/id1234.m3u8?token=invalid",
  ]) assert.equal(sourceFrom(value), null);
});

test("chooses English and manual tracks when available, skipping live chat", () => {
  const track = [{ url: "https://example.com/sample.vtt" }];
  const ranked = selectTracks({
    subtitles: { "live_chat": track, fr: track, "en-US": track },
    automatic_captions: { de: track, en: track },
  });
  assert.deepEqual(ranked.map(item => item.language), ["en-US", "en", "fr", "de"]);
});
