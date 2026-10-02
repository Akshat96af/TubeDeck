import type { Transcript, Segment } from "./types";

export function jsonCaptions(data: any): Transcript {
  const segments: Segment[] = [];
  for (const event of data?.events ?? []) {
    if (!Number.isFinite(event.tStartMs) || event.tStartMs < 0) continue;
    const text = (event.segs ?? [])
      .map((s: any) => (typeof s.utf8 === "string" ? s.utf8 : ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const start = event.tStartMs / 1000;
    segments.push({
      start,
      end:
        Number.isFinite(event.dDurationMs) && event.dDurationMs > 0
          ? start + event.dDurationMs / 1000
          : null,
      text,
    });
  }
  segments.sort((a, b) => a.start! - b.start!);
  if (!segments.length)
    throw new Error("Caption track returned no readable text.");
  return {
    segments,
    source: "youtube",
    complete: true,
    detail: "Read the available YouTube caption track.",
  };
}
