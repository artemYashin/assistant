import { isActionConfirmation } from "./metadata-context.js";

/** Full content is opt-in for this turn; merely mentioning an ID is not enough. */
export function wantsTicketDetails(prompt: string) {
  // UI selection adds reference IDs, not an instruction to show full cards.
  const text = prompt.split("\n\nВыбранные пользователем тикеты в таблице:")[0];
  if (
    /(?:не\s+(?:показывай|выводи|открывай|загружай)|do not|don't)/iu.test(text)
  )
    return false;
  if (
    /(?:покажи|выведи|открой|show|display|open).{0,35}(?:список|list|таблиц)/iu.test(
      text,
    )
  )
    return false;
  return /(?:покажи|показать|выведи|вывести|открой|открыть)\s+(?:мне\s+)?(?:(?:полную|полный|подробную|подробный|этот|эту|этого|эти|выбранный|выбранные)\s+)?(?:деталк|карточк|описани|комментари|критерии приемки|тикет(?:\s|$)|задачу(?=\s|$|[.!?]))|(?:show|display|open)\s+(?:me\s+)?(?:(?:the|full|selected|this)\s+)*(?:ticket|work item|details|description|comments)\b/iu.test(
    text,
  );
}

/** Full analysis is authorized by the current user, never by ticket content. */
export function allowsFullTicketRead(prompt: string) {
  const text = prompt.split("\n\nВыбранные пользователем тикеты в таблице:")[0];
  if (
    /(?:без|не\s+(?:делай|проводи|нужен|нужно|загружай|читай)).{0,35}(?:глубок|подроб|полн|описани|критери)|(?:no|without|don't|do not).{0,35}(?:deep|full|detailed|description|criteria)/iu.test(
      text,
    )
  )
    return false;
  return (
    wantsTicketDetails(text) ||
    asksTicketOpinion(text) ||
    /(?:глубок(?:ий|ого|ому)|подробн(?:ый|ого|ому)|детальн(?:ый|ого|ому))\s+(?:анализ|разбор)|(?:проанализируй|изучи|разбери).{0,25}(?:глубоко|подробно|детально)|(?:прочитай|загрузи|изучи|проанализируй|проверь|найди|поищи).{0,60}(?:описани|критери[ия]|полное содержимое)|(?:deep|in-depth|detailed)\s+(?:analysis|review)|(?:read|load|search|analy[sz]e|inspect).{0,60}(?:descriptions?|acceptance criteria|full content)/iu.test(
      text,
    )
  );
}

export const DEEP_READ_WARNING =
  "Для этого нужно прочитать полное содержимое тикетов: описание, критерии приёмки и комментарии. Глубокий анализ может потратить много токенов — расход зависит от количества и размера тикетов. До вашего подтверждения я использую только краткие данные. Продолжить глубокое чтение?";

export function deepReadConsent(prompt: string, history: unknown[]) {
  const reply = prompt
    .split("\n\nВыбранные пользователем тикеты в таблице:")[0]
    .trim();
  const rows = history as { role?: string; body?: string }[];
  const warning = rows.at(-1),
    request = rows.at(-2);
  // Token-cost consent is conversational, not a required passphrase.
  const yes = isActionConfirmation(reply) ||
    /^(?:(?:да|ага|угу|ок|окей)[,\s]+)?(?:похуй|пофиг|всё равно|все равно|неважно|не важно|токены не проблема|расход не проблема)(?:[,\s]+(?:давай|читай|продолжай|погнали))?[.!\s]*$/iu.test(reply);
  const warned = warning?.body === DEEP_READ_WARNING ||
    (warning?.role === "assistant" &&
      /токен|tokens?/iu.test(warning.body || "") &&
      /расход|потрат|затрат|много|cost|usage|consume/iu.test(warning.body || "") &&
      /продолж|прочита|чтени|загруз|описани|анализ|read|load|analy/iu.test(warning.body || ""));
  if (
    yes &&
    warning?.role === "assistant" &&
    warned &&
    request?.role === "user" &&
    request.body &&
    (allowsFullTicketRead(request.body) || /(?:найди|поищи|поиск|find|search).{0,80}(?:тикет|задач|ticket|work item)/iu.test(request.body))
  )
    return { confirmed: true, needsConfirmation: false, request: request.body };
  return {
    confirmed: false,
    needsConfirmation: allowsFullTicketRead(prompt),
    request: prompt,
  };
}

/** Only a clearly identified single ticket may bypass the bulk token warning. */
export function singleTicketTarget(
  prompt: string,
  history: unknown[] = [],
): number | undefined {
  const [text, selected = ""] = prompt.split(
    "\n\nВыбранные пользователем тикеты в таблице:",
  );
  if (
    /(?:все|всем|всех|каждый|каждого|список|несколько)(?=$|[\s,.!?:])|\b(?:all|every|list|several)\b/iu.test(
      text,
    )
  )
    return;
  const ids = new Set<number>();
  for (const match of text.matchAll(
    /#(\d+)|(?:тикет(?:а|у|ом)?|задач[аиу]|ticket|work item)\s*№?\s*(\d+)/giu,
  ))
    ids.add(Number(match[1] || match[2]));
  if (/^\s*\d+\s*$/.test(text)) ids.add(Number(text.trim()));
  // Include additional plain IDs in an explicitly numbered request, e.g. #42 и 43.
  if (ids.size)
    for (const match of text.matchAll(/(?<![\p{L}\d])\d+(?![\p{L}\d])/gu))
      ids.add(Number(match[0]));
  for (const match of selected.matchAll(/#(\d+)/g)) ids.add(Number(match[1]));
  if (
    !ids.size &&
    /(?:этом|этого|этот|этой)\s+(?:тикет|задач)|\bthis (?:ticket|work item)\b/iu.test(
      text,
    )
  ) {
    const previous = [...(history as { role?: string; body?: string }[])]
      .reverse()
      .find((row) => row.role === "user");
    if (previous?.body) return singleTicketTarget(previous.body);
  }
  const id = [...ids][0];
  return ids.size === 1 && Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export function asksTicketOpinion(prompt: string) {
  const text = prompt.split("\n\nВыбранные пользователем тикеты в таблице:")[0];
  return (
    /что\s+(?:ты\s+)?думаешь.{0,45}(?:тикет|задач|#)|what do you think.{0,40}(?:ticket|work item)/iu.test(
      text,
    ) &&
    !/не\s+(?:анализируй|читай|загружай)|без\s+(?:описания|анализа)/iu.test(
      text,
    )
  );
}

/** Cached snippets do not load full bodies into model context. */
export function asksCachedContentSearch(prompt: string) {
  return /(?:найди|найти|поищи|поиск|search|find)/iu.test(prompt) &&
    /(?:описани|критери|содержим|description|criteria|content)/iu.test(prompt) &&
    !/(?:глубок.{0,8}анализ|полное содержимое|deep analysis|full content)/iu.test(prompt);
}
