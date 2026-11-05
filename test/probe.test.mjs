import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { inspectPage } from "../extension/probe.js";

function probeLesson({ queryId, returned, shouldFetch = false }) {
  const location = new URL("https://www.skool.com/sample/classroom/root?md=new-lesson");
  const state = (query, id) => JSON.stringify({ query: { md: query }, props: {
    pageProps: { video: { playbackId: id, playbackToken: "abc.def.ghi" } },
  } });
  const document = { title: "Current lesson", querySelectorAll: () => [], querySelector: selector =>
    selector === "#__NEXT_DATA__" ? { textContent: state(queryId, "original123") } : null };
  return runInNewContext("(" + inspectPage.toString() + ")()", {
    document, location, URL, URLSearchParams, AbortSignal, TextDecoder,
    fetch: async url => {
      assert.ok(shouldFetch, "only look up the lesson if the embedded state is stale");
      assert.equal(url, location.href);
      return new Response("<html>fixture</html>");
    },
    DOMParser: class {
      parseFromString() { return { querySelector: () => ({ textContent: state("new-lesson", returned) }) }; }
    },
  });
}

test("Skool takes the signed playback URL from the current lesson", async () => {
  const result = await probeLesson({ queryId: "new-lesson" });
  assert.ok(result.items.some(item => item.url === "https://stream.mux.com/original123.m3u8?token=abc.def.ghi"));
});

test("Skool does not export the previous video after client-side lesson navigation", async () => {
  const result = await probeLesson({ queryId: "old-lesson", returned: "current123", shouldFetch: true });
  assert.ok(result.items.some(item => item.url === "https://stream.mux.com/current123.m3u8?token=abc.def.ghi"));
  assert.ok(result.items.every(item => !item.url.includes("original123")));
});
