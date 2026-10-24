export const columnMinimum = (key: string) =>
  key === "selection" ? 44 : key === "id" ? 93 : key === "title" ? 120 : 60;
export const columnDefault = (key: string) =>
  key === "localDeadline" ? 185 : key === "selection" ? 44 : key === "title" ? 260 : key === "id" ? 93 : 110;
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
  const identity = keys.includes("id")
    ? Math.max(
        columnMinimum("id"),
        (room * (saved.id ?? columnDefault("id"))) / total,
      )
    : 0;
  const otherTotal = keys
    .filter((key) => key !== "selection" && key !== "id")
    .reduce((sum, key) => sum + (saved[key] ?? columnDefault(key)), 0);
  const otherRoom = Math.max(1, room - identity);
  return Object.fromEntries(
    keys.map((key) => [
      key,
      key === "selection"
        ? 44
        : key === "id"
          ? identity
          : (otherRoom * (saved[key] ?? columnDefault(key))) / otherTotal,
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
  let firstMin = columnMinimum(key) * factor;
  let nextMin = columnMinimum(next) * factor;
  if (key === "id") {
    firstMin = Math.min(total, columnMinimum("id"));
    nextMin = Math.min(columnMinimum(next), total - firstMin);
  } else if (next === "id") {
    nextMin = Math.min(total, columnMinimum("id"));
    firstMin = Math.min(columnMinimum(key), total - nextMin);
  }
  const width = Math.max(
    firstMin,
    Math.min(total - nextMin, widths[key] + delta),
  );
  return { ...widths, [key]: width, [next]: total - width };
}
