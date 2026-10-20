// Only a user's own immediately preceding request can supply the missing
// operation/value. Assistant text is used solely to detect a clarification,
// never as authorization to mutate fields.
export function metadataContextRequest(
  prompt: string,
  history: unknown[],
): { prompt: string; contextual: boolean } {
  const latest = prompt.trim();
  if (
    /^(?:нет[.!]?|отмена|отмени|не надо|не нужно|no[.!]?|cancel)$/iu.test(
      latest,
    )
  )
    return { prompt, contextual: false };
  const continuation =
    /^(?:да\b|ага\b|ок(?:ей)?\b|подтверждаю\b|делай\b|ко?\s+всем\b|всем\b|для\s+всех\b|только\b|кроме\b|исключая\b|yes\b|confirm\b|all\b|only\b|except\b)/iu;
  // JS \b is ASCII-only; use explicit Cyrillic boundaries for Russian replies.
  const russian =
    /^(?:да|ага|ок|окей|подтверждаю|делай|ко всем|к всем|всем|для всех|только|кроме|исключая)(?=$|[\s,.!:])/iu;
  if (!continuation.test(latest) && !russian.test(latest))
    return { prompt, contextual: false };
  const rows = history as { role?: string; body?: string }[];
  const question = rows.at(-1);
  const request = rows.at(-2);
  if (
    question?.role !== "assistant" ||
    request?.role !== "user" ||
    !question.body ||
    !request.body
  )
    return { prompt, contextual: false };
  if (!/[?？]|уточни|подтверд|clarify|confirm/iu.test(question.body))
    return { prompt, contextual: false };
  if (!/тег|тэг|tag|замет|note|приоритет|priority/iu.test(request.body))
    return { prompt, contextual: false };
  return {
    prompt: `${request.body}\n\nУточнение пользователя к этой просьбе:\n${prompt}`,
    contextual: true,
  };
}

// Text approval lives only in ordinary conversation history. Never interpret a
// bare yes after an unrelated assistant reply as a new mutation request.
export function confirmedChatRequest(
  prompt: string,
  history: unknown[],
): { prompt: string; contextual: boolean } {
  const reply = prompt.split(/\n\nВыбранные пользователем тикеты/u)[0].trim();
  if (
    !/^(?:да(?:[,\s]+(?:давай|делай|выполняй|сделай))*|подтверждаю|давай(?:\s+делай)?|делай|yes|confirm|go ahead)[.!\s]*$/iu.test(
      reply,
    )
  )
    return { prompt, contextual: false };
  const rows = history as { role?: string; body?: string }[];
  const plan = rows.at(-1);
  const request = rows.at(-2);
  if (
    plan?.role !== "assistant" ||
    request?.role !== "user" ||
    !request.body ||
    !/Выполнить эти изменения\?/iu.test(plan.body || "")
  )
    return { prompt, contextual: false };
  const original = metadataContextRequest(request.body, rows.slice(0, -2));
  return {
    prompt: `${original.prompt}\n\nПользователь подтвердил предыдущий план: ${reply}`,
    contextual: true,
  };
}
