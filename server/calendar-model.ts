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
    kind: z.enum(["reminder", "event", "general"]),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(10000).default(""),
    start: z.string().datetime().nullable(),
    end: z.string().datetime().nullable(),
    developerIds: z.array(z.string().min(1).max(100)).max(100).default([]),
  })
  .strict()
  .refine(
    (v) => (v.kind === "general" ? !v.start && !v.end : !!v.start),
    "Укажите дату и время начала.",
  )
  .refine(
    (v) => v.kind === "event" || !v.end,
    "Окончание доступно только для события.",
  )
  .refine(
    (v) => !v.end || (!!v.start && Date.parse(v.end) >= Date.parse(v.start)),
    "Окончание не может быть раньше начала; укажите начало события.",
  );
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
    (!item.end || Date.parse(item.end) > Date.parse(now))
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
      (item.end
        ? Date.parse(item.end)
        : item.kind === "event"
          ? Infinity
          : Date.parse(item.start)) >= Date.parse(from))
  );
}
