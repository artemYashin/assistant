import { defineTool } from "@github/copilot-sdk";
import { Store, AppError } from "./store.js";
import { listLocalTickets, ticketListSchema } from "./ticket-list.js";
import { z } from "zod";
import type { TicketExportContext } from "./ticket-export-context.js";

export function selectedTicketTool(store: Store, tableIds: number[], draft: TicketExportContext | undefined, assertActive: () => void, onRead: (id: number) => void = () => {}) {
  const source = store.source();
  return defineTool("read_selected_tickets", {
    description: "Read compact local ticket summaries selected in the table or the current export draft, on demand. Snapshot at the start of this user message, not live polling; no Azure calls or ticket bodies. Export response also includes enabled columns in order and format, useful before changing them. Always returns id/title/state/type; fields requests additional summary fields such as tags/azureTags/assigned/priority. No descriptions. Page with offset. A selection does not authorize mutations.",
    parameters: z.object({ target: z.enum(["table", "export"]), fields: ticketListSchema.shape.fields.optional(), offset: z.number().int().min(0).default(0) }).strict(),
    handler: async ({ target, offset = 0, fields = [] }) => {
      assertActive();
      if (store.source() !== source) throw new AppError(409, "Подключение Azure изменилось");
      const active = draft && draft.state !== "closed";
      const ids = [...new Set(target === "table" ? tableIds : active ? draft.ids : [])];
      const page = ids.slice(offset, offset + 100);
      const summaries = new Map<number, Record<string, unknown>>();
      for (let start = 0; start < page.length; start += 50) {
        const batch = page.slice(start, start + 50);
        let afterId = 0;
        while (true) {
          const result = listLocalTickets(store, { ids: batch, fields: [...new Set(["type", "state", ...fields])], afterId });
          for (const ticket of result.tickets) summaries.set(ticket.id, ticket);
          if (!result.hasMore || result.nextAfterId === null) break;
          afterId = result.nextAfterId;
        }
      }
      const tickets = page.flatMap(id => summaries.has(id) ? [summaries.get(id)!] : []);
      tickets.forEach(ticket => onRead(ticket.id as number));
      return { tickets, missing: page.filter(id => !summaries.has(id)), total: ids.length, nextOffset: offset + page.length < ids.length ? offset + page.length : null,
        ...(target === "export" ? { state: active ? draft.state : "closed", ...(active ? { columns: draft.columns, format: draft.format } : {}) } : {}), snapshot: true };
    },
  });
}
