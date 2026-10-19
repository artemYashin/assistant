import { z } from "zod";
import { Store, AppError } from "./store.js";
import { azureBase, requestJson } from "./http.js";
import type { Monitor } from "./pull-requests.js";
const branch = z.string().min(12).max(1000).startsWith("refs/heads/");
export const createPrSchema = z
  .object({
    monitor: z.string().min(1),
    source: branch,
    target: branch,
    title: z.string().trim().min(1).max(400),
    description: z.string().max(20000).default(""),
    draft: z.boolean().default(false),
  })
  .strict();
export class PrCreate {
  private pending = new Set<string>();
  constructor(private store: Store) {}
  private connection(id: string) {
    const m = this.store.db
      .prepare("SELECT * FROM pr_projects WHERE id=?")
      .get(id) as Monitor | undefined;
    if (!m) throw new AppError(404, "Репозиторий не настроен");
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat");
    if (
      m.source !== azureBase(s.azureUrl) ||
      m.azure_project !== s.azureProject
    )
      throw new AppError(
        409,
        "Подключение Azure изменилось: сохраните репозиторий заново",
      );
    if (!pat) throw new AppError(400, "Укажите PAT Azure: Code Read & Write");
    const root = `${m.source}/${encodeURIComponent(m.azure_project)}/_apis/git/repositories/${encodeURIComponent(m.repository)}`;
    return {
      root,
      version: s.azureVersion,
      headers: {
        Authorization: `Basic ${Buffer.from(":" + pat).toString("base64")}`,
        "Content-Type": "application/json",
      },
    };
  }
  async branches(id: string, query: string) {
    const c = this.connection(id);
    const data = await requestJson(
      `${c.root}/refs?filter=heads/&filterContains=${encodeURIComponent(query)}&$top=100&api-version=${encodeURIComponent(c.version)}`,
      {
        headers: c.headers,
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      },
      "Azure branches",
    );
    if (!Array.isArray(data.value))
      throw new AppError(502, "Azure не вернул список веток");
    return {
      branches: data.value
        .filter(
          (v: any) =>
            typeof v.name === "string" && v.name.startsWith("refs/heads/"),
        )
        .map((v: any) => v.name),
      more: data.value.length >= 100,
    };
  }
  async create(raw: unknown) {
    const input = createPrSchema.parse(raw);
    if (input.source === input.target)
      throw new AppError(400, "Выберите разные source и target ветки");
    const key = JSON.stringify([input.monitor, input.source, input.target]);
    if (this.pending.has(key))
      throw new AppError(409, "Создание этого PR уже выполняется");
    this.pending.add(key);
    try {
      const c = this.connection(input.monitor);
      const read = (path: string) =>
        requestJson(
          `${c.root}/${path}&api-version=${encodeURIComponent(c.version)}`,
          {
            headers: c.headers,
            redirect: "error",
            signal: AbortSignal.timeout(20000),
          },
          "Azure PR",
        );
      for (const ref of [input.source, input.target]) {
        const result = await read(
          `refs?filter=${encodeURIComponent(ref.slice(5))}&$top=2`,
        );
        if (!result.value?.some((v: any) => v.name === ref))
          throw new AppError(400, `Ветка ${ref} больше не существует`);
      }
      const existing = await read(
        `pullrequests?searchCriteria.status=active&searchCriteria.sourceRefName=${encodeURIComponent(input.source)}&searchCriteria.targetRefName=${encodeURIComponent(input.target)}&$top=1`,
      );
      if (!Array.isArray(existing.value))
        throw new AppError(502, "Не удалось проверить существующие PR");
      if (existing.value.length)
        return { number: existing.value[0].pullRequestId, existing: true };
      const fresh = this.connection(input.monitor);
      if (JSON.stringify(fresh) !== JSON.stringify(c))
        throw new AppError(409, "Настройки изменились. Откройте диалог заново");
      const result = await requestJson(
        `${c.root}/pullrequests?api-version=${encodeURIComponent(c.version)}`,
        {
          method: "POST",
          headers: c.headers,
          redirect: "error",
          signal: AbortSignal.timeout(30000),
          body: JSON.stringify({
            sourceRefName: input.source,
            targetRefName: input.target,
            title: input.title,
            description: input.description,
            isDraft: input.draft,
          }),
        },
        "Azure PR (Code: Read & Write)",
      );
      if (!Number.isInteger(result.pullRequestId))
        throw new AppError(
          502,
          "Azure не подтвердил номер PR. Проверьте список PR перед повтором",
        );
      return { number: result.pullRequestId, existing: false };
    } finally {
      this.pending.delete(key);
    }
  }
}
