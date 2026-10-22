import { Store, AppError } from "./store.js";
import { azureBase, requestJson } from "./http.js";
import { policyChecks, ciMergeReason } from "./pr-health.js";
export type PrCiKey = { monitor: string; repo: string; number: number };
export class PrCi {
  constructor(private store: Store) {}
  private access(key: PrCiKey) {
    const m = this.store.db.prepare("SELECT m.* FROM pr_projects m JOIN pull_requests p ON p.monitor=m.id WHERE m.id=? AND p.repo=? AND p.number=?").get(key.monitor, key.repo, key.number) as any;
    if (!m) throw new AppError(404, "Pull request не найден");
    const s = this.store.settings(m), pat = this.store.secret("azure.pat");
    if (!pat || azureBase(s.azureUrl) !== m.source || s.azureProject !== m.azure_project) throw new AppError(409, "Проверьте подключение Azure и PAT");
    const base = `${m.source}/${encodeURIComponent(m.azure_project)}/_apis/`;
    const init = { headers: { Authorization: `Basic ${Buffer.from(":" + pat).toString("base64")}` } };
    const get = (path: string, policy = false) => requestJson(`${base}${path}${path.includes("?") ? "&" : "?"}api-version=${encodeURIComponent(s.azureVersion.split("-")[0] + (policy ? "-preview.1" : ""))}`, init, (path.startsWith("build/") ? "CI Azure: требуется PAT Build: Read и доступ к пайплайну" : "Проверки PR Azure: требуется Code: Read"), { includeErrorMessage: true });
    return { m, base, init, get, version: s.azureVersion };
  }
  async checks(key: PrCiKey) {
    const a = this.access(key);
    const pr = await a.get(`git/repositories/${encodeURIComponent(key.repo)}/pullrequests/${key.number}`);
    if (pr.repository?.id !== key.repo || pr.pullRequestId !== key.number || !pr.repository?.project?.id) throw new AppError(502, "Azure вернул неверный PR или проект");
    const artifact = encodeURIComponent(`vstfs:///CodeReview/CodeReviewId/${pr.repository.project.id}/${key.number}`);
    const values: any[] = [];
    for (let skip = 0; ; skip += 100) {
      if (skip >= 1000) throw new AppError(502, "Слишком много проверок CI: список неполный");
      const page = await a.get(`policy/evaluations?artifactId=${artifact}&$top=100&$skip=${skip}`, true);
      if (!Array.isArray(page.value)) throw new AppError(502, "Azure не вернул проверки CI");
      values.push(...page.value);
      if (page.value.length < 100) break;
    }
    const health = { merge: pr.mergeStatus, checks: policyChecks(values), checkedAt: new Date().toISOString(), error: "" };
    // Only refresh the badge for the same revision that the list is showing.
    this.store.db.prepare("UPDATE pull_requests SET health=? WHERE monitor=? AND repo=? AND number=? AND head=? AND target=?")
      .run(JSON.stringify(health), key.monitor, key.repo, key.number, pr.lastMergeSourceCommit?.commitId || "", pr.lastMergeTargetCommit?.commitId || "");
    return { ...health, builds: health.checks.filter(c => c.build) };
  }
  async assertReady(key: PrCiKey) {
    const reason = ciMergeReason(await this.checks(key));
    if (reason) throw new AppError(409, reason);
  }
  async timeline(key: PrCiKey, buildId: number) {
    const checks = await this.checks(key);
    if (!checks.builds.some(b => b.buildId === buildId)) throw new AppError(404, "Этот запуск CI не относится к PR");
    const a = this.access(key);
    const build = await a.get(`build/builds/${buildId}`);
    const timeline = await a.get(`build/builds/${buildId}/timeline`);
    if (!Array.isArray(timeline.records)) throw new AppError(502, "Azure не вернул шаги CI");
    return { build: { id: buildId, name: build.definition?.name, number: build.buildNumber, status: build.status, result: build.result, startTime: build.startTime, finishTime: build.finishTime }, records: timeline.records.map((r: any) => ({ id: r.id, parentId: r.parentId, name: r.name, type: r.type, order: r.order, state: r.state, result: r.result, startTime: r.startTime, finishTime: r.finishTime, logId: r.log?.id, issues: (r.issues || []).map((i: any) => ({ type: i.type, message: String(i.message || "").slice(0, 2000) })).slice(0, 20) })) };
  }
  async log(key: PrCiKey, buildId: number, logId: number) {
    const timeline = await this.timeline(key, buildId);
    if (!timeline.records.some((r: any) => r.logId === logId)) throw new AppError(404, "Лог не относится к выбранному запуску CI");
    const a = this.access(key);
    const response = await fetch(`${a.base}build/builds/${buildId}/logs/${logId}?api-version=${encodeURIComponent(a.version)}`, { ...a.init, redirect: "error", signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new AppError(502, `Не удалось прочитать лог CI (HTTP ${response.status}). Проверьте PAT Build: Read и доступ к пайплайну.`);
    if (!response.body) throw new AppError(502, "Azure вернул пустой ответ лога");
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0, truncated = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = 256 * 1024 - size;
        chunks.push(value.subarray(0, remaining)); size += Math.min(remaining, value.length);
        if (value.length >= remaining) { truncated = true; break; }
      }
    } finally { await reader.cancel().catch(() => {}); }
    return { text: Buffer.concat(chunks).toString("utf8"), truncated };
  }
}
