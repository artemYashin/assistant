import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { Store, AppError } from "./store.js";
import { localTicketScope } from "./local-ticket-scope.js";
import type { ChatProgress } from "./chat-stream.js";

export function ticketExportTool(
  store: Store,
  assertActive: () => void,
  send?: (event: ChatProgress) => void,
) {
  const source = store.source();
  return defineTool("show_ticket_export", {
    description:
      "Open the Excel/CSV export composer with local ticket IDs, or add more IDs to its existing list. Use on explicit user requests to prepare/export tickets or add tickets to export. mode=open expands the composer; mode=add keeps an existing minimized composer minimized. Both preserve existing tickets, format and column order, deduplicate IDs; if no draft exists, create one. Empty ids opens an empty composer. No Azure requests, import, file download or confirmation. User chooses columns/format and downloads in UI. Returns IDs and missing IDs only, never ticket bodies. UI dispatch is a request, not proof a file was downloaded.",
    parameters: z
      .object({
        ids: z.array(z.number().int().positive()).max(200),
        mode: z.enum(["open", "add"]).default("open"),
      })
      .strict(),
    handler: async ({ ids, mode = "open" }) => {
      assertActive();
      if (store.source() !== source)
        throw new AppError(409, "Подключение Azure изменилось");
      if (!send)
        throw new AppError(
          409,
          "Открытие экспорта требует подключённого интерфейса чата",
        );
      const unique = [...new Set(ids)];
      const rows = unique.length
        ? (store.db
            .prepare(
              `${localTicketScope()} SELECT id FROM local_tickets WHERE source=? AND id IN (${unique.map(() => "?").join(",")})`,
            )
            .all(source, ...unique) as { id: number }[])
        : [];
      const found = new Set(rows.map((row) => row.id));
      const available = unique.filter((id) => found.has(id));
      const missing = unique.filter((id) => !found.has(id));
      if (available.length || !unique.length)
        send({ stage: "ticket_export", ids: available, mode });
      return {
        requested: available.length > 0 || unique.length === 0,
        ids: available,
        missing,
        mode,
        note: "Existing export selection is preserved. No file has been downloaded; user completes export in UI. Missing IDs were not imported.",
      };
    },
  });
}
