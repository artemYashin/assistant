import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { Store, AppError, type Context } from "./store.js";
import { saveTicketMetadata, ticketMetadata } from "./ticket-metadata.js";

export const editMetadataSchema = z
  .object({
    id: z.number().int().positive(),
    notes: z
      .object({
        mode: z.enum(["append", "replace", "clear"]),
        text: z.string().trim().min(1).max(20000).optional(),
      })
      .strict()
      .optional(),
    priority: z.number().int().positive().safe().optional(),
    tags: z
      .object({
        mode: z.enum(["add", "remove", "replace", "clear"]),
        values: z
          .array(z.string().trim().min(1).max(60))
          .min(1)
          .max(30)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) => v.notes || v.priority !== undefined || v.tags,
    "Укажите изменяемое поле",
  );

export function ticketMetadataTools(
  store: Store,
  context: Context,
  prompt: string,
  assertActive: () => void,
) {
  const source = store.source();
  const written = new Map<string, string>();
  return [
    defineTool("update_local_ticket_metadata", {
      description:
        "Edit LOCAL notes, priority and tags according to the user request and conversation context, including a short confirmation of the preceding plan. IDs and values may come from earlier messages; no repeated read is required for an unambiguous existing selection. If the selection is unclear, clarify or resolve it with one list_tickets call. Ask for conversational confirmation before bulk changes. Never writes Azure. For notes use append unless replacement/clearing was explicitly requested. For tags use add/remove to preserve others; replace/clear only explicitly. Omit unchanged fields. Local priority is a positive integer, 1 is highest/default; there is no configured level count. Repeating the same operation is idempotent within this message. Confirm only success=true.",
      parameters: editMetadataSchema,
      handler: async (input) => {
        assertActive();
        const args = editMetadataSchema.parse(input);
        const excluded = [
          ...prompt.matchAll(
            /(?:кроме|исключая|except|excluding)\s+(?:(?:тикет(?:а|ов)?|задач(?:и|у)?|ticket)\s*)?#?(\d+)(?!\d)/giu,
          ),
        ].map((match) => Number(match[1]));
        if (excluded.includes(args.id))
          throw new AppError(
            403,
            "Этот тикет исключён пользователем из изменения",
          );
        if (source !== store.source())
          throw new AppError(409, "Подключение изменилось. Повторите запрос.");
        const patch: Record<string, any> = {};
        const pending: [string, string][] = [];
        const current = ticketMetadata(store, args.id, source);
        for (const field of ["notes", "priority", "tags"] as const) {
          const operation = args[field];
          if (operation === undefined) continue;
          const key = args.id + ":" + field,
            signature = JSON.stringify(operation);
          if (written.has(key)) {
            if (written.get(key) !== signature)
              throw new AppError(
                409,
                "Одно изменение каждого поля за сообщение. Отправьте следующую команду отдельно.",
              );
            continue;
          }
          pending.push([key, signature]);
          if (field === "priority") {
            const value = args.priority!;
            patch.priority = value;
          } else if (field === "notes") {
            const op = args.notes!;
            if (op.mode !== "clear" && !op.text)
              throw new AppError(400, "Укажите текст заметки");
            patch.notes =
              op.mode === "clear"
                ? ""
                : op.mode === "append"
                  ? [current.notes, op.text].filter(Boolean).join("\n\n")
                  : op.text;
          } else {
            const op = args.tags!;
            if (op.mode !== "clear" && !op.values?.length)
              throw new AppError(400, "Укажите теги");
            patch.tags =
              op.mode === "clear"
                ? []
                : op.mode === "replace"
                  ? op.values
                  : op.mode === "add"
                    ? [...current.tags, ...op.values!]
                    : current.tags.filter(
                        (tag) =>
                          !op.values!.some(
                            (v) =>
                              v.toLocaleLowerCase() === tag.toLocaleLowerCase(),
                          ),
                      );
          }
        }
        if (pending.length) {
          saveTicketMetadata(store, args.id, source, context, patch);
          for (const [key, signature] of pending) written.set(key, signature);
          store.audit(
            "ticket.metadata_updated_by_chat",
            JSON.stringify({ id: args.id, fields: Object.keys(patch) }),
          );
        }
        const result = ticketMetadata(store, args.id, source);
        return {
          success: true,
          id: args.id,
          scope: "local",
          azureChanged: false,
          priority: result.priority,
          tags: result.tags,
          notes: result.notes.slice(0, 300),
          notesTruncated: result.notes.length > 300,
          changedFields: Object.keys(patch),
        };
      },
    }),
  ];
}
