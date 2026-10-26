// Follow consecutive clarification turns back to the user's request.
// Assistant text only identifies a question; it never supplies mutation values.
export function metadataContextRequest(
  prompt: string,
  history: unknown[],
): { prompt: string; contextual: boolean } {
  const latest = prompt.trim();
  if (/^(?:нет[.!]?|отмена|отмени|не надо|не нужно|no[.!]?|cancel)$/iu.test(latest))
    return { prompt, contextual: false };
  const continuation =
    /^(?:да\b|ага\b|ок(?:ей)?\b|подтверждаю\b|делай\b|ко?\s+всем\b|всем\b|для\s+всех\b|только\b|кроме\b|исключая\b|yes\b|confirm\b|all\b|only\b|except\b)/iu;
  // JS \b is ASCII-only; use explicit Cyrillic boundaries for Russian replies.
  const russian =
    /^(?:да|ага|ок|окей|подтверждаю|делай|ко всем|к всем|всем|для всех|только|кроме|исключая)(?=$|[\s,.!:])/iu;
  if (!continuation.test(latest) && !russian.test(latest)) return { prompt, contextual: false };
  const rows = history as { role?: string; body?: string }[];
  const question = rows.at(-1);
  const request = rows.at(-2);
  if (question?.role !== "assistant" || request?.role !== "user" || !question.body || !request.body)
    return { prompt, contextual: false };
  if (!/[?？]|уточни|подтверд|clarify|confirm/iu.test(question.body))
    return { prompt, contextual: false };
  const previous = metadataContextRequest(request.body, rows.slice(0, -2));
  const original = previous.contextual ? previous.prompt : request.body;
  if (!/тег|тэг|tag|замет|note|приоритет|priority|дедлайн|deadline/iu.test(original))
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
  if (!isActionConfirmation(reply)) return { prompt, contextual: false };
  const rows = history as { role?: string; body?: string }[];
  const plan = rows.at(-1);
  const request = rows.at(-2);
  if (
    plan?.role !== "assistant" ||
    request?.role !== "user" ||
    !request.body ||
    !isMutationQuestion(plan.body || "")
  )
    return { prompt, contextual: false };
  const original = continuedMutationRequest(request.body, rows.slice(0, -2));
  // Explicitly displayed IDs belong to the plan the user just confirmed.
  // Do not copy assistant prose into the command or infer IDs from counts.
  const ids = planTicketIds(String(plan.body));
  return {
    prompt: `${original.prompt}\n\nПользователь подтвердил предыдущий план: ${reply}${ids.length ? `\nТикеты подтверждённого плана: ${ids.map((id) => `#${id}`).join(", ")}` : ""}`,
    contextual: true,
  };
}

function isMutationQuestion(text: string) {
  const plain = text.replace(/[*_`]/g, "");
  return (
    /[?？]/u.test(plain) &&
    /выполн|примен|подтвержд|продолж|перевест|перевод|смен|помен|измен|установ|выстав|confirm|proceed|apply/iu.test(
      plain,
    )
  );
}
function planTicketIds(text: string) {
  const values = [...text.matchAll(/#(\d+)\b/g)].map((m) => m[1]);
  // Local navigation links also identify tickets when the displayed number has no #.
  for (const match of text.matchAll(/\]\((\/tickets\?[^\s)]+)\)/g)) {
    const id = new URL(match[1], "http://orbit.local").searchParams.get("id");
    if (id && /^\d+$/.test(id)) values.push(id);
  }
  return [...new Set(values)];
}
function continuedMutationRequest(
  prompt: string,
  history: unknown[],
): { prompt: string; contextual: boolean } {
  const confirmed = confirmedChatRequest(prompt, history);
  if (confirmed.contextual) return confirmed;
  const rows = history as { role?: string; body?: string }[];
  const question = rows.at(-1),
    previous = rows.at(-2);
  // A user's answer to a status/scope clarification continues their own request.
  // Never use assistant text to invent the requested target state.
  if (
    question?.role !== "assistant" ||
    previous?.role !== "user" ||
    !previous.body ||
    !/[?？]/u.test(question.body || "") ||
    !/статус|status|state|каким.*тикет|какие.*тикет|всем|which.*ticket/iu.test(
      question.body || "",
    ) ||
    /^(?:нет|отмена|не надо|не нужно|no|cancel)(?:$|[.!\s])/iu.test(prompt.trim()) ||
    prompt.length > 200 ||
    /[?？]/u.test(prompt)
  )
    return metadataContextRequest(prompt, history);
  const original = continuedMutationRequest(previous.body, rows.slice(0, -2));
  if (!/перев|смен|помен|измен|выстав|установ|move|change|set|transition/iu.test(original.prompt))
    return metadataContextRequest(prompt, history);
  return { prompt: `${original.prompt}\n\nУточнение пользователя: ${prompt}`, contextual: true };
}

// Accept combinations of short affirmative phrases, not arbitrary sentences
// containing "yes". Changed scope, negation and questions must stay separate.
export function isActionConfirmation(reply: string): boolean {
  const text = reply
    .trim()
    .toLocaleLowerCase()
    .replace(/[,.!;:—–-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!text || text.length > 160) return false;
  const affirmative =
    "(?:да|давай|давайте|погнали|поехали|ага|угу|ок|окей|окэй|хорошо|конечно|согласен|согласна|подтверждаю|делай|делайте|сделай|сделайте|выполняй|выполняйте|применяй|применяйте|действуй|действуйте|начинай|начинайте|продолжай|продолжайте|yes|yep|yeah|ok|okay|sure|confirm|confirmed|proceed|go ahead|do it|let['’]s go)";
  return new RegExp(`^(?:${affirmative})(?: (?:${affirmative}|пожалуйста|please))*$`, "u").test(
    text,
  );
}
