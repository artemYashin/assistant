// Keep the first/last pages and a compact window around the current page.
export function paginationItems(
  page: number,
  total: number,
): (number | string)[] {
  const start = Math.max(1, Math.min(page - 2, total - 4));
  const end = Math.min(total, start + 4);
  const numbers = [
    ...new Set([
      1,
      ...Array.from({ length: end - start + 1 }, (_, i) => start + i),
      total,
    ]),
  ];
  const items: (number | string)[] = [];
  for (const n of numbers) {
    const last = items[items.length - 1];
    if (typeof last === "number" && n - last > 1) items.push(`gap-${n}`);
    items.push(n);
  }
  return items;
}
