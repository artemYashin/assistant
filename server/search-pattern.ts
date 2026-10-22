import { RE2JS } from "re2js";
import { z } from "zod";
import { AppError } from "./store.js";
import type { Store } from "./store.js";

export const searchModeSchema = z.enum(["literal", "regex"]).default("literal").describe("literal: case-insensitive substring (default). regex: case-insensitive RE2-style pattern, without /.../ delimiters; supports alternatives, groups, classes, anchors. No backreferences or lookaround. Use regex only when it simplifies the requested search.");
export function searchPattern(query: string, mode: "literal" | "regex") {
  if (mode === "literal") return (text: string) => {
    const start = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
    return start < 0 ? null : { start, end: start + query.length };
  };
  try {
    const expression = RE2JS.compile(query, RE2JS.CASE_INSENSITIVE | RE2JS.MULTILINE);
    if (expression.programSize() > 10000) throw new Error("too large");
    return (text: string) => {
      const match = expression.matcher(text);
      return match.find() ? { start: match.start(), end: match.end() } : null;
    };
  } catch {
    throw new AppError(400, "Некорректное или слишком сложное регулярное выражение. Используйте RE2 без обратных ссылок и lookaround, без обрамления /…/.");
  }
}
export function registerTicketPattern(store: Store, query: string, mode: "literal" | "regex") {
  const match = searchPattern(query, mode);
  store.db.function("orbit_ticket_match", { deterministic: true }, (value: unknown) => match(typeof value === "string" ? value : "") ? 1 : 0);
  return match;
}
