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
    priority: z.number().int().min(1).max(20).optional(),
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
  isKnownTicket: (id: number) => boolean = () => false,
  requireResolvedTicket = false,
) {
  const source = store.source();
  const written = new Map<string, string>();
  return [
    defineTool("update_local_ticket_metadata", {
      description:
        "Edit LOCAL notes, priority and tags on explicit current-user request. Ticket ID must be in the message or retrieved via list_tickets/get_ticket/get_local_ticket_metadata during this turn. For tickets from conversation history, validate all IDs together with list_tickets({ids:[...]}), not one get_local_ticket_metadata call per ticket. Never writes Azure. For notes use append unless replacement/clearing was explicitly requested. For tags use add/remove to preserve others; replace/clear only explicitly. Omit unchanged fields. P1 is highest; project priority limits are validated. Repeating the same operation is idempotent within this message. Confirm only success=true.",
      parameters: editMetadataSchema,
      handler: async (input) => {
        assertActive();
        const args = editMetadataSchema.parse(input);
        const hasId =
          (!requireResolvedTicket &&
            new RegExp(`(?<![0-9])${args.id}(?![0-9])`).test(prompt)) ||
          isKnownTicket(args.id);
        const command =
          /добавь|добавит|допиши|дописать|запиши|записать|поставь|поставить|установи|выстави|измени|изменить|поменяй|обнови|замени|заменить|убери|удали|удалить|очисти|присвой|присвоить|пометь|clear|replace|append|add|remove|update|set\b/iu.test(
            prompt,
          );
        const denied =
          /не\s+(?:меняй|изменяй|добавляй|удаляй|очищай|заменяй|записывай|ставь|присваивай|помечай|присвой|пометь)|не надо|не нужно|do not|don't/iu.test(
            prompt,
          );
        if (!hasId || !command || denied)
          throw new AppError(
            403,
            "Нужна явная просьба изменить локальные поля. Номер тикета должен быть в сообщении или получен через list_tickets/get_ticket/get_local_ticket_metadata в этом запросе.",
          );
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
        const fieldNames = {
          notes: /замет|note/iu,
          priority: /приоритет|priority|\bP\s*\d/iu,
          tags: /тег|тэг|tag/iu,
        };
        const patch: Record<string, any> = {};
        const pending: [string, string][] = [];
        const current = ticketMetadata(store, args.id, source);
        for (const field of ["notes", "priority", "tags"] as const) {
          const operation = args[field];
          if (operation === undefined) continue;
          if (!fieldNames[field].test(prompt))
            throw new AppError(403, "В сообщении не указано поле: " + field);
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
            if (!new RegExp(`(?<![0-9])${value}(?![0-9])`).test(prompt))
              throw new AppError(403, "Укажите номер приоритета в сообщении.");
            patch.priority = value;
          } else if (field === "notes") {
            const op = args.notes!;
            if (op.mode !== "clear" && !op.text)
              throw new AppError(400, "Укажите текст заметки");
            if (
              op.mode === "clear" &&
              !/очист|удали.*замет|убери.*замет|clear|remove.*notes/iu.test(
                prompt,
              )
            )
              throw new AppError(
                403,
                "Для очистки заметки нужна явная просьба.",
              );
            if (
              op.mode === "replace" &&
              !/замени|заменить|перепиши|перезапиши|replace|rewrite|overwrite/iu.test(
                prompt,
              )
            )
              throw new AppError(
                403,
                "Для замены заметки нужна явная просьба; используйте добавление.",
              );
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
            if (
              op.mode === "clear" &&
              !/очист|все теги|все тэги|clear|all tags/iu.test(prompt)
            )
              throw new AppError(
                403,
                "Для удаления всех тегов нужна явная просьба.",
              );
            if (
              op.mode === "replace" &&
              !/замени|заменить|replace|overwrite/iu.test(prompt)
            )
              throw new AppError(
                403,
                "Для замены всех тегов нужна явная просьба.",
              );
            if (
              op.mode === "remove" &&
              !/убери|удали|удалить|remove/iu.test(prompt)
            )
              throw new AppError(
                403,
                "Для удаления тегов нужна явная просьба.",
              );
            if (
              (op.values || []).some(
                (tag) =>
                  !prompt.toLocaleLowerCase().includes(tag.toLocaleLowerCase()),
              )
            )
              throw new AppError(403, "Укажите изменяемые теги в сообщении.");
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
