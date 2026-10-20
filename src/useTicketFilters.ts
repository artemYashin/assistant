import { useEffect, useState } from "react";

const empty = {
  query: "",
  sort: "id-desc",
  priorityFilter: [] as string[],
  tagFilter: [] as string[],
  azureTagFilter: [] as string[],
  typeFilter: [] as string[],
  stateFilter: [] as string[],
  assigneeFilter: [] as string[],
  localFilter: [] as string[],
};
export type Filters = typeof empty;
const sorts = new Set(
  [
    "id",
    "title",
    "type",
    "state",
    "priority",
    "tags",
    "azureTags",
    "assigned",
    "developer_name",
    "added_at",
    "synced_at",
  ].flatMap((key) => [`${key}-asc`, `${key}-desc`]),
);

export function parseTicketFilters(saved: unknown): Filters {
  if (!saved || typeof saved !== "object" || Array.isArray(saved))
    return { ...empty };
  const result = { ...empty };
  for (const key of Object.keys(empty) as (keyof Filters)[]) {
    const value = (saved as Record<string, unknown>)[key];
    if (key === "query") {
      if (typeof value === "string") result.query = value;
    } else if (key === "sort") {
      if (typeof value === "string" && sorts.has(value)) result.sort = value;
    } else if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      result[key] = value;
    }
  }
  return result;
}

export function useTicketFilters(storageKey: string) {
  const [filters, setFilters] = useState<Filters>(() => {
    try {
      return parseTicketFilters(
        JSON.parse(localStorage.getItem(storageKey) || "null"),
      );
    } catch {
      return { ...empty };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(filters));
    } catch {
      /* Filtering remains usable when browser storage is unavailable. */
    }
  }, [storageKey, filters]);
  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((previous) => ({ ...previous, [key]: value }));
  }
  return {
    filters,
    set,
    apply: (value: Filters) => setFilters(parseTicketFilters(value)),
  };
}
