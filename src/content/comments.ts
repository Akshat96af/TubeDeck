import type { Comment, CommentSet } from "../shared/types";
import { sleep } from "../shared/utils";
export async function loadComments(
  signal: AbortSignal,
  progress: (data: CommentSet) => void,
): Promise<CommentSet> {
  const collected = new Map<string, Comment>();
  const y = window.scrollY;
  const state = (): CommentSet => ({
    items: [...collected.values()],
    complete: false,
    detail: "Partial: retrieved top-level comments only.",
  });
  try {
    const area = document.querySelector<HTMLElement>("ytd-comments#comments");
    if (!area) throw new Error("Comments are unavailable on this page.");
    area.scrollIntoView({ block: "start" });
    await sleep(900, signal);
    // Newest first avoids a relevance-ranked subset. Restore the original sort afterward is not
    // reliable across YouTube layouts, so this loader keeps the user's current sorting intact.
    let stalled = 0,
      lastCount = 0;
    while (!signal.aborted) {
      const threads = Array.from(
        area.querySelectorAll("ytd-comment-thread-renderer"),
      );
      for (const thread of threads) {
        const root = thread.querySelector(
          "ytd-comment-view-model, ytd-comment-renderer",
        );
        if (!root) continue;
        const text = root.querySelector("#content-text")?.textContent?.trim();
        if (!text) continue;
        const permalink = Array.from(
          root.querySelectorAll<HTMLAnchorElement>("a[href]"),
        ).find((a) => a.href.includes("lc="));
        const commentId = permalink
          ? new URL(permalink.href).searchParams.get("lc")
          : null;
        const author =
          root.querySelector("#author-text")?.textContent?.trim() || "Viewer";
        const id = commentId || `${author}:${text}`;
        collected.set(id, {
          id,
          author,
          text,
          likes:
            root.querySelector("#vote-count-middle")?.textContent?.trim() ||
            "0",
          url: permalink?.href || location.href,
        });
      }
      progress(state());
      const continuations = Array.from(
        area.querySelectorAll<HTMLElement>("ytd-continuation-item-renderer"),
      ).filter((el) => !el.closest("ytd-comment-replies-renderer"));
      const next = continuations.at(-1);
      stalled = collected.size === lastCount ? stalled + 1 : 0;
      lastCount = collected.size;
      if (!next && threads.length && stalled >= 3)
        return {
          ...state(),
          complete: true,
          detail:
            "Reached the end of accessible top-level comments in YouTube’s selected sort order. Hidden and filtered comments may be unavailable.",
        };
      if (stalled >= 15)
        return {
          ...state(),
          detail: collected.size
            ? "Partial: YouTube stopped loading more comments."
            : "No comments loaded. Comments may be disabled, restricted, or still loading.",
        };
      (next || threads.at(-1) || area).scrollIntoView({ block: "end" });
      next?.querySelector<HTMLElement>("button")?.click();
      await sleep(900, signal);
    }
    return { ...state(), detail: "Partial: loading was stopped." };
  } catch (error) {
    if (signal.aborted)
      return { ...state(), detail: "Partial: loading was stopped." };
    if (collected.size)
      return {
        ...state(),
        detail:
          "Partial: comment loading failed. You can still search the comments retrieved.",
      };
    throw error;
  } finally {
    window.scrollTo({ top: y, behavior: "instant" });
  }
}
