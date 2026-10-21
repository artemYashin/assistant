import { readCodeStream, type CodeProgress } from "./code-progress.js";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { Store, AppError } from "./store.js";
import { azureBase, requestJson } from "./http.js";
import type { Monitor } from "./pull-requests.js";

export const codeBrowserSchema = z.object({
  client: z.string().min(1).max(200), project: z.string().min(1).max(200),
  operation: z.enum(["branches", "status", "pull", "tree", "file", "search"]),
  branch: z.string().max(500).default(""), path: z.string().max(4096).default(""),
  query: z.string().max(200).default(""), mode: z.enum(["name", "content"]).default("name"),
  revision: z.string().regex(/^[0-9a-f]{40,64}$/).optional(),
  offset: z.number().int().min(0).max(100000).default(0), refresh: z.boolean().default(false),
}).strict();
export class CodeBrowser {
  private serviceKey?: Promise<string>;
  private repositories = new Map<string, { id: string; expires: number }>();
  constructor(private store: Store) {}
  async request(raw: unknown, report?: (progress: CodeProgress) => void) {
    const input = codeBrowserSchema.parse(raw);
    report?.({ stage: "connecting" });
    const settings = this.store.settings(input);
    const monitor = this.store.db.prepare("SELECT * FROM pr_projects WHERE client=? AND project=? AND source=? AND azure_project=? ORDER BY enabled DESC LIMIT 1")
      .get(input.client, input.project, azureBase(settings.azureUrl), settings.azureProject) as Monitor | undefined;
    if (!monitor?.repository) throw new AppError(400, "Настройте Git-репозиторий выбранного проекта в «Заказчики и проекты».");
    const token = this.store.secret("azure.pat");
    if (!token) throw new AppError(400, "Укажите PAT Azure с правом Code Read.");
    const base = azureBase(settings.azureUrl);
    if (new URL(base).protocol !== "https:") throw new AppError(400, "Для просмотра кода требуется HTTPS-подключение к Azure.");
    const repoKey = JSON.stringify([base, settings.azureProject, monitor.repository, token]);
    let repository = this.repositories.get(repoKey);
    if (!repository || (["branches", "status", "pull"].includes(input.operation) && repository.expires < Date.now())) {
      const data = await requestJson(`${base}/${encodeURIComponent(settings.azureProject)}/_apis/git/repositories/${encodeURIComponent(monitor.repository)}?api-version=${encodeURIComponent(settings.azureVersion)}`, {
        headers: { Authorization: `Basic ${Buffer.from(":" + token).toString("base64")}` },
        redirect: "error", signal: AbortSignal.timeout(20000),
      }, "Azure repository (Code Read)");
      if (typeof data.id !== "string" || !/^[0-9a-f-]{36}$/i.test(data.id)) throw new AppError(502, "Azure не вернул ID репозитория.");
      repository = { id: data.id, expires: Date.now() + 60000 };
      this.repositories.set(repoKey, repository);
      if (this.repositories.size > 30) this.repositories.delete(this.repositories.keys().next().value!);
    }
    // Construct from the configured trusted origin, never use a remote-provided URL.
    const url = `${base}/${encodeURIComponent(settings.azureProject)}/_git/${repository.id}`;
    const service = process.env.CODE_BROWSER_URL;
    if (!service) throw new AppError(503, "Сервис кода не настроен. Пересоберите Docker Compose с code-browser.");
    const keyPath = process.env.CODE_BROWSER_KEY_FILE || "/repo-control/key";
    if (!this.serviceKey) {
      this.serviceKey = (async () => {
        await mkdir(dirname(keyPath), { recursive: true });
        try { await writeFile(keyPath, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); }
        catch (error: any) { if (error.code !== "EEXIST") throw error; }
        const key = (await readFile(keyPath, "utf8")).trim();
        if (!/^[0-9a-f]{64}$/.test(key)) throw new AppError(503, "Некорректный внутренний ключ сервиса кода.");
        return key;
      })().catch(error => { this.serviceKey = undefined; throw error; });
    }
    const key = await this.serviceKey;
    const fetchTimeoutSeconds = monitor.fetch_timeout_seconds || 300;
    const deadline = AbortSignal.timeout((fetchTimeoutSeconds + 180) * 1000);
    let response: Response;
    try {
      response = await fetch(`${service.replace(/\/$/, "")}/v1/repository`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, Accept: "application/x-ndjson" },
        body: JSON.stringify({ ...input, url, token, fetchTimeoutSeconds }), redirect: "error", signal: deadline,
      });
    } catch {
      throw new AppError(503, deadline.aborted ? "Истекло время ожидания сервиса кода. Увеличьте тайм-аут Git в настройках репозитория и повторите запрос." : "Нет соединения с сервисом кода. Проверьте, что контейнер code-browser запущен.");
    }
    let data: any;
    try {
      data = response.ok && response.headers.get("content-type")?.includes("application/x-ndjson")
        ? await readCodeStream(response, progress => report?.(progress))
        : await response.json();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(504, deadline.aborted ? "Истекло время ожидания сервиса кода. Увеличьте тайм-аут Git в настройках репозитория и повторите запрос." : "Соединение с сервисом кода прервано. Проверьте контейнер code-browser и повторите запрос.");
    }
    if (!response.ok) throw new AppError(response.status, data?.error || "Ошибка сервиса кода");
    if (!data) throw new AppError(502, "Некорректный ответ сервиса кода");
    return { ...data, repository: monitor.repository };
  }
}
