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

export const azurePatPreferenceKey = "calendar.azure-pat.preferences";
const preferenceSchema = z.object({
  leadMinutes: z.number().int().min(0).max(525600).nullable().default(null).catch(null),
  notificationsHidden: z.boolean().default(false).catch(false),
  calendarHidden: z.boolean().default(false).catch(false),
});
export function azurePatPreferences(store: Store) {
  const parsed = preferenceSchema.safeParse(store.get(azurePatPreferenceKey, {}));
  return parsed.success ? parsed.data : preferenceSchema.parse({});
}

export function azurePatReminder(store: Store): CalendarItem[] {
  const settings = store.settings();
  const parsed = azurePatExpirySchema.safeParse(settings.azurePatExpiresOn);
  if (!parsed.success || !parsed.data || !store.secret("azure.pat")) return [];
  const preferences = azurePatPreferences(store);
  const leadMinutes = preferences.leadMinutes ?? 10080;
  const start = fromWall(parsed.data + "T00:00", settings.syncSchedule.timeZone);
  return [
    {
      id: azurePatReminderId,
      systemKind: "azure_pat",
      kind: "reminder",
      title: "Истекает токен Azure DevOps",
      description:
        "Обновите PAT и дату его истечения в Настройки → Azure DevOps. Срок предупреждения и видимость можно настроить в этом напоминании; по умолчанию — за 7 дней. Дата указана пользователем; Orbit не проверяет фактический срок токена в Azure.",
      start,
      end: null,
      warningStart: new Date(Date.parse(start) - leadMinutes * 60000).toISOString(),
      leadMinutes: preferences.leadMinutes,
      scope: "general",
      client: "",
      project: "",
      developerIds: [],
      completed: false,
      createdAt: start,
      notificationsHidden: preferences.notificationsHidden,
      calendarHidden: preferences.calendarHidden,
      repeatDaily: false,
    },
  ];
}
