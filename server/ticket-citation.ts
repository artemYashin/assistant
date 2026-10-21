import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { Store, AppError } from "./store.js";

const normalize = (text: string) => text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
export function ticketCitationTool(store: Store, assertActive: () => void) {
  return defineTool("cite_ticket_content", {
    description: "Create a verified UI citation to an exact short quote already read from a ticket description, criteria or repro section. Local cache only, no Azure call. Returns quote and link opening the original section with highlighting. Never invent quotes. Read content first; if unavailable/mismatched, report that instead of claiming evidence.",
    parameters: z.object({ id: z.number().int().positive(), section: z.enum(["description", "criteria", "repro"]), quote: z.string().trim().min(3).max(600) }).strict(),
    handler: async ({ id, section, quote }) => {
      assertActive();
      const source = store.source();
      const row = store.db.prepare("SELECT body FROM ticket_content_cache WHERE source=? AND id=? AND section=?").get(source, id, section) as { body: string } | undefined;
      if (!row || !normalize(row.body).includes(normalize(quote))) throw new AppError(400, "Цитата не найдена в кэше этого раздела. Прочитайте точный текст и повторите.");
      return { id, section, quote, originalUrl: `/tickets?${new URLSearchParams({ id: String(id), source, section, quote })}`, note: "Use a blockquote with [Показать в тикете](originalUrl) in its final paragraph, translated to the user's language. UI opens current content; it may have changed since caching." };
    },
  });
}
