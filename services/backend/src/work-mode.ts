export type WorkMode = "lead" | "developer";
/** Lead is the full product. New features are available in both modes unless explicitly excluded. */
export function workMode(settings: { workMode?: unknown } | undefined): WorkMode {
  return settings?.workMode === "developer" ? "developer" : "lead";
}
export function hasLocalManagement(settings: { workMode?: unknown } | undefined) {
  return workMode(settings) === "lead";
}
export const managementFields = new Set([
  "developers",
  "developerIds",
  "developer_id",
  "developer_name",
  "localDevelopers",
  "localDeveloper",
  "localFilter",
  "vacation",
  "vacationStatus",
  "developerTotal",
  "vacationLeadMinutes",
]);
export function withoutManagement<T>(value: T): T {
  if (Array.isArray(value))
    return value
      .filter((v) => !(v && typeof v === "object" && "vacation" in v && !!v.vacation))
      .map(withoutManagement) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !managementFields.has(k))
        .map(([k, v]) => [
          k,
          withoutManagement(
            ["columns", "fields"].includes(k) && Array.isArray(v)
              ? v.filter((x) => !managementFields.has(x))
              : v,
          ),
        ]),
    ) as T;
  return value;
}
