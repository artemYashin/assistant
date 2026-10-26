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
        "Read current UTC time, configured timezone, local developers and scopes before preparing reminders or interpreting relative dates. Resolve vague times from this context or ask a targeted clarification; never use the server timezone instead. No mutations.",
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
            vacationLeadMinutes: store.settings().calendarNotifications.vacationLeadMinutes,
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
        "Search all local reminders, ticket-deadline reminders and daily series across all scopes, including completed/old reminders. Case-insensitive title/description search; optional RE2 regex. Filter completion, status (active means not completed), broad types (reminder includes dated, undated and recurring reminders; ticket means ticket deadlines; vacation means developer leave), detailed kind, scope, clients/projects, developers, inclusive overlapping date ranges or creation dates. Sort and paginate; read compact summaries, no mutations. Use get_calendar_context for relative dates. Daily series return one row; today_completed is distinct from completion of the entire series.",
      parameters: calendarSearchSchema,
      handler: async (input) => {
        assertActive();
        return searchCalendar(store, input);
      },
    }),
    defineTool("get_calendar_reminder", {
      description:
        "Read full local reminder fields before editing, including description, leadMinutes and completed daily dates. No mutations; use search first for exact ID. systemKind=azure_pat is a mandatory read-only token-expiry reminder: cannot edit, hide, complete, reopen or delete; direct the user to Settings → Azure DevOps.",
      parameters: z.object({ id: z.string().uuid() }).strict(),
      handler: async ({ id }) => {
        assertActive();
        const item = new Calendar(store).list().find((item) => item.id === id);
        if (!item) throw new AppError(404, "Напоминание не найдено.");
        return item;
      },
    }),
    defineTool("change_calendar_reminders", {
      description:
        "Immediately complete, reopen or delete one or many reminders on explicit user request, without confirmation dialogs. FIRST search_calendar_reminders and collect all pages before mutating a filtered result (otherwise pagination can skip records). Pass exact IDs and resolve ambiguity. target=reminder for ordinary, ticket deadlines and developer vacations; occurrence for one daily date (day YYYY-MM-DD, omit for today); series for whole daily series. An explicit request to complete ALL reminders includes entire daily series; otherwise clarify ambiguous daily scope. Exclude mandatory systemKind=azure_pat reminders from changes; explain that the token expiry must be updated in Settings → Azure DevOps. Entire batch is atomic: any invalid entry rolls back all changes. Completion never changes Azure ticket state or local deadline. For action=delete, ticket deadline and developer vacation reminders are COMPLETED instead of deleted: preserve the local deadline and vacation dates. Completing a vacation reminder only silences notifications; dates and developer availability do not change. Report deleted and completed counts separately. Delete only whole reminders/series, not an individual occurrence (complete it instead). Return accurate affected count and report failures.",
      parameters: z
        .object({
          action: z.enum(["complete", "reopen", "delete"]),
          items: z
            .array(
              z
                .object({
                  id: z.string().uuid(),
                  target: z.enum(["reminder", "occurrence", "series"]),
                  day: z
                    .string()
                    .regex(/^\d{4}-\d{2}-\d{2}$/)
                    .optional(),
                })
                .strict(),
            )
            .min(1)
            .max(500),
        })
        .strict(),
      handler: async (input) => {
        assertActive();
        const calendar = new Calendar(store);
        const results = store.db.transaction(() => {
          const available = new Map(
            calendar.list().map((item) => [item.id, item]),
          );
          const seen = new Set<string>();
          return input.items
            .map((entry) => {
              assertActive();
              const item = available.get(entry.id);
              if (!item)
                throw new AppError(404, "Напоминание не найдено: " + entry.id);
              if (!!item.repeatDaily !== (entry.target !== "reminder"))
                throw new AppError(
                  400,
                  "Для ежедневной серии выберите итерацию или всю серию; для обычного напоминания — reminder.",
                );
              if (input.action === "delete" && entry.target === "occurrence")
                throw new AppError(
                  400,
                  "Отдельный повтор можно завершить, но удалить можно только всю серию.",
                );
              if (entry.day && entry.target !== "occurrence")
                throw new AppError(
                  400,
                  "Дата итерации применяется только к отдельному повтору.",
                );
              const key = `${entry.id}:${entry.target}:${entry.day || ""}`;
              if (seen.has(key)) return null;
              seen.add(key);
              const action =
                input.action === "delete" && (item.ticket || item.vacation)
                  ? "complete"
                  : input.action;
              if (action === "delete") calendar.remove(entry.id);
              else if (entry.target === "occurrence")
                calendar.completeToday(
                  entry.id,
                  input.action === "complete",
                  new Date(),
                  entry.day,
                );
              else if (action === "complete") calendar.complete(entry.id);
              else calendar.reopen(entry.id);
              return {
                id: item.id,
                title: item.title,
                target: entry.target,
                day: entry.day,
                action,
              };
            })
            .filter((result) => result !== null);
        })();
        send?.({ stage: "calendar_changed" });
        return {
          changed: true,
          count: results.length,
          deleted: results.filter((r) => r.action === "delete").length,
          completed: results.filter((r) => r.action === "complete").length,
          reopened: results.filter((r) => r.action === "reopen").length,
          reminders: results,
        };
      },
    }),
    defineTool("update_calendar_visibility", {
      description: "On explicit user request hide or show any reminder, ticket deadline or developer vacation independently in notifications or the calendar grid. Search exact ID first. Hidden entries remain in reminders and are not completed or deleted. Omitted flags are preserved. systemKind=azure_pat reminders cannot be hidden; direct the user to Settings → Azure DevOps. No confirmation popup.",
      parameters: z.object({
        id: z.string().uuid(),
        notificationsHidden: z.boolean().optional(),
        calendarHidden: z.boolean().optional(),
      }).strict(),
      handler: async ({ id, ...values }) => {
        assertActive();
        new Calendar(store).setVisibility(id, values);
        send?.({ stage: "calendar_changed" });
        return { saved: true, id, ...values };
      },
    }),
    defineTool("update_calendar_warning", {
      description:
        "Immediately change an existing reminder's individual advance warning on explicit user request, including ticket deadlines and daily series. Search for exact ID first. leadMinutes=null restores global default; 0 means at start/deadline. No confirmation popup. Does not change deadline, completion or Azure.",
      parameters: z
        .object({
          id: z.string().uuid(),
          leadMinutes: z.number().int().min(0).max(525600).nullable(),
        })
        .strict(),
      handler: async ({ id, leadMinutes }) => {
        assertActive();
        new Calendar(store).setLead(id, leadMinutes);
        send?.({ stage: "calendar_changed" });
        return { saved: true, id, leadMinutes };
      },
    }),
    defineTool("save_calendar_reminder", {
      description:
        "Immediately create or edit a reminder on explicit user request, without confirmation UI. Omit id to create; for editing search exact ID then get_calendar_reminder for full content and preserve unrequested fields. FIRST get_calendar_context for relative times and timezone, use UTC ISO dates. reminder.start=null/end=null means undated; start with end=null means timed; start/end means duration. repeatDaily=true repeats on reminder.repeatWeekdays (ISO 1 Monday to 7 Sunday, omitted=all seven days, at least one). duration max 24 hours. For без времени use start=null,end=null,repeatDaily=false: always-active undated reminder until manually completed. For new reminders OMIT leadMinutes or use null to inherit warningDefaults; only set a number when the user explicitly requests a custom advance warning. A request to remind in five minutes sets start=now+5min, NOT leadMinutes=0 or 5. Inherited advance warning may make a new reminder eligible immediately. For edits preserve existing leadMinutes unless asked to change it. Optional local developerIds and general/client/project scope. Never edit developer vacation dates through this tool; use set_developer_vacation after resolving the developer. Never edit ticket deadline through this tool: use update_local_ticket_metadata for the date and update_calendar_warning for advance. Report saved only after success. If the requested time remains ambiguous after get_calendar_context, clarify it before saving.",
      parameters: z
        .object({
          id: z.string().uuid().optional(),
          reminder: calendarDraftSchema,
        })
        .strict(),
      handler: async ({ id, reminder }) => {
        assertActive();
        const result = new Calendar(store).save(
          calendarInput.parse(reminder),
          id,
        );
        send?.({ stage: "calendar_changed" });
        const saved = new Calendar(store).list().find(item => item.id === result.id)!;
        const leadMinutes = saved.leadMinutes ?? store.settings().calendarNotifications.reminderLeadMinutes;
        return {
          saved: true,
          id: result.id,
          title: reminder.title,
          created: !id,
          start: saved.start,
          leadMinutes: saved.leadMinutes,
          effectiveLeadMinutes: leadMinutes,
          warningStart: saved.start ? new Date(Date.parse(saved.start) - leadMinutes * 60000).toISOString() : null,
        };
      },
    }),
  ];
}
