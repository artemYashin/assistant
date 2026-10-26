import { z } from "zod";
import type { Store } from "./store.js";
import type { CalendarItem } from "./calendar-model.js";
import { fromWall } from "./calendar-time.js";

export const azurePatExpirySchema = z
  .string()
  .refine(
    (value) =>
      value === "" ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
        new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value),
    "Укажите корректную дату истечения PAT.",
  );
export const azurePatReminderId = "7a935ea1-728b-4c86-a467-5cd4d6b679d1";

export function azurePatReminder(store: Store): CalendarItem[] {
  const settings = store.settings();
  const parsed = azurePatExpirySchema.safeParse(settings.azurePatExpiresOn);
  if (!parsed.success || !parsed.data || !store.secret("azure.pat")) return [];
  const start = fromWall(parsed.data + "T00:00", settings.syncSchedule.timeZone);
  return [
    {
      id: azurePatReminderId,
      systemKind: "azure_pat",
      kind: "reminder",
      title: "Истекает токен Azure DevOps",
      description:
        "Обновите PAT и дату его истечения в Настройки → Azure DevOps. Предупреждение начинается за 7 дней и не отключается до обновления срока. Дата указана пользователем; Orbit не проверяет фактический срок токена в Azure.",
      start,
      end: null,
      warningStart: new Date(Date.parse(start) - 7 * 86400000).toISOString(),
      leadMinutes: 10080,
      scope: "general",
      client: "",
      project: "",
      developerIds: [],
      completed: false,
      createdAt: start,
      notificationsHidden: false,
      calendarHidden: false,
      repeatDaily: false,
    },
  ];
}
