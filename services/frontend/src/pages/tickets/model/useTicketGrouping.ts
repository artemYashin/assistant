import { useEffect, useRef, useState } from "react";
import { api } from "../../../shared/api/http/index.js";
import {
  groupedTicketRows,
  parseGroupPreferences,
  uniqueGroupTickets,
  type GroupPreferences,
  type ParentChildren,
} from "./grouping.js";

function read(key: string) {
  try {
    return parseGroupPreferences(localStorage.getItem(key));
  } catch {
    return parseGroupPreferences(null);
  }
}
export function useTicketGrouping(
  roots: any[],
  source: string,
  context: { client: string; project: string },
  table: boolean,
) {
  const key =
    "orbit.ticket-grouping.v1:" + JSON.stringify([source, context.client, context.project]);
  const [saved, setSaved] = useState(() => ({ key, preferences: read(key) }));
  const preferences = saved.key === key ? saved.preferences : read(key);
  const [expansion, setExpansion] = useState<{ key: string; ids: Set<number> }>({
    key,
    ids: new Set(),
  });
  const expanded = expansion.key === key ? expansion.ids : new Set<number>();
  const [revision, setRevision] = useState({ number: 0, force: false });
  const forcedToken = useRef("");
  const [data, setData] = useState<{ token: string; parents: Record<number, ParentChildren> }>({
    token: "",
    parents: {},
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const enabled = table && preferences.mode === "grouped";
  const ids = JSON.stringify(
    enabled
      ? roots
          .filter((t) => t.source === source && preferences.parentTypes.includes(t.type))
          .map((t) => t.id)
          .sort((a, b) => a - b)
      : [],
  );
  const syncVersion = JSON.stringify(
    enabled
      ? roots
          .filter(
            (ticket) => ticket.source === source && preferences.parentTypes.includes(ticket.type),
          )
          .map((ticket) => [ticket.id, ticket.synced_at || ""])
          .sort((a, b) => Number(a[0]) - Number(b[0]))
      : [],
  );
  const token = JSON.stringify([key, ids, syncVersion, revision.number]);
  const expandedKey = JSON.stringify([...expanded].sort((a, b) => a - b));
  useEffect(() => {
    const changed = () => setRevision((v) => ({ number: v.number + 1, force: false }));
    const events = [
      "orbit:data-synced",
      "orbit:ticket-tracked",
      "orbit:ticket-removed",
      "orbit:ticket-state",
      "orbit:ticket-assignee",
      "orbit:ticket-metadata",
      "orbit:ticket-developers",
      "orbit:ticket-azure-fields",
    ];
    events.forEach((name) => window.addEventListener(name, changed));
    return () => events.forEach((name) => window.removeEventListener(name, changed));
  }, []);
  useEffect(() => {
    let live = true;
    const parentIds: number[] = JSON.parse(ids);
    const selected: number[] = JSON.parse(expandedKey);
    setError("");
    setLoading(parentIds.length > 0);
    const load = async () => {
      const parents: Record<number, ParentChildren> = {};
      for (let offset = 0; offset < parentIds.length; offset += 200) {
        const result = await api<{ parents: ParentChildren[] }>("/tickets/children", "POST", {
          source,
          ids: parentIds.slice(offset, offset + 200),
          forceRefresh: revision.force && forcedToken.current !== token,
        });
        if (!live) return;
        for (const parent of result.parents) parents[parent.id] = parent;
      }
      if (!live) return;
      forcedToken.current = token;
      setData((old) => ({
        token,
        parents: Object.fromEntries(
          Object.entries(parents).map(([id, parent]) => [
            id,
            {
              ...parent,
              ...(old.token === token && old.parents[Number(id)]?.children
                ? {
                    children: old.parents[Number(id)].children!.filter((child) =>
                      parent.childIds.includes(child.id),
                    ),
                  }
                : {}),
            },
          ]),
        ),
      }));
      const opened = parentIds.filter(
        (id) => selected.includes(id) && parents[id]?.childIds.length,
      );
      for (let offset = 0; offset < opened.length; offset += 200) {
        const result = await api<{ parents: ParentChildren[] }>("/tickets/children", "POST", {
          source,
          ids: opened.slice(offset, offset + 200),
          includeChildren: true,
        });
        if (!live) return;
        setData((old) => ({
          token,
          parents: {
            ...(old.token === token ? old.parents : {}),
            ...Object.fromEntries(result.parents.map((parent) => [parent.id, parent])),
          },
        }));
      }
    };
    void load()
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [ids, source, token, expandedKey, revision.force]);
  const update = (next: GroupPreferences) => {
    setSaved({ key, preferences: next });
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Storage is optional. */
    }
  };
  const rows = groupedTicketRows(
    roots,
    enabled,
    preferences.parentTypes,
    data.token === token ? data.parents : {},
    expanded,
  );
  return {
    preferences,
    update,
    rows,
    selectable: uniqueGroupTickets(rows),
    error,
    loading,
    refreshRelations: () => setRevision((v) => ({ number: v.number + 1, force: true })),
    retry: () => setRevision((v) => ({ number: v.number + 1, force: false })),
    toggle: (id: number) =>
      setExpansion((old) => {
        const ids = new Set(old.key === key ? old.ids : []);
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
        return { key, ids };
      }),
  };
}
