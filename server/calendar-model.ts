import { z } from "zod";
import { syncScheduleSchema } from "./sync-schedule.js";

export const calendarNotificationsSchema = z
  .object({
    browser: z.boolean().default(false),
    intervalMinutes: z.number().int().min(1).max(10080).default(60),
    schedule: syncScheduleSchema.default(() => syncScheduleSchema.parse({})),
  })
  .strict();
export const calendarInput = z
  .object({
    kind: z.enum(["reminder", "event", "general"]).optional(),
    scope: z.enum(["general", "client", "project"]).default("general"),
    client: z.string().trim().max(200).default(""),
    project: z.string().trim().max(200).default(""),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(10000).default(""),
    start: z.string().datetime().nullable(),
    end: z.string().datetime().nullable(),
    developerIds: z.array(z.string().min(1).max(100)).max(100).default([]),
  })
  .strict()
  .refine(
    (v) =>
      v.scope === "general"
        ? !v.client && !v.project
        : v.scope === "client"
          ? !!v.client && !v.project
          : !!v.client && !!v.project,
    "Выберите заказчика и проект для уровня напоминания.",
  )
  .refine(
    (v) => !v.end || (!!v.start && Date.parse(v.end) >= Date.parse(v.start)),
    "Окончание не может быть раньше начала; укажите начало события.",
  )
  .transform((v) => ({
    ...v,
    kind: !v.start
      ? ("general" as const)
      : v.end
        ? ("event" as const)
        : ("reminder" as const),
  }));
export type CalendarItem = z.infer<typeof calendarInput> & {
  id: string;
  completed: boolean;
  createdAt: string;
};
export function calendarStatus(
  item: Pick<CalendarItem, "start" | "end" | "completed" | "kind">,
  now = new Date().toISOString(),
) {
  if (item.completed) return "completed";
  if (!item.start) return "open";
  if (Date.parse(item.start) > Date.parse(now)) return "upcoming";
  if (
    item.kind === "event" &&
    item.end &&
    Date.parse(item.end) > Date.parse(now)
  )
    return "ongoing";
  // A start without an end is a timed reminder, not an automatically completed event.
  return "overdue";
}
export function calendarOverlaps(
  item: Pick<CalendarItem, "start" | "end" | "kind">,
  from?: string,
  to?: string,
) {
  if (!item.start) return !from && !to;
  return (
    (!to || Date.parse(item.start) <= Date.parse(to)) &&
    (!from ||
      (item.end ? Date.parse(item.end) : Date.parse(item.start)) >=
        Date.parse(from))
  );
}
