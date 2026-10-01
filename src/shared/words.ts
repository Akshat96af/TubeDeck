/** Intl.Segmenter handles Unicode words and internal apostrophes. */
export function wordAt(text: string, offset: number): string {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length)
    return "";
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  for (const part of segmenter.segment(text)) {
    if (
      part.isWordLike &&
      offset >= part.index &&
      offset < part.index + part.segment.length
    )
      return part.segment;
  }
  // Chromium may return the insertion point just after the final glyph.
  if (offset === text.length && offset > 0) return wordAt(text, offset - 1);
  return "";
}
