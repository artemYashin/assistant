import { z } from "zod";
import { Calendar } from "./calendar.js";
import { calendarOverlaps, calendarStatus } from "./calendar-model.js";
import { recurringOverlaps } from "./calendar-repeat.js";
import { searchModeSchema, searchPattern } from "./search-pattern.js";
import type { Store } from "./store.js";

const values = z.array(z.string().max(200)).max(100).optional();
export const calendarSearchSchema = z
  .object({
    query: z.string().trim().min(1).max(200).optional(),
    searchMode: searchModeSchema,
    ids: values,
    completed: z.enum(["all", "open", "completed"]).default("all"),
    statuses: z
      .array(
        z.enum([
          "open",
          "upcoming",
          "ongoing",
          "overdue",
          "completed",
          "recurring",
          "today_completed",
        ]),
      )
      .optional(),
    kinds: z
      .array(z.enum(["reminder", "event", "general", "daily", "ticket"]))
      .optional(),
    scopes: z.array(z.enum(["general", "client", "project"])).optional(),
    clients: values,
    projects: values,
    developerIds: values,
    from: z
      .string()
      .datetime()
      .optional()
      .describe(
        "Inclusive date overlap from UTC ISO; undated reminders excluded when date range is provided.",
      ),
    to: z.string().datetime().optional(),
    createdFrom: z.string().datetime().optional(),
    createdTo: z.string().datetime().optional(),
    sortBy: z
      .enum(["start", "end", "deadline", "createdAt", "title"])
      .default("createdAt"),
    sortDirection: z.enum(["asc", "desc"]).default("desc"),
    offset: z.number().int().min(0).max(100000).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict()
  .refine(
    (v) => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to),
    "Начало диапазона позже окончания.",
  )
  .refine(
    (v) =>
      !v.createdFrom ||
      !v.createdTo ||
      Date.parse(v.createdFrom) <= Date.parse(v.createdTo),
    "Начало диапазона создания позже окончания.",
  );

export function searchCalendar(store: Store, input: unknown) {
  const v = calendarSearchSchema.parse(input);
  const calendar = new Calendar(store),
    now = new Date().toISOString();
  const match = v.query ? searchPattern(v.query, v.searchMode) : null;
  const includes = (choices: string[] | undefined, value: string) =>
    !choices?.length || choices.includes(value);
  const rows = calendar.list().filter((item) => {
    const kind = item.ticket
      ? "ticket"
      : item.repeatDaily
        ? "daily"
        : item.kind;
    return (
      (!match || !!match(item.title) || !!match(item.description)) &&
      includes(v.ids, item.id) &&
      (v.completed === "all" ||
        item.completed === (v.completed === "completed")) &&
      includes(v.statuses, calendarStatus(item, now)) &&
      includes(v.kinds, kind) &&
      includes(v.scopes, item.scope) &&
      includes(v.clients, item.client) &&
      includes(v.projects, item.project) &&
      (!v.developerIds?.length ||
        item.developerIds.some((id) => v.developerIds!.includes(id))) &&
      (item.repeatDaily
        ? recurringOverlaps(item, v.from, v.to)
        : calendarOverlaps(item, v.from, v.to)) &&
      (!v.createdFrom ||
        Date.parse(item.createdAt) >= Date.parse(v.createdFrom)) &&
      (!v.createdTo || Date.parse(item.createdAt) <= Date.parse(v.createdTo))
    );
  });
  const value = (item: (typeof rows)[number]) =>
    v.sortBy === "deadline" ? item.ticket?.deadline : item[v.sortBy];
  rows.sort((a, b) => {
    const x = value(a),
      y = value(b);
    if (x == null || y == null)
      return x == null && y == null
        ? a.id.localeCompare(b.id)
        : x == null
          ? 1
          : -1;
    const compared =
      v.sortBy === "title"
        ? x.localeCompare(y, "ru")
        : Date.parse(x) - Date.parse(y);
    return (
      (v.sortDirection === "asc" ? compared : -compared) ||
      a.id.localeCompare(b.id)
    );
  });
  const people = new Map(calendar.developers().map((d: any) => [d.id, d.name]));
  return {
    now,
    timeZone: store.settings().syncSchedule.timeZone,
    total: rows.length,
    nextOffset: v.offset + v.limit < rows.length ? v.offset + v.limit : null,
    reminders: rows.slice(v.offset, v.offset + v.limit).map((item) => ({
      id: item.id,
      title: item.title,
      descriptionSnippet: item.description.slice(0, 240),
      status: calendarStatus(item, now),
      completed: item.completed,
      start: item.start,
      warningStart: item.warningStart,
      end: item.end,
      leadMinutes: item.leadMinutes ?? null,
      effectiveLeadMinutes:
        item.leadMinutes ??
        (item.ticket
          ? store.settings().calendarNotifications.ticketDeadlineLeadMinutes
          : store.settings().calendarNotifications.reminderLeadMinutes),
      createdAt: item.createdAt,
      repeatDaily: !!item.repeatDaily,
      repeatZone: item.repeatZone,
      scope: item.scope,
      client: item.client,
      project: item.project,
      developers: item.developerIds.map((id) => ({
        id,
        name: people.get(id) || id,
      })),
      ticket: item.ticket,
      localUrl: "/calendar?event=" + encodeURIComponent(item.id),
    })),
    note: "All scopes, including completed reminders. Each daily series is one row; status reflects today, not historical occurrences. Array values use OR, separate filters use AND. Missing sort dates are last. Date ranges overlap inclusively. No Azure calls.",
  };
}
