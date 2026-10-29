import { createHash } from "node:crypto";
import { z } from "zod";
import { Store, AppError } from "./store.js";
import { azureBase, requestJson } from "./http.js";
import type { Monitor } from "./pull-requests.js";
import { descriptionImages } from "./pr-images.js";
const branch = z.string().min(12).max(1000).startsWith("refs/heads/");
export const createPrSchema = z
  .object({
    monitor: z.string().min(1),
    source: branch,
    target: branch,
    title: z.string().trim().min(1).max(400),
    description: z.string().max(20000).default(""),
    draft: z.boolean().default(false),
    requestId: z.string().uuid().optional(),
    images: z
      .array(z.object({ id: z.string().uuid() }).strict())
      .max(10)
      .default([]),
  })
  .strict();
export class PrCreate {
  private pending = new Set<string>();
  constructor(private store: Store) {}
  private connection(id: string) {
    const m = this.store.db.prepare("SELECT * FROM pr_projects WHERE id=?").get(id) as
      Monitor | undefined;
    if (!m) throw new AppError(404, "Репозиторий не настроен");
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat");
    if (m.source !== azureBase(s.azureUrl) || m.azure_project !== s.azureProject)
      throw new AppError(409, "Подключение Azure изменилось: сохраните репозиторий заново");
    if (!pat) throw new AppError(400, "Укажите PAT Azure: Code Read & Write");
    const root = `${m.source}/${encodeURIComponent(m.azure_project)}/_apis/git/repositories/${encodeURIComponent(m.repository)}`;
    return {
      root,
      source: m.source,
      version: s.azureVersion,
      headers: {
        Authorization: `Basic ${Buffer.from(":" + pat).toString("base64")}`,
        "Content-Type": "application/json",
      },
    };
  }
  async branches(id: string, query: string, personal = false) {
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
    if (!Array.isArray(data.value)) throw new AppError(502, "Azure не вернул список веток");
    const branches: string[] = data.value
      .filter((v: any) => typeof v.name === "string" && v.name.startsWith("refs/heads/"))
      .map((v: any) => v.name);
    if (!personal) return { branches, more: data.value.length >= 100 };
    try {
      const options = {
        headers: c.headers,
        redirect: "error" as const,
        signal: AbortSignal.timeout(20000),
      };
      const identity = await requestJson(
        `${c.source}/_apis/connectionData?connectOptions=1&api-version=${encodeURIComponent(c.version.split("-")[0] + "-preview.1")}`,
        options,
        "Azure identity",
      );
      const user = identity.authenticatedUser?.id;
      if (typeof user !== "string" || !user) throw new Error("No authenticated user");
      const pushes = await requestJson(
        `${c.root}/pushes?searchCriteria.pusherId=${encodeURIComponent(user)}&searchCriteria.includeRefUpdates=true&$top=100&api-version=${encodeURIComponent(c.version)}`,
        options,
        "Azure pushes",
      );
      if (!Array.isArray(pushes.value)) throw new Error("No pushes");
      const recent = new Map<string, number>();
      for (const push of pushes.value) {
        const time = Date.parse(push.date);
        if (!Number.isFinite(time)) continue;
        for (const ref of push.refUpdates || []) {
          if (
            typeof ref.name === "string" &&
            ref.name.startsWith("refs/heads/") &&
            ref.name.toLowerCase().includes(query.toLowerCase()) &&
            !/^0+$/.test(ref.newObjectId || "")
          )
            recent.set(ref.name, Math.max(recent.get(ref.name) || 0, time));
        }
      }
      // Recent personal branches may be outside the first alphabetical refs page.
      // Resolve them in one batch, never suggest deleted refs from push history.
      if ([...recent.keys()].some((name) => !branches.includes(name))) {
        const stats = await requestJson(
          `${c.root}/stats/branches?api-version=${encodeURIComponent(c.version)}`,
          options,
          "Azure branches",
        );
        if (!Array.isArray(stats.value)) throw new Error("No branch stats");
        const live = new Set(stats.value.map((item: any) => `refs/heads/${item.name}`));
        for (const name of recent.keys())
          if (live.has(name) && !branches.includes(name)) branches.push(name);
      }
      branches.sort((a, b) => (recent.get(b) || 0) - (recent.get(a) || 0));
      return {
        branches,
        personalBranches: branches.filter((name) => recent.has(name)),
        branchUpdatedAt: Object.fromEntries(
          branches
            .filter((name) => recent.has(name))
            .map((name) => [name, new Date(recent.get(name)!).toISOString()]),
        ),
        more: data.value.length >= 100,
      };
    } catch {
      return {
        branches,
        personalBranches: [],
        more: data.value.length >= 100,
        warning: "Не удалось определить последние ваши ветки. Показан обычный список.",
      };
    }
  }
  async branchHead(id: string, source: string) {
    branch.parse(source);
    const c = this.connection(id);
    const result = await requestJson(
      `${c.root}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(source.slice(11))}&searchCriteria.itemVersion.versionType=branch&$top=1&api-version=${encodeURIComponent(c.version)}`,
      { headers: c.headers, redirect: "error", signal: AbortSignal.timeout(20000) },
      "Azure branch commit",
    );
    let commit = result.value?.[0];
    if (commit?.commentTruncated && typeof commit.commitId === "string") {
      commit = await requestJson(
        `${c.root}/commits/${encodeURIComponent(commit.commitId)}?api-version=${encodeURIComponent(c.version)}`,
        { headers: c.headers, redirect: "error", signal: AbortSignal.timeout(20000) },
        "Azure branch commit",
      );
    }
    if (typeof commit?.commitId !== "string" || typeof commit.comment !== "string")
      throw new AppError(502, "Azure не вернул последний коммит ветки");
    return {
      title: commit.comment.split(/\r?\n/)[0].trim().slice(0, 400),
      commitId: commit.commitId,
    };
  }

  safeToEdit(raw: unknown): boolean {
    const parsed = z
      .object({
        requestId: z.string().uuid(),
        monitor: z.string(),
        source: z.string(),
        target: z.string(),
      })
      .safeParse(raw);
    if (!parsed.success) return false;
    const input = parsed.data;
    return (
      !this.pending.has(JSON.stringify([input.monitor, input.source, input.target])) &&
      !this.store.get<Receipt | null>(`pr.create.receipt.v1:${input.requestId}`, null)
    );
  }

  async create(raw: unknown, files: { originalname: string; buffer: Buffer }[] = []) {
    const input = createPrSchema.parse(raw);
    const uploads = validateImages(input, files);
    if (input.source === input.target)
      throw new AppError(400, "Выберите разные source и target ветки");
    const key = JSON.stringify([input.monitor, input.source, input.target]);
    if (this.pending.has(key)) throw new AppError(409, "Создание этого PR уже выполняется");
    this.pending.add(key);
    try {
      const c = this.connection(input.monitor);
      const receiptKey = input.requestId ? `pr.create.receipt.v1:${input.requestId}` : null;
      const digest = createHash("sha256")
        .update(
          JSON.stringify([
            c.root,
            input,
            uploads.map((file) => createHash("sha256").update(file.buffer).digest("hex")),
          ]),
        )
        .digest("hex");
      let receipt = receiptKey ? this.store.get<Receipt | null>(receiptKey, null) : null;
      if (receipt && receipt.digest !== digest)
        throw new AppError(
          409,
          "Этот запрос уже использован с другими данными. Вернитесь к исходной форме.",
        );
      const save = () => {
        if (receiptKey && receipt) this.store.set(receiptKey, receipt);
      };
      if (receipt?.number) {
        if (receipt.complete) return { number: receipt.number, existing: false };
        return await this.finishImages(c, input, uploads, receipt, save);
      }
      if (receipt)
        throw new AppError(
          409,
          "Результат создания PR пока не подтверждён. Проверьте список PR в Azure перед новым запросом; повторное создание остановлено.",
        );
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
        const result = await read(`refs?filter=${encodeURIComponent(ref.slice(5))}&$top=2`);
        if (!result.value?.some((v: any) => v.name === ref))
          throw new AppError(400, `Ветка ${ref} больше не существует`);
      }
      const existing = await read(
        `pullrequests?searchCriteria.status=active&searchCriteria.sourceRefName=${encodeURIComponent(input.source)}&searchCriteria.targetRefName=${encodeURIComponent(input.target)}&$top=1`,
      );
      if (!Array.isArray(existing.value))
        throw new AppError(502, "Не удалось проверить существующие PR");
      if (existing.value.length) return { number: existing.value[0].pullRequestId, existing: true };
      const fresh = this.connection(input.monitor);
      if (JSON.stringify(fresh) !== JSON.stringify(c))
        throw new AppError(409, "Настройки изменились. Откройте диалог заново");
      let resolvedLength = input.description;
      for (const file of uploads)
        resolvedLength = resolvedLength
          .split(`https://orbit.invalid/pr-image/${file.id}`)
          .join(
            `${c.root}/pullRequests/2147483647/attachments/${input.requestId}-${file.id}.${file.extension}?api-version=${encodeURIComponent(c.version)}`,
          );
      if (resolvedLength.length > 20000)
        throw new AppError(
          400,
          "Описание со ссылками на изображения превышает 20000 символов. Сократите описание.",
        );
      receipt = { digest, number: null, uploaded: [], complete: false };
      save();
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
            description: uploads.length ? "" : input.description,
            isDraft: input.draft,
          }),
        },
        "Azure PR (Code: Read & Write)",
      );
      if (!Number.isInteger(result.pullRequestId))
        throw new AppError(502, "Azure не подтвердил номер PR. Проверьте список PR перед повтором");
      receipt.number = result.pullRequestId;
      save();
      return await this.finishImages(c, input, uploads, receipt, save);
    } finally {
      this.pending.delete(key);
    }
  }
  private async finishImages(
    c: ReturnType<PrCreate["connection"]>,
    input: z.infer<typeof createPrSchema>,
    uploads: Upload[],
    receipt: Receipt,
    save: () => void,
  ) {
    const number = receipt.number!;
    if (!uploads.length) {
      receipt.complete = true;
      save();
      return { number, existing: false };
    }
    try {
      let description = input.description;
      for (const file of uploads) {
        const name = `${input.requestId}-${file.id}.${file.extension}`;
        const url = `${c.root}/pullRequests/${number}/attachments/${name}?api-version=${encodeURIComponent(c.version)}`;
        if (!receipt.uploaded.includes(file.id)) {
          // Deterministic attachment names let a retry recover an upload whose
          // successful response was lost, without creating another attachment.
          const found = await requestJson(
            `${c.root}/pullRequests/${number}/attachments?api-version=${encodeURIComponent(c.version)}`,
            { headers: c.headers, redirect: "error", signal: AbortSignal.timeout(20000) },
            "Azure PR attachments",
          );
          const list = Array.isArray(found) ? found : found.value;
          if (!Array.isArray(list)) throw new Error("Attachments unavailable");
          if (!list.some((item: any) => item.displayName === name)) {
            const uploaded = await requestJson(
              url,
              {
                method: "POST",
                headers: { ...c.headers, "Content-Type": "application/octet-stream" },
                body: new Uint8Array(file.buffer),
                redirect: "error",
                signal: AbortSignal.timeout(30000),
              },
              "Azure PR attachment (Code: Read & Write)",
            );
            if (uploaded?.displayName !== name) throw new Error("Azure did not confirm attachment");
          }
          receipt.uploaded.push(file.id);
          save();
        }
        description = description.split(`https://orbit.invalid/pr-image/${file.id}`).join(url);
      }
      if (description.length > 20000)
        throw new AppError(
          400,
          "Описание со ссылками на изображения превышает 20000 символов. Сократите описание.",
        );
      const updated = await requestJson(
        `${c.root}/pullrequests/${number}?api-version=${encodeURIComponent(c.version)}`,
        {
          method: "PATCH",
          headers: c.headers,
          body: JSON.stringify({ description }),
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        },
        "Azure PR description",
      );
      if (updated.pullRequestId !== number || updated.description !== description)
        throw new Error("Azure did not confirm description");
      receipt.complete = true;
      save();
      return { number, existing: false };
    } catch {
      return {
        number,
        existing: false,
        incomplete: true,
        attachmentError:
          "PR создан, но описание с изображениями не сохранено полностью. Повторите отправку из этой формы: новый PR не будет создан.",
      };
    }
  }
}

type Receipt = { digest: string; number: number | null; uploaded: string[]; complete: boolean };
type Upload = { id: string; extension: string; buffer: Buffer };
function validateImages(
  input: z.infer<typeof createPrSchema>,
  files: { originalname: string; buffer: Buffer }[],
): Upload[] {
  if (input.images.length !== files.length || (files.length && !input.requestId))
    throw new AppError(400, "Не все изображения приложены к запросу.");
  if (new Set(input.images.map((image) => image.id)).size !== input.images.length)
    throw new AppError(400, "Повторяющийся идентификатор изображения.");
  const uploads = input.images.map(({ id }) => {
    const matches = files.filter((file) => file.originalname === id);
    if (matches.length !== 1) throw new AppError(400, "Не найден файл изображения.");
    const buffer = matches[0].buffer;
    if (!buffer.length || buffer.length > 10 * 1024 * 1024)
      throw new AppError(400, "Изображение должно быть не больше 10 МБ.");
    const extension = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? "png"
      : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
        ? "jpg"
        : ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString())
          ? "gif"
          : buffer.subarray(0, 4).toString() === "RIFF" &&
              buffer.subarray(8, 12).toString() === "WEBP"
            ? "webp"
            : null;
    if (!extension) throw new AppError(400, "Поддерживаются только PNG, JPEG, GIF и WebP.");
    if (!input.description.includes(`https://orbit.invalid/pr-image/${id}`))
      throw new AppError(400, "Изображение отсутствует в описании.");
    return { id, extension, buffer };
  });
  let description = input.description;
  for (const file of uploads)
    description = description.split(`https://orbit.invalid/pr-image/${file.id}`).join("");
  const localImage = descriptionImages(input.description).some((raw) => {
    if (uploads.some((file) => raw === `https://orbit.invalid/pr-image/${file.id}`)) return false;
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      return (
        !["https:", "http:"].includes(url.protocol) ||
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host === "[::1]" ||
        /^127\./.test(host) ||
        host === "0.0.0.0"
      );
    } catch {
      return true;
    }
  });
  if (/https:\/\/orbit\.invalid\/pr-image\//i.test(description) || localImage)
    throw new AppError(
      400,
      "Прикрепите изображения через редактор: локальные ссылки недоступны другим пользователям.",
    );

  return uploads;
}
