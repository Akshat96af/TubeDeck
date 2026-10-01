import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
await mkdir("artifacts", { recursive: true });
const extension = path.resolve("dist");
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  viewport: { width: 1440, height: 1200 },
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
const errors = [];
let realAiCalls = 0;
context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
const fixture = `<!doctype html><html dark><head><title>Testing a useful video - YouTube</title><style>body{margin:0;background:#0f0f0f;color:#eee;font:14px Arial;padding:32px}ytd-watch-flexy{display:block}#player{width:980px}#movie_player{position:relative;background:#242424;height:240px}#full-bleed-container{width:100%}#primary{width:980px}ytd-comments{display:block;margin-top:24px}ytd-comment-thread-renderer{display:block;padding:20px}#transcript{max-height:100px;overflow-y:auto}ytd-transcript-segment-renderer{display:block;padding:10px}.ytp-caption-segment{position:absolute;bottom:20px;left:30px;font-size:20px}</style></head><body><ytd-watch-flexy><div id="full-bleed-container"></div><div id="primary"><div id="player" class="ytd-watch-flexy"><div id="movie_player"><video class="html5-main-video"></video><span class="ytp-caption-segment">An unusually complex reference</span></div></div><ytd-watch-metadata><h1>Testing a useful video</h1><div id="channel-name">Fixture channel</div></ytd-watch-metadata><div id="transcript">${[
  "00:00|Welcome to the video.",
  "00:10|This episode is sponsored by Example.",
  "00:25|Back to our discussion.",
  "00:40|An unusually complex reference.",
]
  .map((t) => {
    const [time, text] = t.split("|");
    return `<ytd-transcript-segment-renderer><span class="segment-timestamp">${time}</span><span class="segment-text">${text}</span></ytd-transcript-segment-renderer>`;
  })
  .join(
    "",
  )}</div><ytd-comments id="comments">${["Useful explanation", "I disagree with the conclusion", "What camera was used?"].map((text, i) => `<ytd-comment-thread-renderer><ytd-comment-view-model><span id="author-text">Viewer ${i}</span><p id="content-text">${text}</p><span id="vote-count-middle">2</span><a href="/watch?v=abcdefghijk&lc=comment${i}">time</a></ytd-comment-view-model></ytd-comment-thread-renderer>`).join("")}</ytd-comments></div><aside id="related">Related videos</aside></ytd-watch-flexy><script>Object.defineProperty(document.querySelector('video'),'duration',{get:()=>120});window.ytInitialPlayerResponse={videoDetails:{videoId:'abcdefghijk'},streamingData:{formats:[],adaptiveFormats:[]}};</script></body></html>`;
try {
  await context.route("https://www.youtube.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: fixture }),
  );
  await context.route(
    "https://generativelanguage.googleapis.com/**",
    (route) => {
      realAiCalls++;
      return route.abort();
    },
  );
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("https://www.youtube.com/watch?v=abcdefghijk");
  const panel = page.frameLocator("#youtube-companion iframe");
  await panel
    .getByRole("heading", { name: "Watch. Wonder. Go a little deeper." })
    .waitFor();
  assert.equal(
    await page.locator("#player + #youtube-companion").count(),
    1,
    "Panel should mount below normal player",
  );
  await page.screenshot({
    path: "artifacts/integrated-dark.png",
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "Activate for this video", exact: true })
    .click();
  await panel
    .getByRole("alert")
    .filter({ hasText: "Sign in with Google" })
    .waitFor();
  assert.equal(
    realAiCalls,
    0,
    "Unauthenticated activation must not call Gemini",
  );
  // A synthetic auth session and fake Gemini transport exist ONLY in the test worker.
  await worker.evaluate(async () => {
    await chrome.storage.session.set({
      geminiKey: "TEST-ONLY-NOT-A-REAL-KEY",
      auth: {
        idToken: "fixture-token",
        refreshToken: "fixture-refresh",
        expiresAt: Date.now() + 3600000,
        user: { name: "Fixture tester", email: "fixture@example.test" },
      },
    });
    globalThis.fixtureCalls = 0;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith("https://generativelanguage.googleapis.com/"))
        throw new Error("Unexpected external request in test");
      globalThis.fixtureCalls++;
      const body = JSON.parse(options.body),
        prompt = body.contents.at(-1).parts[0].text;
      let text = "The video welcomes viewers at [0:00].";
      if (prompt.startsWith("Return JSON"))
        text = JSON.stringify({
          actions: ["What is the main idea?"],
          productsMentioned: false,
        });
      else if (prompt.startsWith("Summarize the supplied"))
        text =
          "Viewers include both praise and disagreement. Three top-level comments were available.";
      else if (prompt.startsWith("Explain the selected"))
        text = "This is a test explanation based on the supplied context.";
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            if (prompt.includes("slow response")) {
              options.signal.addEventListener(
                "abort",
                () =>
                  controller.error(new DOMException("Stopped", "AbortError")),
                { once: true },
              );
              return;
            }
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { totalTokenCount: 30 } })}\r\n\r\n`,
              ),
            );
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
  });
  await panel
    .getByRole("button", { name: "Activate for this video", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "What is the main idea?", exact: true })
    .waitFor({ timeout: 15000 });
  assert.equal(await worker.evaluate(() => globalThis.fixtureCalls), 1);
  await panel
    .getByRole("textbox", { name: "Ask about this video" })
    .fill("What happened?");
  await panel.getByRole("button", { name: "Send question" }).click();
  await panel
    .getByText("The video welcomes viewers at", { exact: false })
    .waitFor();
  await panel.getByRole("button", { name: "Notes", exact: true }).click();
  await panel
    .getByRole("textbox", { name: "New note" })
    .fill("A note kept locally");
  await panel
    .getByRole("button", { name: "Save note at current time" })
    .click();
  await panel
    .getByText("A note kept locally", { exact: false })
    .first()
    .waitFor();
  await panel.getByRole("button", { name: "Comments", exact: true }).click();
  await panel
    .getByRole("button", { name: "Load comments", exact: true })
    .click();
  await panel
    .getByText("Viewers include both praise and disagreement.", {
      exact: false,
    })
    .waitFor({ timeout: 18000 });
  await panel
    .getByRole("textbox", { name: "Find or ask about comments" })
    .fill("camera");
  assert.equal(await panel.locator(".comment-list article").count(), 1);
  await panel.getByRole("button", { name: "Transcript", exact: true }).click();
  await panel
    .locator(".transcript-line p span")
    .filter({ hasText: "unusually" })
    .hover();
  await panel
    .getByRole("dialog", { name: "Quick explanation" })
    .getByText("This is a test explanation", { exact: false })
    .waitFor();
  await panel.getByRole("button", { name: "Close quick explanation" }).click();
  await panel.getByRole("button", { name: "Chat", exact: true }).click();
  await panel
    .getByRole("textbox", { name: "Ask about this video" })
    .fill("slow response");
  await panel.getByRole("button", { name: "Send question" }).click();
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await panel.getByText("Stopped. Completed results have been kept.").waitFor();
  // Reparenting an iframe can reload it: state must be recoverable from the worker.
  await page.evaluate(() =>
    document.querySelector("ytd-watch-flexy").setAttribute("theater", ""),
  );
  await page.waitForTimeout(900);
  assert.equal(
    await page.locator("#full-bleed-container + #youtube-companion").count(),
    1,
  );
  await panel.getByText("This video is connected").waitFor();
  await page.screenshot({
    path: "artifacts/integrated-theatre.png",
    fullPage: true,
  });
  const previousCalls = await worker.evaluate(() => globalThis.fixtureCalls);
  await page.evaluate(() => {
    history.pushState({}, "", "/watch?v=123456789ab");
    document.querySelector("ytd-watch-metadata h1").textContent =
      "A different video";
    document.dispatchEvent(new Event("yt-navigate-finish"));
  });
  await panel.getByText("Ready when you are").waitFor();
  assert.equal(
    await worker.evaluate(() => globalThis.fixtureCalls),
    previousCalls,
  );
  await panel.getByRole("button", { name: "Notes", exact: true }).click();
  assert.equal(
    await panel.getByText("A note kept locally", { exact: false }).count(),
    0,
  );
  await page.evaluate(() => {
    history.pushState({}, "", "/watch?v=abcdefghijk");
    document.dispatchEvent(new Event("yt-navigate-finish"));
  });
  await panel
    .getByText("A note kept locally", { exact: false })
    .first()
    .waitFor();
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${id}/settings.html`);
  await settings.getByRole("heading", { name: "Your Companion" }).waitFor();
  assert.equal(await settings.locator("input[type=password]").inputValue(), "");
  const download = await context.newPage();
  const tab = await worker.evaluate(async () => {
    const [t] = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
    return t.id;
  });
  await download.goto(`chrome-extension://${id}/download.html?tab=${tab}`);
  await download
    .getByText("No downloadable source with audio is available")
    .waitFor();
  await download.screenshot({
    path: "artifacts/download-empty.png",
    fullPage: true,
  });
  assert.deepEqual(errors, [], "No page runtime errors");
  assert.equal(
    realAiCalls,
    0,
    "Tests must never reach the real Gemini service",
  );
  console.log(
    "Browser integration passed: real extension mount, auth gate, activation, streaming chat, notes, comments, hover, cancellation, theatre layout, navigation isolation, settings and download unavailable state. Gemini and YouTube were controlled fixtures; no live credentials used.",
  );
} finally {
  await context.close();
}
