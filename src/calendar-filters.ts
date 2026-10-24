import { statusLabels } from "./calendar-status.js";
export function parseCalendarFilters(value: unknown) {
  const v =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const text = (key: string, fallback = "") =>
    typeof v[key] === "string" ? (v[key] as string) : fallback;
  const date = (key: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text(key)) &&
    Number.isFinite(Date.parse(text(key)))
      ? text(key)
      : "";
  const selections = (key: string) => {
    const raw = v[key];
    const values =
      typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
    return [
      ...new Set(
        values.filter(
          (entry): entry is string =>
            typeof entry === "string" && entry !== "all",
        ),
      ),
    ];
  };
  return {
    clientFilter: selections("clientFilter"),
    projectFilter: selections("projectFilter"),
    status: selections("status").filter((value) =>
      ["active", ...Object.keys(statusLabels)].includes(value),
    ),
    types: selections("types").filter(value => ["reminder", "ticket", "vacation"].includes(value)),
    query: text("query"),
    from: date("from"),
    to: date("to"),
    sort: ["nearest", "asc", "desc", "title"].includes(text("sort"))
      ? text("sort")
      : "nearest",
  };
}
