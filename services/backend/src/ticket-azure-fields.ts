import { z } from "zod";
import type { Store } from "./store.js";

export function knownAzureTags(store: Store, source: string) {
  const rows = store.db
    .prepare("SELECT tags FROM ticket_azure_tags WHERE source=?")
    .all(source) as { tags: string }[];
  return [...new Set(rows.flatMap((row) => JSON.parse(row.tags) as string[]))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export const azureTagsInput = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(400)
      .refine(
        (tag) => !/[;\r\n]/.test(tag),
        "Тег не должен содержать точку с запятой или перенос строки",
      ),
  )
  .max(100)
  .transform((tags) => [...new Map(tags.map((tag) => [tag.toLocaleLowerCase(), tag])).values()]);
export const azureTicketFieldsPatch = z
  .object({
    azurePriority: z.number().int().positive().safe().optional(),
    azureTags: azureTagsInput.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Укажите изменяемое поле");
