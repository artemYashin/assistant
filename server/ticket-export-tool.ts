import type { TicketExportContext } from "./ticket-export-context.js";
import { exportColumnSchema } from "./ticket-export-context.js";
import { exportColumns } from "./ticket-export-columns.js";
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { Store, AppError } from "./store.js";
import { localTicketScope } from "./local-ticket-scope.js";
import type { ChatProgress } from "./chat-stream.js";

export function ticketExportTool(
  store: Store,
  assertActive: () => void,
  send?: (event: ChatProgress) => void,
  draft?: TicketExportContext,
  edit = false,
) {
  const source = store.source();
  return defineTool(edit ? "edit_ticket_export" : "show_ticket_export", {
    description: (edit
      ? "Edit an existing open or minimized Excel/CSV export only: addIds adds local tickets, removeIds removes tickets from this export only (never deletes tickets). Removal wins if an ID appears in both. Omitted arrays preserve tickets. Optional columns replaces enabled columns in supplied order. Keeps minimized state. Before EVERY edit_ticket_export call, first call read_selected_tickets(target='export', offset=0), including column-only edits and repeated edits in the same turn. Follow nextOffset until null before changing ticket membership. Compare the selected IDs and column order with the user request: add only absent IDs, remove only selected IDs, preserve unrequested tickets/columns, and skip no-op edits. This is the current request snapshot plus previously dispatched edits, not live UI polling. No Azure, download or confirmation. Dispatch is a UI request, not proof of completion."
      : "Open the Excel/CSV export with local ticket IDs when no export is active. For an open/minimized export use edit_ticket_export instead. Optional columns sets enabled fields in order. No Azure, download or confirmation; user downloads in UI.") + " Read selected table/export summaries with read_selected_tickets only when relevant (id/title/state/type by default, extra fields on demand). Never claim a file was downloaded. Missing IDs need separate explicit import authorization; do not silently import.",
    parameters: z
      .object({
        columns: z
          .array(exportColumnSchema)
          .min(1)
          .max(exportColumns.length)
          .optional()
          .describe(
            "Complete enabled columns in desired order; replaces column selection only, NEVER ticket selection. Omit to preserve columns. For adding a column include existing columns from read_selected_tickets(target=export). Keys: " +
              exportColumns.map((c) => `${c.key}=${c.label}`).join("; "),
          ),
        ids: z.array(z.number().int().positive()).max(200).optional().describe("Opening only: initial ticket IDs."),
        addIds: z.array(z.number().int().positive()).max(200).optional().describe("Editing only: IDs to add."),
        removeIds: z.array(z.number().int().positive()).max(200).optional().describe("Editing only: IDs to remove from the export."),

      })
      .strict(),
    handler: async ({ ids, addIds, removeIds, columns }) => {
      const mode = edit ? "edit" : "open";
      if (edit && (!draft || draft.state === "closed"))
        throw new AppError(409, "Экспорт закрыт. Сначала откройте окно экспорта.");
      if (edit ? ids !== undefined : addIds !== undefined || removeIds !== undefined)
        throw new AppError(400, "Для открытия используйте ids, для редактирования — addIds и removeIds.");
      const removed = [...new Set(removeIds || [])];
      assertActive();
      if (store.source() !== source)
        throw new AppError(409, "Подключение Azure изменилось");
      if (!send)
        throw new AppError(
          409,
          "Открытие экспорта требует подключённого интерфейса чата",
        );
      const unique = [...new Set(edit ? addIds || [] : ids || [])].filter(id => !removed.includes(id));
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
      const chosenColumns = columns ? [...new Set(columns)] : undefined;
      const requested = !!(available.length || !unique.length || chosenColumns || removed.length);
      if (requested)
        send({
          stage: "ticket_export",
          ids: available,
          mode,
          ...(edit ? { removeIds: removed } : {}),
          ...(chosenColumns ? { columns: chosenColumns } : {}),
        });
      if (draft && requested) {
        draft.ids = [...new Set([...draft.ids, ...available])].filter(id => !removed.includes(id));
        draft.total = draft.ids.length;
        if (!edit) draft.state = "open";
        if (chosenColumns) draft.columns = chosenColumns;
      }
      return {
        removeIds: removed,
        requested,
        ...(chosenColumns ? { columns: chosenColumns } : {}),
        ids: available,
        missing,
        mode,
        note: "Only requested export edits were dispatched; other selected tickets are preserved. No file has been downloaded; user completes export in UI. Missing IDs were not imported.",
      };
    },
  });
}
