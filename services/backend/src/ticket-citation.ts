import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { Store, AppError } from "./store.js";

const normalize = (text: string) => text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
export type TicketCitationEvidence = {
  source: string;
  tickets: {
    id: number;
    description: string;
    criteria: string;
    repro: string;
    systemInfo?: string;
  }[];
};
export function ticketCitationTool(
  store: Store,
  assertActive: () => void,
  evidence?: TicketCitationEvidence,
) {
  return defineTool("cite_ticket_content", {
    description:
      (evidence
        ? "Verify only against the linked ticket sections already supplied to this review; IDs outside that evidence are not allowed. "
        : "") +
      "Create a verified UI citation to an exact short quote already read from a ticket description, criteria, repro or systemInfo section. Uses supplied review evidence or local cache only, no Azure call. Returns quote and link opening the original section with highlighting. Never invent quotes. Read content first; if unavailable/mismatched, report that instead of claiming evidence.",
    parameters: z
      .object({
        id: z.number().int().positive(),
        section: z.enum(["description", "criteria", "repro", "systemInfo"]),
        quote: z.string().trim().min(3).max(600),
      })
      .strict(),
    handler: async ({ id, section, quote }) => {
      assertActive();
      const source = evidence?.source ?? store.source();
      if (source !== store.source())
        throw new AppError(
          409,
          "Подключение Azure изменилось. Цитата относится к исходному подключению ревью.",
        );
      const ticket = evidence?.tickets.find((ticket) => ticket.id === id);
      const row = evidence
        ? ticket
          ? { body: ticket[section] }
          : undefined
        : (store.db
            .prepare("SELECT body FROM ticket_content_cache WHERE source=? AND id=? AND section=?")
            .get(source, id, section) as { body: string } | undefined);
      if (!row || !normalize(row.body || "").includes(normalize(quote)))
        throw new AppError(
          400,
          "Цитата не найдена в доступном тексте этого раздела. Используйте точную цитату из прочитанного тикета.",
        );
      return {
        id,
        section,
        quote,
        originalUrl: `/tickets?${new URLSearchParams({ id: String(id), source, section, quote })}`,
        note: "Use a blockquote with [Показать в тикете](originalUrl) in a separate final paragraph, preceded by a blank quoted line (>), never on the same line as the quote text, translated to the user's language. UI opens current content; it may have changed since this evidence was read.",
      };
    },
  });
}
