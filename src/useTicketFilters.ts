import { useLocalManagement } from "./WorkMode.js";
import { useEffect, useState } from "react";

const empty = {
  query: "",
  overdueDeadline: false,
  sort: "id-desc",
  azurePriorityFilter: [] as string[],
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
    "azurePriority",
    "localDeadline",
    "tags",
    "azureTags",
    "assigned",
    "developer_name",
    "created_at",
    "changed_at",
    "added_at",
    "synced_at",
    "removedAt",
    "expiresAt",
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
    } else if (key === "overdueDeadline") {
      result.overdueDeadline = value === true;
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

// Keep separate tabs, but share current filters across all customer projects.
function customerFilterScope(legacyKey: string) {
  const match = /^orbit\.ticket-filters\.(active|azure|trash):(.*)$/.exec(
    legacyKey,
  );
  if (!match) return { key: legacyKey, legacyKeys: [legacyKey] };
  try {
    const [, customer] = JSON.parse(match[2]);
    const key = `orbit.ticket-filters.customer.${match[1]}:${JSON.stringify(customer)}`;
    const prefix = `orbit.ticket-filters.${match[1]}:`;
    // Prefer the currently opened project's settings for the initial migration.
    const legacyKeys = [legacyKey];
    try {
      for (const candidate of Object.keys(localStorage).sort()) {
        if (candidate === legacyKey || !candidate.startsWith(prefix)) continue;
        try {
          const scope = JSON.parse(candidate.slice(prefix.length));
          if (Array.isArray(scope) && scope[1] === customer)
            legacyKeys.push(candidate);
        } catch {
          /* Ignore preset/expanded-state keys. */
        }
      }
    } catch {
      /* Browser storage may be unavailable. */
    }
    return { key, legacyKeys };
  } catch {
    return { key: legacyKey, legacyKeys: [legacyKey] };
  }
}

export function useTicketFilters(
  storageKey: string,
  initialFilters: Partial<Filters> = {},
) {
  const management=useLocalManagement();
  const [{ key, legacyKeys }] = useState(() => customerFilterScope(storageKey));
  const [filters, setFilters] = useState<Filters>(() => {
    for (const candidate of [key, ...legacyKeys]) {
      try {
        const saved = JSON.parse(localStorage.getItem(candidate) || "null");
        if (saved && typeof saved === "object" && !Array.isArray(saved))
          return parseTicketFilters(saved);
      } catch {
        /* Keep old entries and try another project if unreadable. */
      }
    }
    return parseTicketFilters(initialFilters);
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(filters));
    } catch {
      /* Filtering remains usable when browser storage is unavailable. */
    }
  }, [key, filters]);
  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((previous) => ({ ...previous, [key]: value }));
  }
  return {
    filters: management ? filters : {...filters, localFilter:[], sort:filters.sort.startsWith("developer_name-")?"id-desc":filters.sort},
    rawFilters:filters,
    set,
    apply: (value: Filters) => setFilters(parseTicketFilters(value)),
  };
}
