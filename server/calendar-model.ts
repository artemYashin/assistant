import { wallTime } from "./calendar-time.js";
import { z } from "zod";
import { syncScheduleSchema } from "./sync-schedule.js";

export const calendarNotificationsSchema = z
  .object({
    ticketDeadlineLeadMinutes: z
      .number()
      .int()
      .min(0)
      .max(525600)
      .default(1440),
    vacationLeadMinutes: z.number().int().min(0).max(525600).default(1440),
    reminderLeadMinutes: z.number().int().min(0).max(525600).default(0),
    browser: z.boolean().default(false),
    intervalMinutes: z.number().int().min(1).max(10080).default(60),
    schedule: syncScheduleSchema.default(() => syncScheduleSchema.parse({})),
  })
  .strict();
export const calendarDraftSchema = z
  .object({
    leadMinutes: z
      .number()
      .int()
      .min(0)
      .max(525600)
      .nullable()
      .optional()
      .describe(
        "Individual advance warning in minutes; null or omitted uses calendar defaults. On creation omit or use null unless the user explicitly requests a custom warning interval. A request to remind in five minutes specifies start, not leadMinutes. Applies to every daily occurrence.",
      ),
    repeatWeekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .optional()
      .describe(
        "ISO weekdays for repeating reminders: 1 Monday through 7 Sunday. Omit for every day. At least one selected day.",
      ),
    repeatDaily: z
      .boolean()
      .optional()
      .describe(
        "Repeat daily from start date at the same local time; one series, completing today silences today only; completing the series stops all future occurrences.",
      ),
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
  .refine(
    (v) =>
      !v.repeatDaily ||
      (!!v.start &&
        (!v.end || Date.parse(v.end) - Date.parse(v.start) <= 86400000)),
    "Для ежедневного повтора укажите начало; длительность — не больше суток.",
  );
export const calendarInput = calendarDraftSchema.transform((v) => ({
  ...v,
  kind: !v.start
    ? ("general" as const)
    : v.end
      ? ("event" as const)
      : ("reminder" as const),
}));
export type CalendarItem = z.infer<typeof calendarInput> & {
  warningStart?: string;
  repeatZone?: string;
  occurrenceDay?: string;
  completedDays?: string[];
  vacation?: {
    developerId: string;
    start: string;
    end: string;
    zone: string;
    returnDate: string;
  };
  ticket?: { id: number; source: string; deadline: string };
  id: string;
  completed: boolean;
  createdAt: string;
};
export function calendarStatus(
  item: Pick<
    CalendarItem,
    | "start"
    | "end"
    | "completed"
    | "kind"
    | "ticket"
    | "warningStart"
    | "repeatDaily"
    | "repeatWeekdays"
    | "repeatZone"
    | "completedDays"
    | "occurrenceDay"
  >,
  now = new Date().toISOString(),
) {
  if (item.completed) return "completed";
  // A ticket's actual deadline wins over warning start, end or stale event kind.
  if (item.ticket) {
    if (Date.parse(item.ticket.deadline) <= Date.parse(now)) return "overdue";
    return (item.warningStart || item.start) &&
      Date.parse(item.warningStart || item.start!) > Date.parse(now)
      ? "upcoming"
      : "ongoing";
  }
  if (!item.start) return "open";
  if (item.repeatDaily)
    return !item.occurrenceDay &&
      item.completedDays?.includes(
        wallTime(now, item.repeatZone || "UTC").slice(0, 10),
      )
      ? "today_completed"
      : "recurring";
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
  item: Pick<CalendarItem, "start" | "end" | "kind" | "ticket">,
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

/** Recurrence describes a series, independently of today's completion state. */
export function calendarMatchesStatus(
  item: CalendarItem,
  statuses: string[] = [],
  now = new Date().toISOString(),
) {
  return (
    !statuses.length ||
    statuses.some((status) =>
      status === "active"
        ? !item.completed
        : status === "recurring"
          ? !!item.repeatDaily
          : calendarStatus(item, now) === status,
    )
  );
}

/** Broad category shared by the calendar UI and assistant search. */
export function calendarMatchesType(item: CalendarItem, types: string[] = []) {
  return (
    !types.length ||
    types.includes(
      item.vacation ? "vacation" : item.ticket ? "ticket" : "reminder",
    )
  );
}
