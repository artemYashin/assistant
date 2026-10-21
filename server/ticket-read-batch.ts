import { z } from "zod";
import type { Store } from "./store.js";
import { cachedTicketSchema, readCachedTicket } from "./ticket-content-search.js";
import { ticketLinksSchema, readTicketLinks } from "./ticket-links.js";

const tickets = z.array(z.object({ id: z.number().int().positive(), offset: z.number().int().nonnegative().default(0) }).strict()).min(1).max(20)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, "Ticket IDs must be unique");
export const cachedTicketBatchSchema = cachedTicketSchema.omit({ id: true, offset: true }).extend({ tickets }).strict();
export const ticketLinksBatchSchema = ticketLinksSchema.omit({ id: true, offset: true }).extend({ tickets }).strict();

/** Preserve per-ticket pagination and return unprocessed requests instead of truncating data. */
function batchRead(items: { id: number; offset: number }[], read: (item: { id: number; offset: number }) => any) {
  const results: any[] = [];
  const pending: { id: number; offset: number }[] = [];
  for (const [index, item] of items.entries()) {
    const { note: _note, ...result } = read(item);
    if (JSON.stringify({ results: [...results, result], pending: items }).length > 18000) {
      const firstTooLarge = !results.length;
      if (firstTooLarge) results.push({ id: item.id, available: false, error: "Result exceeds batch budget. Retry get_ticket_links with a smaller limit." });
      pending.push(...items.slice(firstTooLarge ? index + 1 : index));
      break;
    }
    results.push(result);
  }
  return { origin: "local_cache", results, pending, note: "No Azure calls. Retry pending requests unchanged. For each returned ticket continue at nextOffset if non-null; missing cache is unknown. Retained trash is included. Cached data may be stale." };
}
export function readCachedTicketBatch(store: Store, input: unknown) {
  const { tickets, ...options } = cachedTicketBatchSchema.parse(input);
  return batchRead(tickets, item => readCachedTicket(store, { ...options, ...item }));
}
export function readTicketLinksBatch(store: Store, input: unknown) {
  const { tickets, ...options } = ticketLinksBatchSchema.parse(input);
  return batchRead(tickets, item => readTicketLinks(store, { ...options, ...item }));
}
