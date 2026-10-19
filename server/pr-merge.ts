import { randomUUID } from "node:crypto";
import { Store, AppError } from "./store.js";
import { azureBase, requestJson } from "./http.js";
import { prTicketIds, type Monitor } from "./pull-requests.js";
import type { Connectors } from "./connectors.js";

type Key = { monitor: string; repo: string; number: number };
type Plan = Key & {
  id: string;
  source: string;
  head: string;
  target: string;
  title: string;
  created: number;
  moveTickets: boolean;
  tickets: { id: number; state: string; states: string[] }[];
};
// UI-only write workflow. No merge capability is exposed to the agent.
export class PrMerge {
  constructor(
    private store: Store,
    private connectors: Connectors,
  ) {
    store.db
      .exec(`CREATE TABLE IF NOT EXISTS pr_merge_plans(id TEXT PRIMARY KEY, body TEXT NOT NULL, result TEXT);
      CREATE TABLE IF NOT EXISTS pr_merge_attempts(identity TEXT PRIMARY KEY, plan TEXT NOT NULL);`);
  }
  private monitor(key: Key) {
    const m = this.store.db
      .prepare(
        "SELECT m.* FROM pr_projects m JOIN pull_requests p ON p.monitor=m.id WHERE m.id=? AND p.repo=? AND p.number=? AND m.enabled=1 AND p.in_scope=1",
      )
      .get(key.monitor, key.repo, key.number) as Monitor | undefined;
    const s = this.store.settings();
    if (
      !m ||
      m.source !== azureBase(s.azureUrl) ||
      m.azure_project !== s.azureProject
    )
      throw new AppError(
        409,
        "PR или подключение изменились. Обновите список.",
      );
    return m;
  }
  private path(key: Key) {
    return `git/repositories/${encodeURIComponent(key.repo)}/pullrequests/${key.number}`;
  }
  private async request(m: Monitor, path: string, init: RequestInit = {}) {
    const pat = this.store.secret("azure.pat");
    if (!pat) throw new AppError(400, "Настройте Azure PAT");
    return requestJson(
      `${m.source}/${encodeURIComponent(m.azure_project)}/_apis/${path}?api-version=${encodeURIComponent(this.store.settings().azureVersion)}`,
      {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Basic ${Buffer.from(":" + pat).toString("base64")}`,
          "Content-Type": "application/json",
        },
      },
      "Azure DevOps: merge PR",
    );
  }
  private async snapshot(key: Key, moveTickets = true) {
    const m = this.monitor(key);
    const pr = await this.request(m, this.path(key));
    if (
      pr.pullRequestId !== key.number ||
      pr.repository?.id !== key.repo ||
      pr.status !== "active" ||
      pr.isDraft ||
      !pr.lastMergeSourceCommit?.commitId ||
      !pr.lastMergeTargetCommit?.commitId
    )
      throw new AppError(
        409,
        "Нужен активный PR без черновика. Обновите список.",
      );
    if (!moveTickets) return { m, pr, ids: [] as number[] };
    const links = await this.request(m, `${this.path(key)}/workitems`);
    if (!Array.isArray(links.value))
      throw new AppError(502, "Не удалось загрузить связи PR");
    const ids = [
      ...new Set([
        ...prTicketIds(pr.description || ""),
        ...links.value.map((v: any) => Number(v.id)),
      ]),
    ].sort((a, b) => a - b);
    if (
      ids.length > 100 ||
      ids.some((id) => !Number.isSafeInteger(id) || id < 1)
    )
      throw new AppError(
        400,
        "Некорректный или слишком большой список связанных тикетов (максимум 100)",
      );
    return { m, pr, ids };
  }
  async prepare(key: Key, moveTickets = true) {
    const source = this.store.source();
    const { pr, ids } = await this.snapshot(key, moveTickets);
    const tickets: Plan["tickets"] = [];
    for (const id of ids) {
      const states = await this.connectors.ticketStates(id);
      if (states.source !== source)
        throw new AppError(409, "Подключение изменилось");
      tickets.push({ id, state: states.state, states: states.states });
    }
    if (this.store.source() !== source)
      throw new AppError(409, "Подключение изменилось");
    const plan: Plan = {
      ...key,
      id: randomUUID(),
      source,
      head: pr.lastMergeSourceCommit.commitId,
      target: pr.lastMergeTargetCommit.commitId,
      title: pr.title,
      created: Date.now(),
      moveTickets,
      tickets,
    };
    this.store.db
      .prepare("INSERT INTO pr_merge_plans(id,body) VALUES (?,?)")
      .run(plan.id, JSON.stringify(plan));
    return plan;
  }
  result(id: string) {
    const row = this.store.db
      .prepare("SELECT result FROM pr_merge_plans WHERE id=?")
      .get(id) as any;
    if (!row) throw new AppError(404, "Операция не найдена");
    return row.result ? JSON.parse(row.result) : { status: "prepared" };
  }
  async execute(
    id: string,
    selections: { id: number; state: string }[],
    strategy: string,
  ) {
    const row = this.store.db
      .prepare("SELECT * FROM pr_merge_plans WHERE id=?")
      .get(id) as any;
    if (!row) throw new AppError(404, "Подтверждение не найдено");
    if (row.result) return JSON.parse(row.result);
    const plan: Plan = JSON.parse(row.body);
    if (Date.now() - plan.created > 15 * 60_000)
      throw new AppError(409, "Диалог устарел. Откройте его заново.");
    const guard = () => {
      if (this.store.source() !== plan.source)
        throw new AppError(409, "Подключение изменилось");
      this.monitor(plan);
    };
    guard();
    // Mode is frozen in the prepared plan; confirmation cannot enable ticket writes.
    const { m, pr, ids } = await this.snapshot(
      plan,
      plan.moveTickets !== false,
    );
    if (
      pr.lastMergeSourceCommit.commitId !== plan.head ||
      pr.lastMergeTargetCommit.commitId !== plan.target ||
      JSON.stringify(ids) !== JSON.stringify(plan.tickets.map((t) => t.id))
    )
      throw new AppError(
        409,
        "Коммиты или связанные тикеты изменились. Откройте диалог заново.",
      );
    if (
      selections.length !== ids.length ||
      new Set(selections.map((s) => s.id)).size !== ids.length ||
      selections.some((s) => !ids.includes(s.id))
    )
      throw new AppError(400, "Выберите статус для каждого связанного тикета");
    for (const s of selections) {
      const current = await this.connectors.ticketStates(s.id);
      if (!current.states.includes(s.state))
        throw new AppError(400, `Недоступный статус для #${s.id}`);
    }
    guard();
    const identity = JSON.stringify([
      plan.monitor,
      plan.repo,
      plan.number,
      plan.head,
    ]);
    const claimed = this.store.db
      .prepare(
        "INSERT OR IGNORE INTO pr_merge_attempts(identity,plan) VALUES (?,?)",
      )
      .run(identity, id);
    if (!claimed.changes)
      throw new AppError(
        409,
        "Merge этой версии уже запрашивался. Проверьте результат в Azure; повторная отправка заблокирована.",
      );
    const save = (result: any) => {
      this.store.db
        .prepare("UPDATE pr_merge_plans SET result=? WHERE id=?")
        .run(JSON.stringify(result), id);
      return result;
    };
    save({
      status: "running",
      message:
        "Операция начата. При перезапуске сервера проверьте результат в Azure; автоматического повтора нет.",
    });
    let writeError = "";
    try {
      await this.request(m, this.path(plan), {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          lastMergeSourceCommit: { commitId: plan.head },
          completionOptions: {
            mergeStrategy: strategy,
            deleteSourceBranch: false,
            transitionWorkItems: false,
            bypassPolicy: false,
          },
        }),
      });
    } catch (e) {
      writeError =
        e instanceof AppError
          ? e.message
          : "Не получено подтверждение запроса merge";
    }
    let confirmed = false;
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        guard();
        const current = await this.request(m, this.path(plan));
        if (
          current.status === "completed" &&
          current.lastMergeSourceCommit?.commitId === plan.head
        ) {
          confirmed = true;
          break;
        }
        if (
          writeError ||
          current.status === "abandoned" ||
          current.mergeStatus === "conflicts" ||
          current.mergeStatus === "rejectedByPolicy" ||
          current.mergeStatus === "failure"
        )
          break;
        if (attempt < 4)
          await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch {
      /* Ambiguous merge: never transition tickets without confirmation. */
    }
    if (!confirmed)
      return save({
        status: "unconfirmed",
        message: `Merge не подтверждён. Статусы тикетов не менялись. Проверьте PR в Azure; повторного запроса не будет.${writeError ? " " + writeError : ""}`,
        tickets: [],
      });
    const results = [];
    for (const s of selections) {
      try {
        guard();
        const result = await this.connectors.changeTicketStatus(
          s.id,
          s.state,
          guard,
        );
        results.push({ id: s.id, state: s.state, success: result.success });
      } catch (e) {
        results.push({
          id: s.id,
          state: s.state,
          success: false,
          error:
            e instanceof AppError ? e.message : "Не удалось подтвердить статус",
        });
      }
      save({ status: "running", merged: true, tickets: results });
    }
    this.store.db
      .prepare(
        "UPDATE pull_requests SET in_scope=0 WHERE monitor=? AND repo=? AND number=?",
      )
      .run(plan.monitor, plan.repo, plan.number);
    this.store.audit(
      "pr.merged",
      `PR #${plan.number}; ${results.filter((r) => r.success).length}/${results.length} статусов подтверждено`,
    );
    return save({
      status: results.every((r) => r.success) ? "completed" : "partial",
      merged: true,
      tickets: results,
    });
  }
}
