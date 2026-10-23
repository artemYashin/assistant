import { CodeBrowser } from "./code-browser.js";
import { AppError, type Store } from "./store.js";
import type { Monitor } from "./pull-requests.js";

type Source = { monitor: string; repo: string; number: number; head: string; source_branch: string };
type State = { head: string; branch: string; status: "loading" | "ready" | "error"; error?: string; stage?: string; updatedAt: string };
export class PrSourcePreparation {
  private pending = new Map<string, Promise<void>>();
  constructor(private store: Store, private browser: Pick<CodeBrowser, "request"> = new CodeBrowser(store)) {}
  private key(pr: Source) { return `pr.source:${JSON.stringify([pr.monitor, pr.repo, pr.number])}`; }
  status(pr: Source) {
    const state = this.store.get<State | null>(this.key(pr), null);
    const snapshot = this.store.get<{ sha: string; checkedAt: string } | null>(`code.snapshot:${pr.monitor}:${pr.source_branch.replace(/^refs\/heads\//, "")}`, null);
    if (state?.status !== "loading" && snapshot) return snapshot.sha === pr.head ? { status: "ready", updatedAt: snapshot.checkedAt } : { status: "stale", error: state?.error };
    if (!state) return { status: "unknown" };
    if (state.head !== pr.head || state.branch !== pr.source_branch) return { status: "stale" };
    if (state.status === "loading" && !this.pending.has(this.key(pr))) return { status: "error", error: "Загрузка была прервана. Повторите подготовку ветки." };
    return state;
  }
  prepare(monitor: Monitor, pr: Source): Promise<void> {
    const key = this.key(pr);
    const existing = this.pending.get(key);
    if (existing) return existing.then(() => {
      const state = this.store.get<State | null>(key, null);
      if (state?.head !== pr.head || state.branch !== pr.source_branch) return this.prepare(monitor, pr);
    });
    const branch = pr.source_branch.replace(/^refs\/heads\//, "");
    const write = (status: State["status"], extra: Partial<State> = {}) => this.store.set(key, { head: pr.head, branch: pr.source_branch, status, updatedAt: new Date().toISOString(), ...extra });
    write("loading");
    const task = (async () => {
      try {
        if (!branch || !pr.head) throw new AppError(400, "Неизвестна source-ветка PR. Обновите список pull request.");
        const scope = { client: monitor.client, project: monitor.project, monitor: monitor.id, branch };
        let local: any;
        try { local = await this.browser.request({ ...scope, operation: "status", localOnly: true, localReadWaitMs: 0 }); }
        catch { /* A missing or busy local snapshot is prepared through the shared Git queue. */ }
        if (local?.sha !== pr.head) {
          local = await this.browser.request({ ...scope, operation: "pull" }, progress => write("loading", { stage: progress.stage }));
        }
        if (local?.sha !== pr.head) throw new AppError(409, "Source-ветка уже отличается от коммита PR. Синхронизируйте pull request и повторите ревью.");
        const pinned = await this.browser.request({ ...scope, operation: "status", localOnly: true, revision: pr.head });
        if (pinned.sha !== pr.head) throw new AppError(409, "Не удалось закрепить проверяемый коммит PR.");
        write("ready");
      } catch (error) {
        write("error", { error: error instanceof AppError ? error.message : "Не удалось подготовить source-ветку. Повторите загрузку." });
        throw error;
      }
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
}
