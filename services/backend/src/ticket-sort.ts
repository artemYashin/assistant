import { z } from "zod";

export const ticketSortSchema = {
  sortBy: z
    .enum([
      "id",
      "title",
      "type",
      "state",
      "assigned",
      "priority",
      "azurePriority",
      "localDeadline",
      "tags",
      "azureTags",
      "notes",
      "localDevelopers",
      "created_at",
      "changed_at",
      "added_at",
      "synced_at",
      "localUrl",
    ])
    .default("id"),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
};
export function ticketOrder(sortBy: string, direction: "asc" | "desc", alias = "t") {
  const a = alias;
  const metadata = (field: string) =>
    `(SELECT ${field} FROM ticket_metadata m WHERE m.source=${a}.source AND m.id=${a}.id)`;
  const dates = (field: string) =>
    `(SELECT ${field} FROM ticket_tracking_dates d WHERE d.source=${a}.source AND d.id=${a}.id)`;
  const expressions: Record<string, string> = {
    id: `${a}.id`,
    localUrl: `${a}.id`,
    title: `${a}.title`,
    type: `${a}.type`,
    state: `${a}.state`,
    assigned: `${a}.assigned`,
    changed_at: `${a}.changed_at`,
    synced_at: `${a}.synced_at`,
    localDeadline: `(SELECT deadline FROM ticket_deadlines d WHERE d.source=${a}.source AND d.id=${a}.id)`,
    azurePriority: `(SELECT priority FROM ticket_azure_priority p WHERE p.source=${a}.source AND p.id=${a}.id)`,
    priority: `coalesce(${metadata("priority")},1)`,
    notes: metadata("notes"),
    tags: `(SELECT group_concat(value, char(31)) FROM (SELECT value FROM ticket_metadata m,json_each(m.tags) WHERE m.source=${a}.source AND m.id=${a}.id ORDER BY value COLLATE NOCASE))`,
    azureTags: `(SELECT group_concat(value, char(31)) FROM (SELECT value FROM ticket_azure_tags m,json_each(m.tags) WHERE m.source=${a}.source AND m.id=${a}.id ORDER BY value COLLATE NOCASE))`,
    localDevelopers: `(SELECT group_concat(name, char(31)) FROM (SELECT d.name FROM ticket_developers td JOIN local_developers d ON d.id=td.developer_id WHERE td.source=${a}.source AND td.ticket_id=${a}.id ORDER BY d.name COLLATE NOCASE))`,
    created_at: dates("created_at"),
    added_at: dates("added_at"),
  };
  const expression = expressions[sortBy];
  if (!expression) throw new Error("Unsupported ticket sort");
  const order = direction === "desc" ? "DESC" : "ASC";
  return `(${expression}) IS NULL ASC, (${expression}) COLLATE NOCASE ${order}, ${a}.id ASC`;
}
