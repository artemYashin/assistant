import { z } from "zod";
const text = z
  .string()
  .trim()
  .max(300)
  .refine((value) => !/[\r\n]/.test(value), "Используйте одну строку");
const baseAzureLookupSchema = z
  .object({
    ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
    search: text.optional(),
    type: text.optional(),
    state: text.optional(),
    azurePriority: z.array(z.number().int().min(0).max(2147483647)).min(1).max(50).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(
        value.ids?.length ||
        value.search ||
        value.type ||
        value.state ||
        value.azurePriority?.length,
      ),
    "Укажите номера или критерии поиска",
  );
export const azureLookupSchema = baseAzureLookupSchema.refine(
  (value) =>
    !value.ids || !(value.search || value.type || value.state || value.azurePriority?.length),
  "Укажите либо точные ID, либо критерии поиска",
);
export type AzureLookup = z.infer<typeof azureLookupSchema>;
const heading = "Запросить сведения в Azure DevOps?";
export function azureLookupQuestion(plan: AzureLookup, source: string, localCount: number) {
  return `Локальных совпадений по критериям предложенного запроса Azure: ${localCount}. Это не общее количество результатов предыдущих поисков.\n\n${heading}\nПодключение: ${source}\nНомера: ${plan.ids?.join(", ") || "—"}\nНазвание содержит: ${plan.search || "—"}\nТип: ${plan.type || "—"}\nСтатус: ${plan.state || "—"}\nAzure приоритет: ${plan.azurePriority?.join(", ") || "—"}\n\nМожно только показать краткие сведения или запросить и добавить найденные тикеты в локальный список (не более 50 за один поиск). Описания и критерии загружаться не будут. Какой вариант выбрать?`;
}
export function azureLookupConsent(
  prompt: string,
  history: unknown[],
  source: string,
): { plan: AzureLookup; add: boolean } | undefined {
  const last = (history as { role?: string; body?: string }[]).at(-1);
  if (last?.role !== "assistant" || !last.body?.includes(`\n${heading}\n`)) return;
  // Parse only the final canonical plan, never labels quoted in the model summary.
  const lines = last.body.slice(last.body.lastIndexOf(`\n${heading}\n`)).split("\n");
  const value = (label: string) =>
    lines.find((line) => line.startsWith(label))?.slice(label.length);
  if (value("Подключение: ") !== source) return;
  const rawIds = value("Номера: ");
  const field = (label: string) => {
    const v = value(label);
    return v === "—" ? undefined : v;
  };
  const parsed = azureLookupSchema.safeParse({
    ids: rawIds && rawIds !== "—" ? rawIds.split(", ").map(Number) : undefined,
    search: field("Название содержит: "),
    type: field("Тип: "),
    state: field("Статус: "),
    azurePriority: field("Azure приоритет: ")?.split(", ").map(Number),
  });
  if (!parsed.success) return;
  const reply = prompt.split("\n\nВыбранные пользователем тикеты в таблице:")[0].trim();
  // No arbitrary continuation or additional IDs/criteria: approve exactly this plan.
  const prefix = "(?:да[, ]+)?";
  const add = new RegExp(
    `^${prefix}(?:запроси(?:ть)? и добавь|запросить и добавить|получи и добавь|добавь(?: в (?:систему|список))?|покажи и добавь|fetch and add)[.! ]*$`,
    "iu",
  ).test(reply);
  const read = new RegExp(
    `^${prefix}(?:только (?:покажи|показать|сведения|информацию|запросить(?: и показать)?)|просто (?:запроси(?:ть)?|покажи)|запроси(?:ть)?(?: и (?:покажи|показать))?(?: без добавления)?|покажи(?: без добавления)?|read only|fetch only)[.! ]*$`,
    "iu",
  ).test(reply);
  return add || read
    ? {
        plan: {
          ...(parsed.data.ids ? { ids: parsed.data.ids } : {}),
          ...(parsed.data.search ? { search: parsed.data.search } : {}),
          ...(parsed.data.type ? { type: parsed.data.type } : {}),
          ...(parsed.data.state ? { state: parsed.data.state } : {}),
          ...(parsed.data.azurePriority ? { azurePriority: parsed.data.azurePriority } : {}),
        },
        add,
      }
    : undefined;
}
