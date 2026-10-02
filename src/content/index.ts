import { panelHeight } from "../shared/panel-layout";
import type { PageCommand, Video, Sponsor } from "../shared/types";
import { abortError, checkAbort, sleep, safeUrl } from "../shared/utils";
import { extractTranscript } from "./transcript";
import { loadComments } from "./comments";
import { suggestionFragment } from "../shared/search-suggestions";
import { wordAt } from "../shared/words";

let host: HTMLDivElement | undefined,
  frame: HTMLIFrameElement | undefined,
  currentId = "",
  active = false;
const jobs = new Map<string, AbortController>();
let sponsors: Sponsor[] = [],
  loop: { a: number; b: number } | undefined;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let lastHover = "",
  lastVideo: HTMLVideoElement | null = null;
let pendingHover = "";
const getVideo = () =>
  document.querySelector<HTMLVideoElement>("video.html5-main-video");
function context(): Video {
  const v = getVideo();
  const watch = document.querySelector("ytd-watch-flexy");
  return {
    id: new URL(location.href).searchParams.get("v") || "",
    title:
      document.querySelector("ytd-watch-metadata h1")?.textContent?.trim() ||
      document.title.replace(/ - YouTube$/, ""),
    channel:
      document
        .querySelector("ytd-watch-metadata #channel-name")
        ?.textContent?.trim() || "",
    duration: Number.isFinite(v?.duration) ? v!.duration : 0,
    time: v?.currentTime ?? 0,
    dark: document.documentElement.hasAttribute("dark"),
    theatre: watch?.hasAttribute("theater") ?? false,
  };
}
function emit(event: string, data: unknown) {
  chrome.runtime.sendMessage({ event, data }).catch(() => {});
}
function cancelAll() {
  jobs.forEach((c) => c.abort());
  jobs.clear();
  sponsors = [];
  loop = undefined;
  active = false;
  lastHover = "";
  pendingHover = "";
  clearTimeout(hoverTimer);
  document.getElementById("yc-caption-tip")?.remove();
  document.getElementById("yc-focus-style")?.remove();
  document.getElementById("yc-manual-skip")?.remove();
}
function captionTip(p: any) {
  document.getElementById("yc-caption-tip")?.remove();
  if (!active || p.dismiss) return;
  const el = document.createElement("div");
  el.id = "yc-caption-tip";
  el.style.cssText =
    "position:absolute;right:20px;bottom:100px;width:min(340px,85%);z-index:80";
  const root = el.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent =
    ":host{color-scheme:light dark}section{padding:18px;border-radius:14px;background:#18191b;color:#f6f6f7;box-shadow:0 8px 30px #0008;border:1px solid #555;font:14px/1.55 system-ui;max-height:270px;overflow:auto}p{white-space:pre-wrap;margin:0 0 12px}nav{display:flex;flex-wrap:wrap;gap:8px}button,a{font:inherit;color:inherit;background:#303236;border:1px solid #555;border-radius:8px;padding:5px 9px;cursor:pointer}a{font-size:12px;text-decoration:none}button:focus-visible,a:focus-visible{outline:2px solid #ff7777}";
  root.append(style);
  const section = document.createElement("section");
  section.setAttribute("role", "dialog");
  section.setAttribute("aria-label", "Caption explanation");
  const text = document.createElement("p");
  text.textContent = p.text;
  section.append(text);
  const nav = document.createElement("nav");
  const action = (label: string, fn: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = fn;
    nav.append(b);
  };
  if (!p.loading) {
    action("Explain deeper", () =>
      emit("caption-action", {
        text: p.selection,
        context: p.context,
        action: "explain",
      }),
    );
    action("Check", () =>
      emit("caption-action", {
        text: p.selection,
        context: p.context,
        action: "check",
      }),
    );
  } else action("Stop", () => emit("caption-stop", {}));
  action("Close", () => {
    if (p.loading) emit("caption-stop", {});
    el.remove();
  });
  section.append(nav);
  for (const s of (p.sources ?? []).slice(0, 4)) {
    const url = safeUrl(s.url);
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.textContent = s.title;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      section.append(a);
    }
  }
  if (p.searchSuggestions)
    section.append(suggestionFragment(p.searchSuggestions));
  root.append(section);
  document.querySelector("#movie_player")?.append(el);
}
function placePanel() {
  if (location.pathname !== "/watch") {
    if (currentId) {
      cancelAll();
      currentId = "";
      emit("video-changed", null);
    }
    document
      .querySelector<HTMLElement>("ytd-watch-flexy")
      ?.removeAttribute("data-tubedeck-layout");
    host?.remove();
    return;
  }
  const ctx = context();
  if (!ctx.id) return;
  if (ctx.id !== currentId) {
    cancelAll();
    currentId = ctx.id;
    emit("video-changed", ctx);
  }
  if (!host) {
    host = document.createElement("div");
    host.id = "youtube-companion";
    host.style.cssText =
      "width:100%;min-width:0;display:block;margin:12px 0 20px;";
    frame = document.createElement("iframe");
    frame.title = "TubeDeck";
    frame.src = chrome.runtime.getURL("panel.html");
    frame.allow = "clipboard-write";
    frame.style.cssText =
      "width:100%;height:700px;border:0;display:block;color-scheme:light dark;border-radius:16px;";
    host.append(frame);
  }
  const watch = document.querySelector<HTMLElement>("ytd-watch-flexy");
  let layoutStyle = document.getElementById("tubedeck-layout-style");
  if (!layoutStyle) {
    layoutStyle = document.createElement("style");
    layoutStyle.id = "tubedeck-layout-style";
    layoutStyle.textContent = `
      ytd-watch-flexy[data-tubedeck-layout="side"] #columns { max-width:none !important; display:grid !important; grid-template-columns:380px minmax(0,1fr); gap:20px; padding:0 24px !important; }
      ytd-watch-flexy[data-tubedeck-layout="side"] #columns > #youtube-companion { grid-column:1; grid-row:1 / span 2; width:380px; align-self:flex-start; position:sticky; top:72px; margin:24px 0 !important; }
      ytd-watch-flexy[data-tubedeck-layout="side"] #columns > #primary { grid-column:2; grid-row:1; width:100% !important; min-width:0 !important; max-width:none !important; padding-left:0 !important; padding-right:0 !important; }
      ytd-watch-flexy[data-tubedeck-layout="side"] #columns > #secondary { grid-column:2; grid-row:2; width:100% !important; padding:0 !important; }
    `;
    document.head.append(layoutStyle);
  }
  const columns = watch?.querySelector<HTMLElement>("#columns");
  const side = !ctx.theatre && window.innerWidth >= 1100 && Boolean(columns);
  const layout = side ? "side" : "below";
  const changed = watch?.dataset.tubedeckLayout !== layout;
  if (watch) watch.dataset.tubedeckLayout = layout;
  const target = ctx.theatre
    ? document.querySelector("#full-bleed-container")
    : document.querySelector(
        "#player.ytd-watch-flexy, ytd-watch-flexy #player-container-outer",
      );
  const destination = side ? columns : target?.parentElement;
  const before = side ? columns?.firstElementChild : target?.nextSibling;
  if (destination && before !== host) {
    const parent = destination as HTMLElement & {
      moveBefore?: (node: Node, before: Node | null) => void;
    };
    if (host.isConnected && parent.moveBefore)
      parent.moveBefore(host, before || null);
    else parent.insertBefore(host, before || null);
  }
  host.style.cssText = side
    ? "display:block;min-width:0;"
    : "display:block;width:calc(100% - 32px);max-width:1600px;margin:16px auto;";
  if (frame) frame.style.height = `${frame.dataset.panelHeight || 700}px`;
  if (changed)
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  if (getVideo() !== lastVideo) {
    lastVideo?.removeEventListener("timeupdate", onTime);
    lastVideo = getVideo();
    lastVideo?.addEventListener("timeupdate", onTime);
  }
  emit("context", ctx);
}
function onTime() {
  const v = getVideo();
  if (!v || v.seeking || document.querySelector("#movie_player.ad-showing"))
    return;
  if (loop && v.currentTime >= loop.b) v.currentTime = loop.a;
  const s = sponsors.find(
    (s) => v.currentTime >= s.start && v.currentTime < s.end,
  );
  const old = document.getElementById("yc-manual-skip");
  if (s?.confidence === "clear") {
    v.currentTime = s.end;
    emit("skipped", s);
    old?.remove();
    return;
  }
  if (s && !old) {
    const b = document.createElement("button");
    b.id = "yc-manual-skip";
    b.textContent = "Skip possible sponsorship";
    b.style.cssText =
      "position:absolute;right:20px;bottom:70px;z-index:70;padding:12px 18px;background:#fff;color:#111;border:1px solid #ddd;border-radius:24px;font:600 14px system-ui;cursor:pointer";
    b.onclick = () => {
      v.currentTime = s.end;
      b.remove();
    };
    document.querySelector("#movie_player")?.append(b);
  }
  if (!s) old?.remove();
}
async function seek(t: number, signal: AbortSignal) {
  checkAbort(signal);
  const v = getVideo();
  if (!v) throw new Error("Video player is unavailable.");
  if (
    !Number.isFinite(v.duration) ||
    !Number.isFinite(t) ||
    t < 0 ||
    t > v.duration
  )
    throw new Error(
      "Timestamp is outside this video or the player is not ready.",
    );
  if (Math.abs(v.currentTime - t) < 0.08 && !v.seeking) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      v.removeEventListener("seeked", done);
      signal.removeEventListener("abort", stop);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const stop = () => {
      cleanup();
      reject(abortError());
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Video seek timed out."));
    }, 12000);
    v.addEventListener("seeked", done, { once: true });
    signal.addEventListener("abort", stop, { once: true });
    v.currentTime = t;
  });
  checkAbort(signal);
}
function capture() {
  const v = getVideo();
  if (!v || !v.videoWidth || v.readyState < 2)
    throw new Error("Wait for the video frame to load.");
  if (document.querySelector("#movie_player.ad-showing"))
    throw new Error("Wait for the YouTube ad to finish before capturing.");
  const canvas = document.createElement("canvas");
  const ratio = Math.min(1, 1600 / v.videoWidth);
  canvas.width = Math.round(v.videoWidth * ratio);
  canvas.height = Math.round(v.videoHeight * ratio);
  const c = canvas.getContext("2d");
  if (!c) throw new Error("Screenshot capture is unavailable.");
  c.drawImage(v, 0, 0, canvas.width, canvas.height);
  try {
    return { image: canvas.toDataURL("image/jpeg", 0.82), time: v.currentTime };
  } catch {
    throw new Error("This video does not allow frame capture in the browser.");
  }
}
async function execute(
  command: PageCommand,
  p: any,
  signal: AbortSignal,
  id: string,
) {
  checkAbort(signal);
  if (command === "context") return context();
  if (command === "caption-tip") {
    captionTip(p);
    return true;
  }
  if (command === "transcript")
    return extractTranscript(signal, (text) =>
      emit("page-progress", { id, text }),
    );
  if (command === "comments")
    return loadComments(signal, (comments) =>
      emit("page-progress", {
        id,
        text: `Loading comments · ${comments.items.length.toLocaleString()}`,
        comments,
      }),
    );
  if (command === "activation") {
    active = Boolean(p.active);
    if (!active) {
      sponsors = [];
      lastHover = "";
      clearTimeout(hoverTimer);
      document.getElementById("yc-caption-tip")?.remove();
      document.getElementById("yc-manual-skip")?.remove();
    }
    return true;
  }
  if (command === "seek") {
    await seek(p.time, signal);
    return context();
  }
  if (command === "capture") return capture();
  if (command === "capture-at") {
    const v = getVideo();
    if (!v) throw new Error("Video unavailable.");
    if (document.querySelector("#movie_player.ad-showing"))
      throw new Error("Wait for the YouTube ad to finish before capturing.");
    const time = v.currentTime,
      paused = v.paused,
      speed = v.playbackRate,
      id = currentId,
      oldSponsors = sponsors,
      oldLoop = loop;
    sponsors = [];
    loop = undefined;
    v.pause();
    try {
      await seek(p.time, signal);
      await sleep(180, signal);
      return capture();
    } finally {
      if (currentId === id && getVideo() === v) {
        try {
          await seek(time, new AbortController().signal);
        } catch {
          throw new Error(
            "Capture stopped, but the player could not return to the original position.",
          );
        } finally {
          v.playbackRate = speed;
          sponsors = active ? oldSponsors : [];
          loop = oldLoop;
          if (!paused) await v.play().catch(() => {});
        }
      }
    }
  }
  if (command === "speed") {
    const speed = Number(p.rate);
    if (![0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].includes(speed))
      throw new Error("Invalid speed.");
    const v = getVideo();
    if (v) v.playbackRate = speed;
    return true;
  }
  if (command === "loop") {
    if (
      p.enabled &&
      (!Number.isFinite(p.a) ||
        !Number.isFinite(p.b) ||
        p.a < 0 ||
        p.b <= p.a ||
        p.b > (getVideo()?.duration ?? 0))
    )
      throw new Error("Choose A and B inside this video, with B after A.");
    loop = p.enabled ? { a: p.a, b: p.b } : undefined;
    return true;
  }
  if (command === "focus") {
    let style = document.getElementById("yc-focus-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "yc-focus-style";
      document.head.append(style);
    }
    style.textContent = `${p.recommendations ? "ytd-watch-flexy #related{display:none!important}" : ""}${p.comments ? "ytd-comments#comments{display:none!important}" : ""}`;
    return true;
  }
  if (command === "sponsors") {
    sponsors = p.segments ?? [];
    document.getElementById("yc-manual-skip")?.remove();
    return sponsors;
  }
  throw new Error("Unknown player action.");
}
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (sender.id !== chrome.runtime.id || m.type !== "page") return;
  if (m.command === "cancel") {
    jobs.get(m.payload?.id)?.abort();
    respond({ ok: true });
    return;
  }
  if (m.videoId && m.videoId !== context().id) {
    respond({
      ok: false,
      error: "The video changed. Activate the current video to continue.",
    });
    return;
  }
  const controller = new AbortController();
  jobs.set(m.id, controller);
  execute(m.command, m.payload ?? {}, controller.signal, m.id)
    .then((data) => respond({ ok: true, data }))
    .catch((e) =>
      respond({
        ok: false,
        error: controller.signal.aborted ? "Stopped" : e.message,
      }),
    )
    .finally(() => jobs.delete(m.id));
  return true;
});
window.addEventListener("message", (event) => {
  if (
    event.source !== frame?.contentWindow ||
    event.origin !== new URL(chrome.runtime.getURL("/")).origin
  )
    return;
  if (event.data?.type === "yc-resize" && frame) {
    const height = panelHeight(event.data.height);
    if (height === undefined) return;
    frame.dataset.panelHeight = String(height);
    frame.style.height = `${height}px`;
  }
});
document.addEventListener("pointermove", (event) => {
  if (!active) return;
  const target = (event.target as Element)?.closest(".ytp-caption-segment");
  if (!target) return;
  const context = target.textContent?.trim() ?? "";
  // Read the word under the pointer without replacing YouTube's caption nodes.
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
  const text =
    range &&
    range.startContainer.nodeType === Node.TEXT_NODE &&
    target.contains(range.startContainer)
      ? wordAt(range.startContainer.textContent ?? "", range.startOffset) ||
        context
      : context;
  const key = `${text}:${context}`;
  if (!text || key === lastHover || key === pendingHover) return;
  if (hoverTimer) clearTimeout(hoverTimer);
  pendingHover = key;
  hoverTimer = setTimeout(() => {
    pendingHover = "";
    if (
      !active ||
      !target.isConnected ||
      target.textContent?.trim() !== context
    )
      return;
    lastHover = key;
    emit("caption-hover", {
      text,
      context,
      time: getVideo()?.currentTime ?? 0,
    });
  }, 900);
});
document.addEventListener("pointerout", (event) => {
  if (
    (event.target as Element)?.closest(".ytp-caption-segment") &&
    hoverTimer
  ) {
    clearTimeout(hoverTimer);
    pendingHover = "";
  }
});
window.addEventListener("resize", placePanel);
document.addEventListener("yt-navigate-finish", placePanel);
document.addEventListener("yt-page-data-updated", placePanel);
let scheduled = false;
new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    placePanel();
  }, 350);
}).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["dark", "theater"],
  childList: true,
  subtree: true,
});
placePanel();
