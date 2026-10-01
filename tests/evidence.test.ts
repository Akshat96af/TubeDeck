import { it, expect } from "vitest";
import { validatedSponsors } from "../src/shared/evidence";
import { parseTranscript } from "../src/shared/utils";
import { capsuleZip, capsule } from "../src/shared/capsule";
import { unzipSync } from "fflate";
import type { Snapshot } from "../src/shared/types";
it("only auto-skips disclosed sponsorships with transcript-supported boundaries", () => {
  const t = parseTranscript(
    "00:10 This episode is sponsored by Example.\n00:25 Back to the topic.",
  );
  expect(
    validatedSponsors(
      [{ start: 10, end: 25, confidence: "clear", reason: "disclosed" }],
      90,
      t,
    )[0].confidence,
  ).toBe("clear");
  expect(
    validatedSponsors(
      [
        {
          start: 10,
          end: 24,
          confidence: "clear",
          reason: "boundary tolerance",
        },
      ],
      90,
      t,
    )[0].confidence,
  ).toBe("clear");
  expect(
    validatedSponsors(
      [{ start: 10, end: 23, confidence: "clear", reason: "guessed ending" }],
      90,
      t,
    )[0].confidence,
  ).toBe("uncertain");
});
it("downgrades ordinary product mentions and overlapping sponsorship guesses", () => {
  const mention = parseTranscript(
    "00:10 I like this camera.\n00:25 The next product.",
  );
  expect(
    validatedSponsors(
      [{ start: 10, end: 25, confidence: "clear", reason: "product" }],
      90,
      mention,
    )[0].confidence,
  ).toBe("uncertain");
  const t = parseTranscript(
    "00:10 Sponsored by Example.\n00:20 Paid partnership with Example.\n00:25 Back to the topic.\n00:30 Next section.",
  );
  expect(
    validatedSponsors(
      [
        { start: 10, end: 25, confidence: "clear", reason: "a" },
        { start: 20, end: 30, confidence: "clear", reason: "b" },
      ],
      90,
      t,
    ).every((s) => s.confidence === "uncertain"),
  ).toBe(true);
});
it("does not auto-skip a denial of sponsorship", () => {
  for (const line of [
    "This is not sponsored by Example.",
    "This video isn’t sponsored by Example.",
    "There is no paid promotion here.",
  ]) {
    const t = parseTranscript(`00:10 ${line}\n00:25 Next section.`);
    expect(
      validatedSponsors(
        [{ start: 10, end: 25, confidence: "clear", reason: "model guessed" }],
        90,
        t,
      )[0].confidence,
    ).toBe("uncertain");
  }
});
it("accepts copied timestamps on separate lines without inventing descending ranges", () => {
  const t = parseTranscript(
    "00:10\nFirst idea\n00:05 Earlier idea\n00:99 Invalid timestamp",
  );
  expect(t.segments.map((s) => s.start)).toEqual([10, 5, null]);
  expect(t.segments[0].end).toBeNull();
  expect(t.segments[2].text).toContain("00:99");
});
it("uses safe image paths and preserves actual MIME extensions in ZIPs", () => {
  const s = {
    video: { id: "abcdefghijk", title: "Video", channel: "Channel" },
    notes: [
      {
        id: "../unsafe",
        title: "Shot",
        time: 0,
        body: "A frame",
        image: "data:image/png;base64,AQID",
      },
    ],
    messages: [],
    sources: [],
    research: [
      {
        kind: "check",
        text: "The claim is uncertain.",
        selection: "A claim",
        sources: [],
        searchUsed: false,
        createdAt: 0,
      },
    ],
    comments: {
      items: [
        {
          id: "one",
          author: "Viewer",
          text: "A reaction",
          url: "https://example.test/comment",
        },
      ],
      complete: false,
      detail: "Partial",
    },
  } as unknown as Snapshot;
  const files = unzipSync(capsuleZip(s));
  expect(capsule(s, false)).toContain("The claim is uncertain.");
  expect(Object.keys(files)).toContain("images/___unsafe.png");
  expect(Object.keys(files).some((p) => p.includes(".."))).toBe(false);
  expect(capsule(s)).toContain("A reaction");
  expect(capsule(s, false)).not.toContain("A reaction");
});
