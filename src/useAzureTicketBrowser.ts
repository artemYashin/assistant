import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import type { Filters } from "./useTicketFilters.js";

export function useAzureTicketBrowser(enabled: boolean, source: string) {
  const [rows, setRows] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<{ types: string[]; states: string[] }>(
    { types: [], states: [] },
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [next, setNext] = useState<number | null>(null);
  const [pages, setPages] = useState<(number | undefined)[]>([undefined]);
  const applied = useRef<Filters | null>(null);
  const generation = useRef(0);
  const locked = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api("/azure/tickets/catalog")
      .then((result) => {
        if (live) setCatalog(result);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      generation.current++;
    };
  }, [enabled, source]);
  async function load(
    filters: Filters,
    trail: (number | undefined)[],
    keepRows = false,
  ) {
    if (!enabled || locked.current) return;
    locked.current = true;
    const request = ++generation.current;
    setLoading(true);
    setError("");
    if (!keepRows) setRows([]);
    setNext(null);
    try {
      const { sort: _sort, ...search } = filters;
      const result = await api("/azure/tickets/search", "POST", {
        ...search,
        source,
        before: trail[trail.length - 1],
      });
      if (request !== generation.current) return;
      setRows(result.tickets);
      setNext(result.next);
      setPages(trail);
      applied.current = structuredClone(filters);
      setSearched(true);
    } catch (e: any) {
      if (request === generation.current) setError(e.message);
    } finally {
      locked.current = false;
      if (request === generation.current) setLoading(false);
    }
  }
  return {
    rows,
    catalog,
    error,
    loading,
    searched,
    page: pages.length,
    hasNext: next !== null,
    search: (filters: Filters) => load(filters, [undefined]),
    next: () =>
      applied.current &&
      next !== null &&
      void load(applied.current, [...pages, next]),
    previous: () =>
      applied.current &&
      pages.length > 1 &&
      void load(applied.current, pages.slice(0, -1)),
    refresh: () => applied.current && void load(applied.current, pages, true),
    pending: (filters: Filters) =>
      applied.current &&
      JSON.stringify({ ...filters, sort: "" }) !==
        JSON.stringify({ ...applied.current, sort: "" }),
  };
}
