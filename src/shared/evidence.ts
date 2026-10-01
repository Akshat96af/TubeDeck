import type { Sponsor, Transcript } from "./types";
import { cleanSponsors } from "./utils";

/** AI confidence alone cannot enable automatic seeking. Require transcript evidence too. */
export function validatedSponsors(
  items: Sponsor[],
  duration: number,
  transcript?: Transcript,
): Sponsor[] {
  const lines = transcript?.segments ?? [];
  const ranges = cleanSponsors(items, duration).map((s) => {
    const matches = (t: number) =>
      lines.some((l) => l.start !== null && Math.abs(l.start - t) <= 1);
    const disclosure = lines
      .filter(
        (l) =>
          l.start !== null &&
          l.start >= s.start - 5 &&
          l.start < Math.min(s.end, s.start + 30),
      )
      .map((l) => l.text)
      .join(" ");
    const explicit =
      /(?:sponsored\s+by|paid\s+(?:partnership|sponsorship|promotion)|thanks?\s+to\s+.+?\s+for\s+sponsoring|sponsor\s+of\s+(?:this|today.?s)\s+(?:video|episode))/i.test(
        disclosure,
      );
    const denied =
      /(?:\bnot|\bnever|\bisn['’]t|\baren['’]t|\bwasn['’]t|\bweren['’]t)\s+(?:a\s+)?(?:paid\s+)?(?:sponsored|sponsorship|partnership|promotion)|\bno\s+(?:paid\s+)?(?:sponsorship|partnership|promotion)/i.test(
        disclosure,
      );
    return {
      ...s,
      confidence:
        s.confidence === "clear" &&
        explicit &&
        !denied &&
        matches(s.start) &&
        matches(s.end)
          ? ("clear" as const)
          : ("uncertain" as const),
    };
  });
  return ranges.map((s, i) =>
    ranges.some(
      (other, j) => i !== j && s.start < other.end && other.start < s.end,
    )
      ? { ...s, confidence: "uncertain" as const }
      : s,
  );
}

export function imageAssetName(note: { id: string; image?: string }): string {
  const extension = note.image?.startsWith("data:image/png;")
    ? "png"
    : note.image?.startsWith("data:image/webp;")
      ? "webp"
      : "jpg";
  return `images/${note.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.${extension}`;
}
