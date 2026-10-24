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
  return {
    clientFilter: text("clientFilter", "all"),
    projectFilter: text("projectFilter", "all"),
    status: ["all", "active", ...Object.keys(statusLabels)].includes(
      text("status"),
    )
      ? text("status")
      : "all",
    query: text("query"),
    from: date("from"),
    to: date("to"),
    sort: ["nearest", "asc", "desc", "title"].includes(text("sort"))
      ? text("sort")
      : "nearest",
  };
}
