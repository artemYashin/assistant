import { AppError } from "./store.js";
import { resolveState } from "./ticket-status.js";

export type StatusChange = { id: number; state: string };
export type PreparedStatusChange = StatusChange & { revision: number };
export type StatusBatchAccess = {
  read: (ids: number[]) => Promise<any[]>;
  states: (type: string) => Promise<string[]>;
  patch: (changes: PreparedStatusChange[]) => Promise<unknown>;
  beforeWrite: () => void;
};

// All writes use a single envelope; verification is a separate bulk read.
// Never fall back to individual PATCHes after an ambiguous batch response.
export async function changeTicketStates(
  changes: StatusChange[],
  project: string,
  access: StatusBatchAccess,
) {
  if (
    !changes.length ||
    changes.length > 25 ||
    new Set(changes.map((x) => x.id)).size !== changes.length ||
    changes.some(
      (x) => !Number.isSafeInteger(x.id) || x.id <= 0 || !x.state.trim(),
    )
  )
    throw new AppError(
      400,
      "Нужны от 1 до 25 уникальных тикетов и целевой статус",
    );
  const initial = new Map(
    (await access.read(changes.map((x) => x.id))).map((x) => [x.id, x]),
  );
  const states = new Map<string, Promise<string[]>>();
  const results = new Map<number, any>();
  const pending: PreparedStatusChange[] = [];
  for (const change of changes) {
    try {
      const item = initial.get(change.id);
      if (!item || item.fields?.["System.TeamProject"] !== project)
        throw new AppError(
          400,
          "Тикет недоступен или относится к другому проекту",
        );
      const type = item.fields["System.WorkItemType"];
      if (!states.has(type)) states.set(type, access.states(type));
      const target = resolveState(change.state, await states.get(type)!);
      if (item.fields["System.State"] === target) {
        results.set(change.id, {
          success: true,
          id: change.id,
          state: target,
          outcome: "already",
          item,
        });
      } else {
        if (!Number.isSafeInteger(item.rev))
          throw new AppError(502, "Azure не вернул ревизию тикета");
        pending.push({ id: change.id, state: target, revision: item.rev });
      }
    } catch (error) {
      results.set(change.id, {
        success: false,
        id: change.id,
        error:
          error instanceof AppError
            ? error.message
            : "Не удалось подготовить смену статуса",
      });
    }
  }
  if (pending.length) {
    access.beforeWrite();
    let failed = false;
    let responses: any;
    let patchMessage = "";
    try {
      responses = await access.patch(pending);
    } catch (error) {
      failed = true;
      patchMessage =
        error instanceof AppError
          ? error.message
          : "Ошибка пакетной записи Azure";
    }
    let verified = new Map<number, any>();
    try {
      verified = new Map(
        (await access.read(pending.map((x) => x.id))).map((x) => [x.id, x]),
      );
    } catch {
      /* Preserve per-ticket unknown outcomes without retrying writes. */
    }
    const replies = Array.isArray(responses) ? responses : responses?.value;
    for (const [index, change] of pending.entries()) {
      const item = verified.get(change.id);
      const response = replies?.[index];
      const code = Number(response?.code ?? response?.statusCode);
      const rejection =
        code === 401 || code === 403
          ? `Azure HTTP ${code}: проверьте PAT и права Work Items Read & Write.`
          : code === 409 || code === 412
            ? `Azure HTTP ${code}: конфликт версии тикета.`
            : Number.isFinite(code)
              ? `Azure HTTP ${code}: проверьте правила перехода и обязательные поля тикета.`
              : "Azure не вернул подтверждение операции.";
      const responseFailed =
        failed ||
        !response ||
        !Number.isFinite(Number(response.code ?? response.statusCode)) ||
        Number(response.code ?? response.statusCode) < 200 ||
        Number(response.code ?? response.statusCode) >= 300;
      if (
        item?.fields?.["System.TeamProject"] === project &&
        item.fields["System.State"] === change.state
      )
        results.set(change.id, {
          success: true,
          id: change.id,
          state: change.state,
          outcome: responseFailed ? "confirmed_after_error" : "changed",
          item,
        });
      else
        results.set(change.id, {
          success: false,
          id: change.id,
          error: `Статус #${change.id} не подтверждён: ожидался «${change.state}», ${item ? `получен «${item.fields?.["System.State"]}»` : "повторное чтение не удалось"}. ${patchMessage || (responseFailed ? rejection : "")} Запись не повторялась; проверьте результат перед повтором.`,
        });
    }
  }
  return changes.map((x) => ({
    ...results.get(x.id),
    verifiedAt: new Date().toISOString(),
  }));
}
