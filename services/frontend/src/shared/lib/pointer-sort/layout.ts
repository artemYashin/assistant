/** Project the reordered layout using actual item heights and the gaps between slots. */
export function reorderOffsets(tops: number[], heights: number[], from: number, to: number) {
  const order = tops.map((_, index) => index);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  const offsets = tops.map(() => 0);
  let top = tops[0] || 0;
  order.forEach((original, slot) => {
    offsets[original] = top - tops[original];
    const gap = slot + 1 < tops.length ? tops[slot + 1] - tops[slot] - heights[slot] : 0;
    top += heights[original] + gap;
  });
  return offsets;
}
