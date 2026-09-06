type EvidenceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Intersect normalized source coordinates with the visible page. */
export function normalizedEvidenceBounds(box: EvidenceBounds) {
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return null;
  const left = Math.max(0, Math.min(1, box.x));
  const top = Math.max(0, Math.min(1, box.y));
  const right = Math.max(left, Math.min(1, box.x + Math.max(0, box.width)));
  const bottom = Math.max(top, Math.min(1, box.y + Math.max(0, box.height)));
  const width = right - left;
  const height = bottom - top;
  if (width === 0 || height === 0) return null;
  return { left, top, width, height };
}
