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
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limited, setLimited] = useState(false);
  const snapshot = useRef<string | undefined>(undefined);
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
    targetPage: number,
    keepRows = false,
    newSearch = false,
  ) {
    if (!enabled || locked.current) return;
    locked.current = true;
    const request = ++generation.current;
    setLoading(true);
    setError("");
    if (!keepRows) setRows([]);
    try {
      const { sort: _sort, ...search } = filters;
      const result = await api("/azure/tickets/search", "POST", {
        ...search,
        source,
        page: targetPage,
        snapshot: newSearch ? undefined : snapshot.current,
      });
      if (request !== generation.current) return;
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
      if (request === generation.current) setLoading(false);
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
      JSON.stringify({ ...filters, sort: "" }) !==
        JSON.stringify({ ...applied.current, sort: "" }),
  };
}
