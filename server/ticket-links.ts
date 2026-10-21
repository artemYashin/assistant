import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { z } from "zod";
import { Store } from "./store.js";

export const ticketLinksSchema = z.object({
  id: z.number().int().positive(),
  includeCacheInfo: z.boolean().default(false),
  search: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(["all", "link", "image"]).default("all"),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(30).default(15),
}).strict();
const parser = unified().use(remarkParse).use(remarkGfm);
export function readTicketLinks(store: Store, input: unknown) {
  const { id, search, kind, offset, limit, includeCacheInfo } = ticketLinksSchema.parse(input);
  const source = store.source();
  if (!store.hasLocalTicket(id, source)) return { id, available: false, reason: "Ticket is not local. No Azure call." };
  const rows = store.db.prepare("SELECT section,body,updated_at FROM ticket_content_cache WHERE source=? AND id=? ORDER BY section").all(source, id) as { section: string; body: string; updated_at: string }[];
  if (!rows.length) return { id, available: false, reason: "No cached content. No Azure call." };
  const links: { section: string; kind: string; label: string; url: string }[] = [];
  const seen = new Set<string>();
  const label = (node: any): string => node.alt || node.value || (node.children || []).map(label).join("");
  for (const row of rows) {
    const tree = parser.parse(row.body);
    const definitions = new Map<string, string>();
    const visit = (node: any, fn: (node: any) => void) => { fn(node); for (const child of node.children || []) visit(child, fn); };
    visit(tree, node => { if (node.type === "definition") definitions.set(node.identifier, node.url); });
    visit(tree, node => {
      if (!["link", "image", "linkReference", "imageReference"].includes(node.type)) return;
      const url = node.url || definitions.get(node.identifier);
      if (typeof url !== "string" || !/^(https?:\/\/|\/api\/ticket-cards\/)/i.test(url)) return;
      const item = { section: row.section, kind: node.type.startsWith("image") ? "image" : "link", label: label(node).slice(0, 300), url };
      if (kind !== "all" && item.kind !== kind) return;
      if (search && !`${item.label} ${url}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) return;
      const key = JSON.stringify(item);
      if (!seen.has(key)) { seen.add(key); links.push(item); }
    });
  }
  return { id, available: true, origin: "local_cache", links: links.slice(offset, offset + limit), total: links.length,
    nextOffset: offset + limit < links.length ? offset + limit : null,
    cachedAt: includeCacheInfo ? rows.map(row => ({ section: row.section, at: row.updated_at })) : undefined,
    note: "Only links/images from cached description, criteria and repro. No full bodies, comments or Azure calls. No matches does not prove missing designs; broaden search or inspect a short content snippet." };
}
