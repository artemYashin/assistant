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
