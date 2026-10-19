import { AppError } from "./store.js";
const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
export function resolveState(requested: string, states: string[]) {
  const value = normalize(requested);
  const exact = states.filter((s) => normalize(s) === value);
  if (exact.length === 1) return exact[0];
  const aliases =
    value === "rft"
      ? ["ready for testing"]
      : value === "ready for testing"
        ? ["rft"]
        : [];
  const matches = states.filter((s) => aliases.includes(normalize(s)));
  if (matches.length === 1) return matches[0];
  throw new AppError(
    400,
    `Статус «${requested}» не найден однозначно. Доступные статусы: ${states.join(", ")}`,
  );
}
export function mayChangeState(prompt: string, id: number, state: string) {
  const p = normalize(prompt);
  if (
    /(?:не\s+(?:перевод|переведи|меня|измен|устанав|установ|выстав)|do not|don't|не надо|не нужно)/i.test(
      p,
    )
  )
    return false;
  const intent =
    /(?:переведи(?:те)?|поменяй(?:те)?|измени(?:те)?|установи(?:те)?|выстави(?:те)?|(?:можешь|можете|прошу)\s+перевести|\b(?:move|set|change|transition|update)\s+(?:the\s+)?(?:ticket|bug|work item|status|#?\d))/i.test(
      p,
    );
  const number = new RegExp(`(?<![0-9])${id}(?![0-9])`).test(p);
  const s = normalize(state);
  if (!s) return false;
  const names = [
    s,
    ...(s === "rft"
      ? ["ready for testing"]
      : s === "ready for testing"
        ? ["rft"]
        : []),
  ];
  const mentioned = names.some((n) => {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
      "u",
    ).test(p);
  });
  return intent && number && mentioned;
}
export type StateAccess = {
  read: () => Promise<any>;
  states: (type: string) => Promise<string[]>;
  patch: (revision: number, state: string) => Promise<unknown>;
  beforeWrite?: () => void;
};
export async function changeTicketState(
  id: number,
  requested: string,
  project: string,
  access: StateAccess,
) {
  const validate = (item: any) => {
    if (item.id !== id || item.fields?.["System.TeamProject"] !== project)
      throw new AppError(
        400,
        "Номер или проект тикета не соответствует запросу",
      );
  };
  const before = await access.read();
  validate(before);
  const type = before.fields["System.WorkItemType"];
  const target = resolveState(requested, await access.states(type));
  if (before.fields["System.State"] === target)
    return {
      success: true as const,
      outcome: "already" as const,
      id,
      state: target,
      previousState: target,
      verifiedAt: new Date().toISOString(),
      item: before,
    };
  if (!Number.isSafeInteger(before.rev))
    throw new AppError(
      502,
      "Azure не вернул ревизию тикета; изменение отменено",
    );
  access.beforeWrite?.();
  let patchError: unknown;
  try {
    await access.patch(before.rev, target);
  } catch (e) {
    patchError = e;
  }
  let after: any;
  try {
    after = await access.read();
    validate(after);
  } catch {
    throw new AppError(
      502,
      `Результат смены статуса #${id} не подтверждён: повторное чтение не удалось. Изменение могло выполниться. Не повторяйте запись автоматически.`,
    );
  }
  const actual = after.fields["System.State"];
  if (actual !== target)
    throw new AppError(
      409,
      `Статус #${id} не подтверждён: ожидался «${target}», получен «${actual}». ${patchError instanceof AppError ? patchError.message : "Возможен конфликт ревизии или правило перехода Azure."} Повторная запись не выполнялась.`,
    );
  return {
    success: true as const,
    outcome: patchError
      ? ("confirmed_after_error" as const)
      : ("changed" as const),
    id,
    state: target,
    previousState: before.fields["System.State"],
    verifiedAt: new Date().toISOString(),
    item: after,
  };
}
