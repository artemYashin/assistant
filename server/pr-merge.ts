import { prLinksKey } from "./pr-ticket-sources.js";
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
  tickets: { id: number; title?: string; state: string; states: string[] }[];
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
  private identity(plan: Key & { head: string }) {
    return JSON.stringify([plan.monitor, plan.repo, plan.number, plan.head]);
  }
  private recoverDeniedAttempt(key: Key, pr: any) {
    // Called only after a fresh GET confirmed this PR is still active.
    if (pr.autoCompleteSetBy) return;
    const identity = this.identity({
      ...key,
      head: pr.lastMergeSourceCommit.commitId,
    });
    this.store.db.transaction(() => {
      const previous = this.store.db
        .prepare(
          "SELECT a.plan,p.result FROM pr_merge_attempts a JOIN pr_merge_plans p ON p.id=a.plan WHERE a.identity=?",
        )
        .get(identity) as any;
      if (!previous?.result) return;
      const result = JSON.parse(previous.result);
      const denied = result.status === "rejected" && result.retryable === true;
      // Compatibility with already persisted permission failures from older versions.
      const legacyDenied =
        result.status === "unconfirmed" &&
        !result.merged &&
        !result.tickets?.length &&
        /HTTP (401|403)\./.test(result.message || "");
      if (!denied && !legacyDenied) return;
      this.store.db
        .prepare("UPDATE pr_merge_plans SET result=? WHERE id=?")
        .run(
          JSON.stringify({
            ...result,
            status: "rejected",
            retryable: true,
            message:
              "Azure отклонил предыдущий запрос по правам. PR всё ещё активен. После исправления PAT можно открыть новый диалог и подтвердить merge.",
          }),
          previous.plan,
        );
      this.store.db
        .prepare("DELETE FROM pr_merge_attempts WHERE identity=? AND plan=?")
        .run(identity, previous.plan);
    })();
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
        ...prTicketIds((pr.title || "") + "\n" + (pr.description || "")),
        ...(
          this.store.db
            .prepare(
              "SELECT ticket_id FROM pr_ticket_links WHERE monitor=? AND repo=? AND number=?",
            )
            .all(key.monitor, key.repo, key.number) as { ticket_id: number }[]
        ).map((r) => r.ticket_id),
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
    this.store.set(prLinksKey(key.monitor, key.repo, key.number), {
      ids: links.value.map((v: any) => Number(v.id)),
      error: "",
    });
    return { m, pr, ids };
  }
  async linkedTickets(key: Key) {
    const source = this.store.source();
    const { ids } = await this.snapshot(key, true);
    if (source !== this.store.source())
      throw new AppError(409, "Подключение изменилось");
    return { ids };
  }
  async prepare(key: Key, moveTickets = true) {
    const source = this.store.source();
    const { pr, ids } = await this.snapshot(key, moveTickets);
    this.recoverDeniedAttempt(key, pr);
    const tickets: Plan["tickets"] = [];
    for (const id of ids) {
      const states = await this.connectors.ticketStates(id);
      if (states.source !== source)
        throw new AppError(409, "Подключение изменилось");
      tickets.push({
        id,
        title: states.title,
        state: states.state,
        states: states.states,
      });
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
    const result = row.result ? JSON.parse(row.result) : { status: "prepared" };
    if (result.status === "blocked" && result.operationId) {
      const previous = this.store.db
        .prepare("SELECT result FROM pr_merge_plans WHERE id=?")
        .get(result.operationId) as any;
      return previous?.result
        ? { ...JSON.parse(previous.result), operationId: result.operationId }
        : result;
    }
    return result;
  }
  async execute(
    id: string,
    selections: { id: number; state: string | null }[],
    strategy: string,
    bypass: { enabled: boolean; reason: string } = {
      enabled: false,
      reason: "",
    },
  ) {
    const bypassReason = bypass.reason.trim();
    if (bypass.enabled && (!bypassReason || bypassReason.length > 2000))
      throw new AppError(
        400,
        "Укажите причину обхода политик (до 2000 символов)",
      );
    const row = this.store.db
      .prepare("SELECT * FROM pr_merge_plans WHERE id=?")
      .get(id) as any;
    if (!row) throw new AppError(404, "Подтверждение не найдено");
    if (row.result) return this.result(id);
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
      if (s.state === null) continue;
      const current = await this.connectors.ticketStates(s.id);
      if (!current.states.includes(s.state))
        throw new AppError(400, `Недоступный статус для #${s.id}`);
    }
    guard();
    const identity = this.identity(plan);
    const claimed = this.store.db
      .prepare(
        "INSERT OR IGNORE INTO pr_merge_attempts(identity,plan) VALUES (?,?)",
      )
      .run(identity, id);
    if (!claimed.changes) {
      const previous = this.store.db
        .prepare("SELECT plan FROM pr_merge_attempts WHERE identity=?")
        .get(identity) as any;
      this.store.db
        .prepare("UPDATE pr_merge_plans SET result=? WHERE id=?")
        .run(
          JSON.stringify({
            status: "blocked",
            operationId: previous.plan,
            message:
              "Эта версия уже отправлена на merge. Показан результат исходной операции.",
          }),
          id,
        );
      return this.result(id);
    }
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
    this.store.audit(
      "pr.merge.requested",
      JSON.stringify({
        id,
        bypassPolicy: bypass.enabled,
        bypassReason: bypass.enabled ? bypassReason : undefined,
      }),
      plan,
    );
    let writeError = "";
    let denied = false;
    try {
      await this.request(m, this.path(plan), {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          lastMergeSourceCommit: { commitId: plan.head },
          completionOptions: {
            mergeCommitMessage: `Merged PR ${plan.number}: ${String(pr.title || plan.title || "Pull request").replace(/\s+/g, " ").trim()}`,
            mergeStrategy: strategy,
            deleteSourceBranch: false,
            transitionWorkItems: false,
            bypassPolicy: bypass.enabled,
            ...(bypass.enabled ? { bypassReason } : {}),
          },
        }),
      });
    } catch (e) {
      denied = [401, 403].includes((e as any)?.upstreamStatus);
      writeError =
        e instanceof AppError
          ? e.message
          : "Не получено подтверждение запроса merge";
    }
    let confirmed = false;
    let stillActive = false;
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        guard();
        const current = await this.request(m, this.path(plan));
        stillActive =
          current.status === "active" &&
          current.lastMergeSourceCommit?.commitId === plan.head &&
          !current.autoCompleteSetBy;
        if (
          current.status === "completed" &&
          current.lastMergeSourceCommit?.commitId === plan.head
        ) {
          confirmed = true;
          const closed = Number.isFinite(Date.parse(current.closedDate))
            ? Date.parse(current.closedDate)
            : Date.now();
          this.store.db
            .prepare(
              "INSERT OR IGNORE INTO pr_completed(monitor,repo,number,closed_at,expires_at,hydrated) VALUES (?,?,?,?,?,0)",
            )
            .run(
              plan.monitor,
              plan.repo,
              plan.number,
              new Date(closed).toISOString(),
              closed + 30 * 86400000,
            );
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
    if (!confirmed && denied && stillActive) {
      return save({
        status: "rejected",
        retryable: true,
        message: `Azure отклонил merge по правам. Статусы тикетов не менялись. Исправьте PAT, затем откройте новый диалог и подтвердите операцию. ${writeError}`,
        tickets: [],
      });
    }
    if (!confirmed)
      return save({
        status: "unconfirmed",
        message: `Merge не подтверждён. Статусы тикетов не менялись. Проверьте PR в Azure; повторного запроса не будет.${writeError ? " " + writeError : ""}`,
        tickets: [],
      });
    const results = [];
    for (const s of selections) {
      if (s.state === null) {
        results.push({ id: s.id, state: null, skipped: true, success: true });
        continue;
      }
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
      plan,
    );
    return save({
      status: results.every((r) => r.success) ? "completed" : "partial",
      merged: true,
      tickets: results,
    });
  }
}
