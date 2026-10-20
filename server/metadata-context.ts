// Follow consecutive clarification turns back to the user's request.
// Assistant text only identifies a question; it never supplies mutation values.
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
  const previous = metadataContextRequest(request.body, rows.slice(0, -2));
  const original = previous.contextual ? previous.prompt : request.body;
  if (!/тег|тэг|tag|замет|note|приоритет|priority/iu.test(original))
    return { prompt, contextual: false };
  return {
    prompt: `${original}\n\nУточнение пользователя к этой просьбе:\n${prompt}`,
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
    !/(?:выполнить(?:\s+(?:эти|это))?\s+изменени[ея]|выполнить(?:\s+(?:действие|операцию|переход))?|применить(?:\s+изменения)?|продолжить|подтверждаете)[?？]/iu.test(plan.body || "")
  )
    return { prompt, contextual: false };
  const prior = confirmedChatRequest(request.body, rows.slice(0, -2));
  const original = prior.contextual ? prior : metadataContextRequest(request.body, rows.slice(0, -2));
  // Explicitly displayed IDs belong to the plan the user just confirmed.
  // Do not copy assistant prose into the command or infer IDs from counts.
  const ids = [...new Set([...String(plan.body).matchAll(/#(\d+)\b/g)].map(m => m[1]))];
  return {
    prompt: `${original.prompt}\n\nПользователь подтвердил предыдущий план: ${reply}${ids.length ? `\nТикеты подтверждённого плана: ${ids.map(id => `#${id}`).join(", ")}` : ""}`,
    contextual: true,
  };
}
