import { useEffect, useMemo, useRef, useState } from "react";
import { List, ListTree, LoaderCircle, RefreshCw } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { hierarchyKey, ticketHierarchy, type HierarchyTicket } from "../model/ticket-hierarchy.js";
import "./ticket-hierarchy.css";

const storageKey = "orbit.tickets.hierarchy";
export function useTicketHierarchy<T extends HierarchyTicket>(
  tickets: T[],
  source: string,
  targetId?: number,
  enabled = true,
) {
  const [grouped, setGrouped] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "grouped";
    } catch {
      return false;
    }
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [snapshots, setSnapshots] = useState<Map<string, HierarchyTicket>>(() => new Map());
  const snapshotRef = useRef(snapshots);
  const [reload, setReload] = useState(0);
  const lastRefresh = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // A stable, data-only dependency avoids refetching because a table re-rendered.
  const request = JSON.stringify(
    tickets.map(({ id, source, relations, relationsUpdatedAt, imported, inTrash }) => ({
      id,
      source,
      relations,
      relationsUpdatedAt,
      imported,
      inTrash,
    })),
  );
  useEffect(() => {
    if (!grouped || !enabled) return;
    let live = true;
    const refresh = reload > lastRefresh.current;
    lastRefresh.current = reload;
    const rows: HierarchyTicket[] = JSON.parse(request);
    const ids = rows
      .filter(
        (row) =>
          row.source === source &&
          (row.imported !== false || row.inTrash === true) &&
          (refresh || (row.relations == null && !snapshotRef.current.has(hierarchyKey(row)))),
      )
      .map((row) => row.id);
    setError("");
    if (!ids.length) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      const loaded: HierarchyTicket[] = [];
      let unavailable = false;
      for (let offset = 0; offset < ids.length; offset += 200) {
        if (!live) return;
        const result = await api<{
          source: string;
          tickets: HierarchyTicket[];
          unavailable?: number[];
        }>("/tickets/relations", "POST", { source, ids: ids.slice(offset, offset + 200), refresh });
        if (!live) return;
        if (result.source !== source) throw new Error("Подключение изменилось. Обновите список.");
        unavailable ||= !!result.unavailable?.length;
        loaded.push(...result.tickets.map((ticket) => ({ ...ticket, source })));
      }
      if (!live) return;
      const next = new Map(snapshotRef.current);
      for (const ticket of loaded) next.set(hierarchyKey(ticket), ticket);
      snapshotRef.current = next;
      setSnapshots(next);
      if (unavailable || loaded.some((ticket) => ticket.relations === null))
        setError(
          "Часть связей недоступна в Azure. Используется прежний кэш; неизвестные связи не сгруппированы. Можно повторить обновление.",
        );
    })()
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [grouped, source, request, reload, enabled]);
  const enriched = useMemo(
    () =>
      tickets.map((ticket) => {
        const cached = snapshots.get(hierarchyKey(ticket));
        return cached &&
          (ticket.relations == null ||
            (cached.relationsUpdatedAt || "") > (ticket.relationsUpdatedAt || ""))
          ? {
              ...ticket,
              relations: cached.relations,
              relationsUpdatedAt: cached.relationsUpdatedAt,
            }
          : ticket;
      }),
    [tickets, snapshots],
  );
  const tree = useMemo(() => ticketHierarchy(enriched, expanded), [enriched, expanded]);
  useEffect(() => {
    if (!grouped || !enabled || !targetId) return;
    let key = tree.parents.get(hierarchyKey({ source, id: targetId }));
    const ancestors: string[] = [];
    while (key) {
      ancestors.push(key);
      key = tree.parents.get(key);
    }
    if (ancestors.some((id) => !expanded.has(id)))
      setExpanded((old) => new Set([...old, ...ancestors]));
  }, [grouped, targetId, source, tree.parents, expanded, enabled]);
  function choose(value: boolean) {
    setGrouped(value);
    try {
      localStorage.setItem(storageKey, value ? "grouped" : "flat");
    } catch {
      /* Optional browser storage. */
    }
  }
  return {
    grouped,
    rows: grouped
      ? tree.rows
      : tickets.map((ticket) => ({ ticket, depth: 0, children: 0, expanded: false })),
    toggle: (ticket: HierarchyTicket) =>
      setExpanded((old) => {
        const next = new Set(old);
        const key = hierarchyKey(ticket);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    control: (
      <div className="ticket-hierarchy-switch" role="group" aria-label="Группировка тикетов">
        <button type="button" aria-pressed={!grouped} onClick={() => choose(false)}>
          <List size={15} />
          Список
        </button>
        <button type="button" aria-pressed={grouped} onClick={() => choose(true)}>
          <ListTree size={15} />
          По иерархии
        </button>
        {grouped && (
          <button
            type="button"
            className="ticket-hierarchy-refresh"
            title="Обновить связи из Azure"
            aria-label="Обновить связи из Azure"
            disabled={loading}
            onClick={() => setReload((value) => value + 1)}
          >
            {loading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
          </button>
        )}
      </div>
    ),
    notice: grouped ? (
      <div className="ticket-hierarchy-notice">
        <span>
          Группировка Parent/Child внутри текущих результатов. Фильтры и выбор для массовых действий
          учитывают также свёрнутые строки.
        </span>
        {loading && <span role="status">Загружаю связи…</span>}
        {error && (
          <span role="alert" className="error">
            {error}
          </span>
        )}
      </div>
    ) : null,
  };
}
