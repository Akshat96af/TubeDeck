import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIRequest } from "../src/shared/types";
vi.mock("../src/background/storage", () => ({
  getGeminiKey: async () => "test-key-not-a-credential",
  getSettings: async () => ({ model: "gemini-flash-latest" }),
}));
import { generate } from "../src/background/gemini";
const base: AIRequest = {
  kind: "chat",
  video: {
    id: "abcdefghijk",
    title: "A test video",
    channel: "Test",
    duration: 90,
    time: 0,
    dark: false,
    theatre: false,
  },
  transcript: {
    source: "pasted",
    complete: false,
    detail: "User supplied excerpt",
    segments: [{ start: 0, end: 10, text: "Evidence from the video." }],
  },
  question: "What did the speaker say?",
};
function response(text: string, extra: Record<string, unknown> = {}) {
  return new Response(
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP", ...extra }], usageMetadata: { totalTokenCount: 20 } })}\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
describe("Gemini request and evidence boundaries", () => {
  const fetcher = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetcher.mockReset();
    vi.stubGlobal("fetch", fetcher);
  });
  afterEach(() => vi.unstubAllGlobals());
  it("uses key headers, full transcript provenance and conversation context", async () => {
    fetcher.mockResolvedValue(
      response("At [0:00], the speaker explains this."),
    );
    const r = await generate(
      {
        ...base,
        history: [
          { id: "a", role: "user", text: "Earlier question" },
          { id: "b", role: "assistant", text: "Earlier answer" },
        ],
      },
      new AbortController().signal,
      () => {},
    );
    const [url, init] = fetcher.mock.calls[0];
    expect(url).not.toContain("test-key");
    expect((init!.headers as Record<string, string>)["x-goog-api-key"]).toBe(
      "test-key-not-a-credential",
    );
    const body = JSON.parse(init!.body as string);
    expect(body.contents).toHaveLength(3);
    expect(body.contents[2].parts[0].text).toContain("User supplied excerpt");
    expect(body.contents[2].parts[0].text).toContain("[0:00] Evidence");
    expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("test-key");
    expect(r.tokens).toBe(20);
  });
  it("only marks web evidence returned by grounding metadata as search evidence", async () => {
    fetcher.mockResolvedValue(response("A claim about the world."));
    const r = await generate(
      { ...base, kind: "check" },
      new AbortController().signal,
      () => {},
    );
    expect(r.searchUsed).toBe(false);
    expect(r.sources).toEqual([]);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).tools).toEqual([
      { google_search: {} },
    ]);
  });
  it("preserves real grounding attribution and rejects executable links", async () => {
    fetcher.mockResolvedValue(
      response("Evidence", {
        groundingMetadata: {
          webSearchQueries: ["some claim"],
          groundingChunks: [
            { web: { title: "Source", uri: "https://example.test/evidence" } },
            { web: { title: "bad", uri: "javascript:alert(1)" } },
          ],
          searchEntryPoint: {
            renderedContent: "<div>Google Search suggestions</div>",
          },
        },
      }),
    );
    const r = await generate(
      { ...base, kind: "explain" },
      new AbortController().signal,
      () => {},
    );
    expect(r.searchUsed).toBe(true);
    expect(r.sources).toEqual([
      { title: "Source", url: "https://example.test/evidence" },
    ]);
    expect(r.searchSuggestions).toContain("Google Search");
  });
  it("does not retry a quota error or expose the provider error body", async () => {
    fetcher.mockResolvedValue(
      new Response("sensitive upstream body", { status: 429 }),
    );
    await expect(
      generate(base, new AbortController().signal, () => {}),
    ).rejects.toThrow("quota");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not start a cancelled request", async () => {
    const c = new AbortController();
    c.abort();
    await expect(generate(base, c.signal, () => {})).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("fails closed on truncated structured output", async () => {
    fetcher.mockResolvedValue(
      response('{"moments":[', { finishReason: "MAX_TOKENS" }),
    );
    await expect(
      generate(
        { ...base, kind: "capture-plan" },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("output limit");
  });
  it("includes every comment batch including the minority tail", async () => {
    fetcher.mockImplementation(async () =>
      response("One batch report [comment:tail]"),
    );
    const comments = {
      items: [
        {
          id: "long",
          author: "A",
          text: "a".repeat(51000),
          likes: "0",
          url: "https://www.youtube.com/watch?v=abcdefghijk&lc=long",
        },
        {
          id: "tail",
          author: "B",
          text: "A minority disagreement",
          likes: "0",
          url: "https://www.youtube.com/watch?v=abcdefghijk&lc=tail",
        },
      ],
      complete: false,
      detail: "Partial retrieval",
    };
    const r = await generate(
      { ...base, kind: "comments", comments },
      new AbortController().signal,
      () => {},
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    const prompts = fetcher.mock.calls.map(
      (c) => JSON.parse(c[1]!.body as string).contents.at(-1).parts[0].text,
    );
    expect(prompts[1]).toContain("A minority disagreement");
    expect(prompts[2]).toContain("2 retrieved top-level comments");
    expect(prompts[2]).toContain("Partial retrieval");
    expect(r.tokens).toBe(60);
  });
  it("stops before starting another comment batch after cancellation", async () => {
    const c = new AbortController();
    fetcher.mockResolvedValue(response("Batch report"));
    let passes = 0;
    const comments = {
      items: [
        {
          id: "a",
          author: "A",
          text: "a".repeat(51000),
          likes: "0",
          url: "https://example.test/a",
        },
        {
          id: "b",
          author: "B",
          text: "tail",
          likes: "0",
          url: "https://example.test/b",
        },
      ],
      complete: true,
      detail: "Reached end",
    };
    await expect(
      generate(
        { ...base, kind: "comments", comments },
        c.signal,
        () => {},
        () => {
          if (++passes === 2) c.abort();
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
