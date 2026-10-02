import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "../src/background/retry";
import { jsonCaptions } from "../src/shared/captions";
import { readCaptions } from "../src/background/captions";
import { readMedia } from "../src/background/media";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("temporary Gemini failures", () => {
  it("backs off for 503 then returns the successful stream", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("answer"));
    vi.stubGlobal("fetch", fetcher);
    const progress = vi.fn();
    const pending = fetchWithRetry(
      "https://example.test",
      {},
      new AbortController().signal,
      progress,
    );
    await vi.runAllTimersAsync();
    expect(await (await pending).text()).toBe("answer");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledWith(expect.stringContaining("retry 1/2"));
  });
  it("stops after two retries and does not retry quota errors", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockImplementation(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const pending = fetchWithRetry(
      "https://example.test",
      {},
      new AbortController().signal,
      () => {},
    );
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockClear().mockResolvedValue(new Response(null, { status: 429 }));
    expect(
      (
        await fetchWithRetry(
          "https://example.test",
          {},
          new AbortController().signal,
          () => {},
        )
      ).status,
    ).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("cancels before another request when stopped during backoff", async () => {
    const controller = new AbortController();
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      fetchWithRetry("https://example.test", {}, controller.signal, () =>
        controller.abort(),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("caption fallback", () => {
  it("preserves timed words and skips non-caption events", () => {
    const transcript = jsonCaptions({
      events: [
        { tStartMs: 0 },
        {
          tStartMs: 2000,
          dDurationMs: 1500,
          segs: [{ utf8: "Hello " }, { utf8: "world\n" }],
        },
      ],
    });
    expect(transcript.segments).toEqual([
      { start: 2, end: 3.5, text: "Hello world" },
    ]);
    expect(() => jsonCaptions({ events: [] })).toThrow("no readable text");
  });
  it("uses only YouTube caption endpoints and falls through empty tracks", async () => {
    vi.stubGlobal("chrome", {
      scripting: {
        executeScript: async () => [
          {
            result: [
              { url: "https://evil.example/api/timedtext" },
              { url: "https://www.youtube.com/api/timedtext?v=abcdefghijk" },
            ],
          },
        ],
      },
    });
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          events: [{ tStartMs: 0, segs: [{ utf8: "Evidence" }] }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await readCaptions(
      1,
      "abcdefghijk",
      new AbortController().signal,
    );
    expect(result.segments[0].text).toBe("Evidence");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("fmt=json3");
  });
});

describe("download discovery", () => {
  it("finds formats beyond an empty current response and rejects stale videos", async () => {
    const id = "abcdefghijk";
    vi.stubGlobal("location", {
      href: `https://www.youtube.com/watch?v=${id}`,
    });
    vi.stubGlobal("document", {
      getElementById: () => ({
        getPlayerResponse: () => ({ videoDetails: { videoId: id } }),
      }),
    });
    vi.stubGlobal("window", {
      ytInitialPlayerResponse: {
        videoDetails: { videoId: "stalevideo1" },
        streamingData: { formats: [{ itag: 99 }] },
      },
      ytplayer: {
        config: {
          args: {
            player_response: JSON.stringify({
              videoDetails: { videoId: id },
              streamingData: {
                formats: [
                  {
                    itag: 18,
                    url: "https://r.googlevideo.com/videoplayback",
                    height: 360,
                    mimeType: "video/mp4",
                  },
                ],
              },
            }),
          },
        },
      },
    });
    vi.stubGlobal("chrome", {
      scripting: {
        executeScript: async ({ func }: any) => [{ result: func() }],
      },
    });
    const media = await readMedia(1);
    expect(media.formats.map((f) => f.itag)).toEqual([18]);
  });
});

describe("caption network permissions", () => {
  it("allows the caption endpoint through both host permissions and CSP", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"),
    );
    expect(manifest.host_permissions).toContain("https://www.youtube.com/*");
    const connect = manifest.content_security_policy.extension_pages
      .split(";")
      .find((directive: string) => directive.trim().startsWith("connect-src"));
    expect(connect.split(/\s+/)).toContain("https://www.youtube.com");
  });
});
