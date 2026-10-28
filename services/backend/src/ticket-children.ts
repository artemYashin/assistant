import { z } from "zod";
import type { Store } from "./store.js";

export const ticketChildrenSchema = z
  .object({
    source: z.string().min(1).max(2200),
    ids: z.array(z.number().int().positive().safe()).min(1).max(200),
    includeChildren: z.boolean().default(false),
    forceRefresh: z.boolean().optional(),
  })
  .strict();
export type TicketChildrenInput = z.infer<typeof ticketChildrenSchema>;

export function childTicketIds(item: any, base: string): number[] {
  const ids = new Set<number>();
  for (const relation of item.relations || []) {
    if (relation?.rel !== "System.LinkTypes.Hierarchy-Forward" || typeof relation.url !== "string")
      continue;
    if (!relation.url.startsWith(base + "/")) continue;
    const match = /\/_apis\/wit\/workitems\/([1-9]\d*)$/i.exec(relation.url);
    const id = match ? Number(match[1]) : 0;
    if (Number.isSafeInteger(id) && id > 0 && id !== item.id) ids.add(id);
  }
  return [...ids];
}

export function cachedChildIds(store: Store, source: string, id: number): number[] | undefined {
  const row = store.db
    .prepare("SELECT child_ids FROM ticket_children_cache WHERE source=? AND parent_id=?")
    .get(source, id) as { child_ids: string } | undefined;
  return row ? JSON.parse(row.child_ids) : undefined;
}

export function saveChildIds(store: Store, source: string, item: any, base: string) {
  // Call only after an expanded response. Ordinary field-only responses must not erase links.
  const ids = childTicketIds(item, base);
  store.db
    .prepare(
      "INSERT INTO ticket_children_cache(source,parent_id,child_ids,updated_at) VALUES (?,?,?,?) ON CONFLICT(source,parent_id) DO UPDATE SET child_ids=excluded.child_ids,updated_at=excluded.updated_at",
    )
    .run(source, item.id, JSON.stringify(ids), new Date().toISOString());
  return ids;
}
