/** Validate heights received across the extension iframe boundary. */
export function panelHeight(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(1400, Math.max(100, Math.ceil(value)));
}
