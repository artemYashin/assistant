import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import type { Filters } from "./useTicketFilters.js";

type SavedSearch = {
  tickets: any[];
  snapshot: string;
  page: number;
  totalPages: number;
  total: number;
  limited: boolean;
  filters: Filters;
};
// Session-only: keep the last page per workspace without writing ticket data to storage.
const searches = new Map<string, SavedSearch>();

export function useAzureTicketBrowser(
  enabled: boolean,
  source: string,
  workspace = source,
) {
  const saved = useRef(enabled ? searches.get(workspace) : undefined).current;
  const [rows, setRows] = useState<any[]>(saved?.tickets ?? []);
  const [catalog, setCatalog] = useState<{ types: string[]; states: string[] }>(
    { types: [], states: [] },
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(!!saved);
  const [page, setPage] = useState(saved?.page ?? 1);
  const [totalPages, setTotalPages] = useState(saved?.totalPages ?? 1);
  const [total, setTotal] = useState(saved?.total ?? 0);
  const [limited, setLimited] = useState(saved?.limited ?? false);
  const snapshot = useRef<string | undefined>(saved?.snapshot);
  const applied = useRef<Filters | null>(saved?.filters ?? null);
  const generation = useRef(0);
  const locked = useRef(false);
  const queuedSearch = useRef<Filters | null>(null);
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
      queuedSearch.current = null;
    };
  }, [enabled, source]);
  async function load(
    filters: Filters,
    targetPage: number,
    keepRows = false,
    newSearch = false,
  ) {
    if (!enabled) return;
    if (locked.current) {
      if (newSearch) {
        queuedSearch.current = structuredClone(filters);
        generation.current++;
        setRows([]);
        setPage(1);
      }
      return;
    }
    locked.current = true;
    if (newSearch) setPage(1);
    const request = ++generation.current;
    setLoading(true);
    setError("");
    if (!keepRows) setRows([]);
    try {
      const result = await api("/azure/tickets/search", "POST", {
        ...filters,
        source,
        page: targetPage,
        snapshot: newSearch ? undefined : snapshot.current,
      });
      if (request !== generation.current) return;
      searches.delete(workspace);
      if (searches.size >= 10) searches.delete(searches.keys().next().value!);
      searches.set(workspace, {
        tickets: result.tickets,
        snapshot: result.snapshot,
        page: result.page,
        totalPages: result.totalPages,
        total: result.total,
        limited: result.limited,
        filters: structuredClone(filters),
      });
      setRows(result.tickets);
      snapshot.current = result.snapshot;
      setPage(result.page);
      setTotalPages(result.totalPages);
      setTotal(result.total);
      setLimited(result.limited);
      applied.current = structuredClone(filters);
      setSearched(true);
    } catch (e: any) {
      if (request === generation.current) setError(e.message);
    } finally {
      locked.current = false;
      const queued = queuedSearch.current;
      queuedSearch.current = null;
      if (queued) void load(queued, 1, false, true);
      else if (request === generation.current) setLoading(false);
    }
  }
  return {
    rows,
    catalog,
    error,
    loading,
    searched,
    page,
    totalPages,
    total,
    limited,
    hasNext: page < totalPages,
    search: (filters: Filters) => load(filters, 1, false, true),
    goTo: (target: number) =>
      applied.current &&
      target >= 1 &&
      target <= totalPages &&
      target !== page &&
      void load(applied.current, target),
    next: () =>
      applied.current &&
      page < totalPages &&
      void load(applied.current, page + 1),
    previous: () =>
      applied.current && page > 1 && void load(applied.current, page - 1),
    refresh: () => applied.current && void load(applied.current, page, true),
    pending: (filters: Filters) =>
      applied.current &&
      JSON.stringify(filters) !== JSON.stringify(applied.current),
  };
}
