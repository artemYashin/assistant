import { searchCalendar, calendarSearchSchema } from "./calendar-search.js";
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { Calendar } from "./calendar.js";
import { calendarInput, calendarDraftSchema } from "./calendar-model.js";
import { Store, AppError } from "./store.js";
import type { ChatProgress } from "./chat-stream.js";

export function calendarTools(
  store: Store,
  assertActive: () => void,
  send?: (event: ChatProgress) => void,
) {
  return [
    defineTool("get_calendar_context", {
      description:
        "Read current UTC time, configured timezone, local developers and scopes before preparing reminders or interpreting relative dates. No mutations.",
      parameters: z.object({}).strict(),
      handler: async () => {
        assertActive();
        const timeZone = store.settings().syncSchedule.timeZone;
        return {
          now: new Date().toISOString(),
          timeZone,
          localTime: new Date().toLocaleString("sv-SE", { timeZone }),
          developers: new Calendar(store).developers(),
          contexts: store.contexts(),
          warningDefaults: {
            reminderLeadMinutes:
              store.settings().calendarNotifications.reminderLeadMinutes,
            ticketDeadlineLeadMinutes:
              store.settings().calendarNotifications.ticketDeadlineLeadMinutes,
          },
        };
      },
    }),
    defineTool("search_calendar_reminders", {
      description:
        "Search all local reminders, ticket-deadline reminders and daily series across all scopes, including completed/old reminders. Case-insensitive title/description search; optional RE2 regex. Filter completion, status, kind, scope, clients/projects, developers, inclusive overlapping date ranges or creation dates. Sort and paginate; read compact summaries, no mutations. Use get_calendar_context for relative dates. Daily series return one row; today_completed is distinct from completion of the entire series.",
      parameters: calendarSearchSchema,
      handler: async (input) => {
        assertActive();
        return searchCalendar(store, input);
      },
    }),
    defineTool("prepare_calendar_status_change", {
      description:
        "On explicit user request prepare a confirmation popup to complete or reopen a reminder. First search_calendar_reminders to obtain its exact ID and resolve ambiguity. completed=true completes; false reopens. target=reminder for ordinary/ticket-deadline reminders, today for a daily occurrence (optional day YYYY-MM-DD selects a specific date in series timezone, including tomorrow; omitted means today), series for the entire daily series ONLY if explicitly requested; clarify ambiguous daily completion. Never claim changed until user confirms: this only opens a dialog. Completion does not change Azure ticket status, deadline date, or global notification timer.",
      parameters: z
        .object({
          id: z.string().uuid(),
          completed: z.boolean(),
          target: z.enum(["reminder", "today", "series"]),
          day: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        })
        .strict(),
      handler: async (input) => {
        assertActive();
        if (!send)
          throw new AppError(
            409,
            "Изменение напоминания требует открытого интерфейса чата.",
          );
        const item = new Calendar(store)
          .list()
          .find((item) => item.id === input.id);
        if (!item) throw new AppError(404, "Напоминание не найдено.");
        if (!!item.repeatDaily !== (input.target !== "reminder"))
          throw new AppError(
            400,
            "Для ежедневной серии выберите сегодня или всю серию; для обычного напоминания — reminder.",
          );
        if (input.day && input.target !== "today")
          throw new AppError(
            400,
            "Дата итерации применяется только к отдельному повтору.",
          );
        send({ stage: "calendar_status", request: input });
        return {
          requested: true,
          changed: false,
          id: item.id,
          title: item.title,
          note: "User must confirm in calendar UI.",
        };
      },
    }),
    defineTool("prepare_calendar_warning_change", {
      description:
        "On explicit request open an existing reminder (including ticket deadlines and daily series) to confirm its individual advance warning. First search_calendar_reminders for exact ID. leadMinutes=null restores global default; 0 means at start/deadline. Does not change date, completion, or Azure. User must save and confirm in UI.",
      parameters: z
        .object({
          id: z.string().uuid(),
          leadMinutes: z.number().int().min(0).max(525600).nullable(),
        })
        .strict(),
      handler: async ({ id, leadMinutes }) => {
        assertActive();
        if (!send)
          throw new AppError(
            409,
            "Изменение напоминания требует открытого интерфейса чата.",
          );
        const item = new Calendar(store).list().find((item) => item.id === id);
        if (!item) throw new AppError(404, "Напоминание не найдено.");
        send({ stage: "calendar_draft", draft: { ...item, leadMinutes } });
        return {
          requested: true,
          saved: false,
          id,
          title: item.title,
          leadMinutes,
          note: "User must save and confirm in calendar UI.",
        };
      },
    }),
    defineTool("prepare_calendar_reminder", {
      description:
        "On explicit user request prepare the calendar creation form; user reviews and confirms creation in UI. FIRST get_calendar_context to resolve relative dates (in ten minutes, tonight) in configured timezone, then use UTC ISO dates. start=null/end=null means no date; start plus end=null means timed reminder; start/end means duration. repeatDaily=true repeats daily from start at the configured local time, as one series; duration must not exceed 24 hours. All persist until manually completed (daily reminders allow completing today or the whole series; unfinished occurrences notify at the configured interval). Optional leadMinutes sets individual advance warning (null inherits settings), including before midnight for tomorrow’s daily occurrence. Optional local developerIds and general/client/project scope. Do not claim saved: this only opens an editable draft. Never use for ticket deadline: use update_local_ticket_metadata(localDeadline) instead.",
      parameters: calendarDraftSchema,
      handler: async (input) => {
        assertActive();
        if (!send)
          throw new AppError(
            409,
            "Создание напоминания требует открытого интерфейса чата.",
          );
        const draft = calendarInput.parse(input);
        send({ stage: "calendar_draft", draft });
        return {
          requested: true,
          saved: false,
          note: "Confirm creation in the calendar form.",
        };
      },
    }),
  ];
}
