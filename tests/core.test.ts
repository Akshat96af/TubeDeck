import { describe, it, expect } from "vitest";
import {
  parseTime,
  parseTranscript,
  timeLabel,
  cleanSponsors,
  usableFormats,
  safeSources,
} from "../src/shared/utils";
import { readSSE } from "../src/shared/sse";
import { capsule, capsuleZip } from "../src/shared/capsule";
import { batches } from "../src/shared/batches";
import { choices } from "../src/download/remux";
import { unzipSync, strFromU8 } from "fflate";
import type { Snapshot, MediaFormat } from "../src/shared/types";

describe("transcript provenance", () => {
  it("preserves untimed text and real timestamps", () => {
    const t = parseTranscript(
      "Opening without time\n[01:20] First point\n01:25 Second point",
    );
    expect(t.complete).toBe(false);
    expect(t.segments.map((s) => s.start)).toEqual([null, 80, 85]);
    expect(t.segments[1].end).toBe(85);
  });
  it("rejects malformed times", () => {
    expect(parseTime("1:60")).toBeNull();
    expect(parseTime("hi")).toBeNull();
    expect(parseTime("1:20:30")).toBe(4830);
    expect(timeLabel(null)).toBe("Untimed");
  });
});
describe("source and media boundaries", () => {
  it("discards executable and duplicate research links", () =>
    expect(
      safeSources([
        { title: "a", url: "javascript:alert(1)" },
        { title: "b", url: "https://example.com" },
        { title: "c", url: "https://example.com/" },
      ]),
    ).toHaveLength(1));
  const f = (
    itag: number,
    mimeType: string,
    extra: Partial<MediaFormat> = {},
  ): MediaFormat => ({
    itag,
    mimeType,
    url: "https://r1.googlevideo.com/videoplayback",
    ...extra,
  });
  it("never upgrades resolution or silently returns video without audio", () => {
    const available = [
      f(1, "video/webm", { height: 2160 }),
      f(2, "audio/webm", { bitrate: 128000 }),
      f(3, "video/mp4", { height: 1080 }),
      f(4, "video/webm", { height: 4320 }),
    ];
    expect(
      choices(available).map((c) => [c.video.height, c.audio?.itag]),
    ).toEqual([[2160, 2]]);
  });
  it("rejects cipher-only, deceptive hosts and insecure media", () =>
    expect(
      usableFormats([
        f(1, "video/mp4", { url: "https://googlevideo.com.evil.test/a" }),
        f(2, "video/mp4", { cipher: "encrypted" }),
        f(3, "video/mp4", { url: "http://r1.googlevideo.com/a" }),
      ]),
    ).toEqual([]));
  it("allows progressive sources that expose audio", () =>
    expect(
      choices([f(1, "video/mp4", { height: 720, audioQuality: "medium" })]),
    ).toHaveLength(1));
  it("rejects invalid sponsor ranges", () => {
    const base = { confidence: "clear" as const, reason: "Paid sponsor" };
    expect(
      cleanSponsors(
        [
          { ...base, start: -1, end: 4 },
          { ...base, start: 2, end: 500 },
          { ...base, start: 50, end: 45 },
          { ...base, start: 10, end: 25 },
        ],
        120,
      ),
    ).toEqual([{ ...base, start: 10, end: 25 }]);
  });
});
describe("streaming and cancellation", () => {
  it("decodes UTF-8 and CRLF split across single-byte chunks", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"text":"हाय"}\r\n\r\ndata: {"next":true}\n\ndata: [DONE]\n\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const b of bytes) c.enqueue(new Uint8Array([b]));
        c.close();
      },
    });
    const items = [];
    for await (const item of readSSE(stream, new AbortController().signal))
      items.push(item);
    expect(items).toEqual([{ text: "हाय" }, { next: true }]);
  });
  it("aborts a pending read without starting another", async () => {
    let cancel = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancel = true;
      },
    });
    const c = new AbortController();
    const read = readSSE(stream, c.signal).next();
    c.abort();
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toBe(true);
  });
  it("surfaces malformed server events", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("data: invalid\n\n"));
        c.close();
      },
    });
    await expect(
      readSSE(stream, new AbortController().signal).next(),
    ).rejects.toThrow();
  });
});
describe("complete coverage and portable context", () => {
  it("batches without silently dropping a long comment or minority tail", () => {
    const records = [
      "a",
      "b",
      "very long individual comment",
      "last minority opinion",
    ];
    const result = batches(records, (s) => s.length, 5);
    expect(result.flat()).toEqual(records);
    expect(result).toHaveLength(3);
  });
  const snapshot: Snapshot = {
    video: {
      id: "abcdefghijk",
      title: "Example",
      channel: "Channel",
      duration: 120,
      time: 0,
      dark: false,
      theatre: false,
    },
    active: true,
    settings: {
      model: "model",
      firebaseApiKey: "PRIVATE_CONFIG_SENTINEL",
      googleClientId: "CLIENT_SENTINEL",
      rememberKey: false,
      hasKey: true,
    },
    user: { name: "Private name", email: "PRIVATE_EMAIL_SENTINEL" },
    messages: [
      { id: "m", role: "assistant", text: "Partial answer", incomplete: true },
    ],
    notes: [
      {
        id: "n",
        videoId: "abcdefghijk",
        videoTitle: "Example",
        time: 12,
        title: "Diagram",
        body: "Visible diagram",
        image: "data:image/jpeg;base64,AQID",
        createdAt: 0,
        kind: "screenshot",
      },
    ],
    sources: [],
    tokens: 100,
    transcript: parseTranscript("00:00 Hello"),
  };
  it("exports evidence and incompleteness without account/configuration data", () => {
    const text = capsule(snapshot);
    expect(text).toContain("[0:00] Hello");
    expect(text).toContain("incomplete");
    expect(text).not.toContain("PRIVATE_");
    expect(text).not.toContain("CLIENT_SENTINEL");
  });
  it("includes actual image bytes in the ZIP", () => {
    const zip = unzipSync(capsuleZip(snapshot));
    expect([...zip["images/n.jpg"]]).toEqual([1, 2, 3]);
    expect(strFromU8(zip["context.md"])).toContain("images/n.jpg");
  });
});
