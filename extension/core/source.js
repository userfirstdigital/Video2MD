const providerNames = {
  youtube: "YouTube", vimeo: "Vimeo", wistia: "Wistia", loom: "Loom", skool: "Skool",
};

export function httpsUrl(value) {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port ? url : null;
  } catch {
    return null;
  }
}

const on = (host, domain) => host === domain || host.endsWith("." + domain);

export function sourceFrom(value) {
  const url = httpsUrl(value);
  if (!url) return null;
  const { hostname: host, pathname: path } = url;
  const parts = path.split("/").filter(Boolean);
  let provider, id, canonical;
  if (on(host, "youtube.com") || on(host, "youtube-nocookie.com") || host === "youtu.be") {
    id = host === "youtu.be" ? parts[0] : path === "/watch" ? url.searchParams.get("v")
      : ["embed", "shorts", "live"].includes(parts[0]) ? parts[1] : null;
    if (!/^[\w-]{11}$/.test(id ?? "")) return null;
    provider = "youtube";
    canonical = "https://www.youtube.com/watch?v=" + id;
  } else if (on(host, "vimeo.com")) {
    const match = path.match(/^\/(?:video\/)?(\d+)(?:\/([a-f\d]{6,32}))?\/?$/i)
      ?? path.match(/^\/(?:channels\/[^/]+|groups\/[^/]+\/videos|showcase\/\d+\/video)\/(\d+)\/?$/);
    if (!match) return null;
    [, id] = match;
    const hash = url.searchParams.get("h") || match[2];
    provider = "vimeo";
    canonical = "https://player.vimeo.com/video/" + id + (/^[a-f\d]{6,32}$/i.test(hash ?? "") ? "?h=" + hash : "");
  } else if (on(host, "loom.com")) {
    id = path.match(/^\/(?:share|embed)\/([a-f\d]{32})\/?$/i)?.[1];
    if (!id) return null;
    provider = "loom";
    canonical = "https://www.loom.com/" + parts[0] + "/" + id;
  } else if (on(host, "wistia.com") || on(host, "wistia.net")) {
    id = path.match(/^\/(?:embed\/)?(?:medias\/|iframe\/)?([a-z\d]{10})(?:\.(?:json|js))?\/?$/)?.[1]
      ?? url.searchParams.get("wvideo");
    if (!/^[a-z\d]{10}$/.test(id ?? "")) return null;
    provider = "wistia";
    canonical = "https://fast.wistia.net/embed/iframe/" + id;
  } else if (host === "stream.mux.com") {
    id = path.match(/^\/([a-zA-Z\d_-]{6,200})\.m3u8$/)?.[1];
    if (!id) return null;
    const token = url.searchParams.get("token");
    if (token && !/^[a-zA-Z\d_-]+\.[a-zA-Z\d_-]+\.[a-zA-Z\d_-]+$/.test(token)) return null;
    provider = "skool";
    canonical = "https://stream.mux.com/" + id + ".m3u8" + (token ? "?token=" + token : "");
  } else return null;
  return { key: provider + ":" + id, provider: providerNames[provider], url: canonical };
}

export function publicPage(value) {
  const url = httpsUrl(value);
  if (!url) return "";
  url.hash = "";
  // A Markdown export must not contain signed media URLs or page query tokens.
  if (url.hostname === "stream.mux.com") return "";
  if (on(url.hostname, "youtube.com") && url.pathname === "/watch") {
    return sourceFrom(url.href)?.url ?? url.origin + url.pathname;
  }
  if (on(url.hostname, "skool.com")) {
    const lesson = url.searchParams.get("md");
    return url.origin + url.pathname + (/^[\w-]{1,100}$/.test(lesson ?? "") ? "?md=" + lesson : "");
  }
  return url.origin + url.pathname;
}
