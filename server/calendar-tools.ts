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
        };
      },
    }),
    defineTool("prepare_calendar_reminder", {
      description:
        "On explicit user request prepare the calendar creation form; user reviews and confirms creation in UI. FIRST get_calendar_context to resolve relative dates (in ten minutes, tonight) in configured timezone, then use UTC ISO dates. start=null/end=null means no date; start plus end=null means timed reminder; start/end means duration. All persist until manually completed. Optional local developerIds and general/client/project scope. Do not claim saved: this only opens an editable draft. Never use for ticket deadline: use update_local_ticket_metadata(localDeadline) instead.",
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
