import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import type { TicketExportContext } from "./ticket-export-context.js";

export function selectedTicketTool(tableIds: number[], draft: TicketExportContext | undefined, assertActive: () => void, onRead: (id: number) => void = () => {}) {
  return defineTool("read_selected_tickets", {
    description: "Read ticket IDs selected in the table or the current export draft, on demand. Snapshot at the start of this user message, not live polling; no Azure calls or ticket bodies. Export response also includes enabled columns in order and format, useful before changing them. Page with offset. A selection does not authorize mutations.",
    parameters: z.object({ target: z.enum(["table", "export"]), offset: z.number().int().min(0).default(0) }).strict(),
    handler: async ({ target, offset = 0 }) => {
      assertActive();
      const active = draft && draft.state !== "closed";
      const ids = [...new Set(target === "table" ? tableIds : active ? draft.ids : [])];
      const page = ids.slice(offset, offset + 100);
      page.forEach(onRead);
      return { ids: page, total: ids.length, nextOffset: offset + page.length < ids.length ? offset + page.length : null,
        ...(target === "export" ? { state: active ? draft.state : "closed", ...(active ? { columns: draft.columns, format: draft.format } : {}) } : {}), snapshot: true };
    },
  });
}
