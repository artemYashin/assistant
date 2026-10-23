const fieldNames: Record<string, string> = {
  tags: "теги",
  notes: "заметки",
  priority: "локальный приоритет",
  developers: "локальное поручение",
  state: "статус",
  assigned: "исполнитель",
};
export function activityDescription(action: string, raw: string) {
  let data: any;
  let structured = false;
  try {
    data = JSON.parse(raw);
    structured = data !== null && typeof data === "object";
  } catch {
    /* Existing text event. */
  }
  const candidate = action.startsWith("ticket.")
    ? structured
      ? data.id
      : /^#?(\d+)(?:\D|$)/.exec(raw)?.[1]
    : undefined;
  const id =
    Number.isSafeInteger(Number(candidate)) && Number(candidate) > 0
      ? String(candidate)
      : undefined;
  const fields = Array.isArray(data?.fields)
    ? data.fields
        .filter(
          (v: unknown) => typeof v === "string" && fieldNames[v as string],
        )
        .map((v: string) => fieldNames[v])
    : [];
  const summary = fields.length ? "Изменены: " + fields.join(", ") : "";
  const detail =
    structured || /^[\s]*[\[{]/.test(raw)
      ? summary || (id ? "#" + id : "Событие зарегистрировано")
      : raw;
  const category = action.split(".")[0];
  const fallback =
    (
      {
        ticket: "Действие с тикетом",
        pr: "Действие с pull request",
        memory: "Действие с памятью",
        settings: "Изменение настроек",
        sync: "Синхронизация",
      } as Record<string, string>
    )[category] || "Действие в приложении";
  return { id, detail, summary, fallback };
}
