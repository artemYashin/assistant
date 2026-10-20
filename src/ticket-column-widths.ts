export const columnMinimum = (key: string) =>
  key === "selection" ? 44 : key === "title" ? 120 : 60;
export const columnDefault = (key: string) =>
  key === "selection" ? 44 : key === "title" ? 260 : key === "id" ? 100 : 110;
export function parseColumnWidths(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, width]) =>
        /^[a-zA-Z_]+$/.test(key) &&
        typeof width === "number" &&
        Number.isFinite(width) &&
        width >= 20 &&
        width <= 5000,
    ),
  );
}
// Reserve checkbox space, then share the remainder in the saved proportions.
export function fitColumnWidths(
  keys: string[],
  saved: Record<string, number>,
  available: number,
) {
  const room = Math.max(1, available - 44);
  const total = keys
    .filter((k) => k !== "selection")
    .reduce((sum, key) => sum + (saved[key] ?? columnDefault(key)), 0);
  return Object.fromEntries(
    keys.map((key) => [
      key,
      key === "selection"
        ? 44
        : (room * (saved[key] ?? columnDefault(key))) / total,
    ]),
  );
}
export function resizeColumnPair(
  widths: Record<string, number>,
  key: string,
  next: string,
  delta: number,
) {
  const total = widths[key] + widths[next];
  const factor = Math.min(
    1,
    total / (columnMinimum(key) + columnMinimum(next)),
  );
  const width = Math.max(
    columnMinimum(key) * factor,
    Math.min(total - columnMinimum(next) * factor, widths[key] + delta),
  );
  return { ...widths, [key]: width, [next]: total - width };
}
