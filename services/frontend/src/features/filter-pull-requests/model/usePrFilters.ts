import { useState } from "react";
import type { PrFilters } from "../index.js";

export const defaultPrFilters: PrFilters = { draft: "all", review: "all", sort: "created:desc" };
export function parsePrFilters(value: unknown): PrFilters {
  const saved = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const pick = (key: keyof PrFilters, allowed: string[]) =>
    typeof saved[key] === "string" && allowed.includes(saved[key] as string)
      ? (saved[key] as string)
      : defaultPrFilters[key];
  return {
    draft: pick("draft", ["all", "draft", "published"]),
    review: pick("review", ["all", "ready", "pending"]),
    sort: pick("sort", ["created:desc", "created:asc", "number:desc", "number:asc", "title:asc"]),
  };
}
function read(key: string): PrFilters {
  try {
    return parsePrFilters(JSON.parse(localStorage.getItem(key) || "null"));
  } catch {
    return { ...defaultPrFilters };
  }
}
export function usePrFilters(customer: string) {
  const key = `orbit.pr-filters:${JSON.stringify(customer)}`;
  const [state, setState] = useState(() => ({ key, filters: read(key) }));
  const filters = state.key === key ? state.filters : read(key);
  if (state.key !== key) setState({ key, filters });
  const update = (patch: Partial<PrFilters>) => {
    setState((previous) => {
      const next = parsePrFilters({
        ...(previous.key === key ? previous.filters : read(key)),
        ...patch,
      });
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* Filtering still works when storage is unavailable. */
      }
      return { key, filters: next };
    });
  };
  return { filters, update };
}
