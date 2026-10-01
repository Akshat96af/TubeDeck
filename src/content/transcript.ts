// Transcript UI fallbacks informed by Distill (MIT). See THIRD_PARTY_NOTICES.md.
// Collect every encountered segment while scrolling: virtualized DOM nodes can be recycled.
import type { Segment, Transcript } from "../shared/types";
import { checkAbort, parseTime, sleep } from "../shared/utils";
const selectors =
  "transcript-segment-view-model, ytd-transcript-segment-renderer";
function first(root: Element, names: string[]) {
  for (const n of names) {
    const el = root.querySelector(n);
    if (el) return el;
  }
  return null;
}
function scrollParent(el: Element): HTMLElement | null {
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    if (
      parent.scrollHeight > parent.clientHeight + 20 &&
      ["auto", "scroll"].includes(getComputedStyle(parent).overflowY)
    )
      return parent;
    parent = parent.parentElement;
  }
  return null;
}
export async function extractTranscript(
  signal: AbortSignal,
  progress: (text: string) => void,
): Promise<Transcript> {
  const segments = new Map<string, Segment>();
  let opened = false;
  let scroll: HTMLElement | null = null;
  let previousScroll = 0;
  try {
    if (!document.querySelector(selectors)) {
      document
        .querySelector<HTMLElement>(
          "ytd-text-inline-expander #expand, tp-yt-paper-button#expand",
        )
        ?.click();
      await sleep(300, signal);
      const button = Array.from(
        document.querySelectorAll<HTMLElement>("button,ytd-button-renderer"),
      ).find(
        (el) =>
          /show transcript/i.test(
            el.getAttribute("aria-label") || el.textContent || "",
          ) && el.offsetParent !== null,
      );
      if (button) {
        button.click();
        opened = true;
      }
      for (let i = 0; i < 24 && !document.querySelector(selectors); i++)
        await sleep(250, signal);
    }
    const initial = document.querySelector(selectors);
    if (!initial)
      throw new Error(
        "No accessible transcript found. Open YouTube’s Show transcript panel and retry, or paste a transcript.",
      );
    scroll = scrollParent(initial);
    previousScroll = scroll?.scrollTop ?? 0;
    if (scroll) scroll.scrollTop = 0;
    let stable = 0,
      previousSize = -1,
      finished = false;
    for (let step = 0; step < 2000; step++) {
      checkAbort(signal);
      document.querySelectorAll(selectors).forEach((el) => {
        const stamp = first(el, [
          ".ytwTranscriptSegmentViewModelTimestamp",
          ".segment-timestamp",
          '[class*="Timestamp"]',
        ]);
        const body = first(el, [
          ".ytAttributedStringHost",
          ".segment-text",
          ".yt-core-attributed-string",
          'span[role="text"]',
        ]);
        const text = body?.textContent?.trim();
        const start = parseTime(stamp?.textContent ?? "");
        if (text) segments.set(`${start}:${text}`, { start, end: null, text });
      });
      progress(`Reading transcript · ${segments.size.toLocaleString()} lines`);
      const bottom =
        !scroll ||
        scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 8;
      stable = segments.size === previousSize && bottom ? stable + 1 : 0;
      previousSize = segments.size;
      if (stable >= 4) {
        finished = true;
        break;
      }
      if (scroll) scroll.scrollTop += Math.max(100, scroll.clientHeight * 0.75);
      await sleep(200, signal);
    }
    const result = [...segments.values()].sort(
      (a, b) => (a.start ?? Infinity) - (b.start ?? Infinity),
    );
    for (let i = 0; i < result.length - 1; i++)
      result[i].end = result[i + 1].start;
    if (!result.length)
      throw new Error(
        "Transcript opened, but its text could not be read. Paste a transcript to continue.",
      );
    return {
      segments: result,
      source: "youtube",
      complete: finished,
      detail: finished
        ? "Reached the end of YouTube’s available transcript."
        : "Transcript retrieval stopped before reaching the end.",
    };
  } finally {
    if (scroll) scroll.scrollTop = previousScroll;
    if (opened)
      document
        .querySelector<HTMLElement>(
          'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] #visibility-button button',
        )
        ?.click();
  }
}
