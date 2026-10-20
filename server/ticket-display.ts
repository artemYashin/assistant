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
  const yes =
    /^(?:да(?:[,\s]+(?:давай|делай|продолжай|согласен|согласна))*|давай(?:\s+(?:делай|продолжай))?|продолжай|подтверждаю|согласен|согласна|yes|proceed|go ahead|confirm)[.!\s]*$/iu.test(
      reply,
    );
  if (
    yes &&
    warning?.role === "assistant" &&
    warning.body === DEEP_READ_WARNING &&
    request?.role === "user" &&
    request.body &&
    allowsFullTicketRead(request.body)
  )
    return { confirmed: true, needsConfirmation: false, request: request.body };
  return {
    confirmed: false,
    needsConfirmation: allowsFullTicketRead(prompt),
    request: prompt,
  };
}
