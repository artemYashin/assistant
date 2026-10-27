import { createHash } from "node:crypto";
import { z } from "zod";
import { Store, AppError } from "./store.js";
import { azureBase, requestJson } from "./http.js";
import { commentImageType, commentMarkdown } from "./comment-markdown.js";

export const createTicketSchema = z
  .object({
    requestId: z.string().uuid(),
    source: z.string().min(1).max(2000),
    type: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(255),
    assigneeId: z.string().uuid().nullable(),
    description: z.string().max(100000).default(""),
    acceptance: z.string().max(100000).default(""),
    steps: z.string().max(100000).default(""),
    relations: z
      .array(
        z
          .object({
            kind: z.enum(["parent", "child", "related"]),
            id: z.number().int().positive().safe(),
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.relations.filter((r) => r.kind === "parent").length > 1 ||
      new Set(v.relations.map((r) => r.id)).size !== v.relations.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Можно указать одного родителя; связанные тикеты не должны повторяться",
      });
  });
const fields = {
  description: "System.Description",
  acceptance: "Microsoft.VSTS.Common.AcceptanceCriteria",
  steps: "Microsoft.VSTS.TCM.ReproSteps",
} as const;
const relationTypes = {
  parent: "System.LinkTypes.Hierarchy-Reverse",
  child: "System.LinkTypes.Hierarchy-Forward",
  related: "System.LinkTypes.Related",
};
export class TicketCreate {
  constructor(private store: Store) {}
  private connection(source: string) {
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat");
    const guard = () => {
      if (source !== this.store.source() || pat !== this.store.secret("azure.pat"))
        throw new AppError(409, "Подключение изменилось. Откройте создание тикета заново.");
    };
    guard();
    if (!s.azureUrl || !s.azureProject || !pat)
      throw new AppError(400, "Настройте подключение Azure DevOps и PAT");
    const base = azureBase(s.azureUrl);
    const call = (path: string, init: RequestInit = {}) =>
      requestJson(
        `${base}/${encodeURIComponent(s.azureProject)}/_apis/wit/${path}${path.includes("?") ? "&" : "?"}api-version=${s.azureVersion}`,
        {
          ...init,
          headers: {
            Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`,
            "Content-Type": "application/json-patch+json",
            ...init.headers,
          },
        },
        "Azure DevOps",
        { includeErrorMessage: true },
      );
    return { call, guard, base, project: s.azureProject };
  }
  async upload(source: string, requestId: string, uploadId: string, bytes: Buffer) {
    z.string().uuid().parse(requestId);
    z.string().uuid().parse(uploadId);
    const { call, guard, base, project } = this.connection(source);
    const type = commentImageType(bytes);
    const key = `ticket.create-images:${source}:${requestId}`;
    const hash = createHash("sha256").update(bytes).digest("hex");
    const uploads = this.store.get<Record<string, { hash: string; url: string }>>(key, {});
    if (uploads[uploadId]) {
      if (uploads[uploadId].hash !== hash)
        throw new AppError(409, "Изображение изменилось. Добавьте его заново.");
      return uploads[uploadId];
    }
    if (Object.keys(uploads).length >= 10)
      throw new AppError(400, "До 10 загруженных изображений на один черновик тикета.");
    const extension = type === "image/jpeg" ? "jpg" : type.split("/")[1];
    const item = await call(`attachments?fileName=image.${extension}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(bytes),
    });
    const id = z.string().uuid().parse(item.id);
    const image = {
      hash,
      url: `${base}/${encodeURIComponent(project)}/_apis/wit/attachments/${id}`,
    };
    this.store.set(key, { ...this.store.get(key, {}), [uploadId]: image });
    guard();
    return image;
  }
  async options(source: string, type?: string) {
    const { call, guard } = this.connection(source);
    const result = await call(
      type ? `workitemtypes/${encodeURIComponent(type)}/fields` : "workitemtypes",
    );
    guard();
    if (!Array.isArray(result.value))
      throw new AppError(502, "Azure не вернул список полей или типов задач");
    return type
      ? { fields: result.value.map((f: any) => f.referenceName) }
      : { types: result.value.filter((t: any) => !t.isDisabled).map((t: any) => t.name) };
  }
  async create(body: unknown) {
    const input = createTicketSchema.parse(body);
    const { call, guard, base } = this.connection(input.source);
    const key = `ticket.create:${input.source}:${input.requestId}`;
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const receipt = this.store.get<any>(key, null);
    if (receipt) {
      if (receipt.result) {
        if (receipt.fingerprint !== fingerprint)
          throw new AppError(
            409,
            `Тикет #${receipt.result.id} уже создан. Откройте новую форму для другого тикета.`,
          );
        return receipt.result;
      }
      throw new AppError(
        409,
        "Результат предыдущего создания ещё не подтверждён. Проверьте Azure перед новой попыткой, чтобы не создать дубль.",
      );
    }
    const options = await this.options(input.source, input.type);
    const patch: { op: string; path: string; value: unknown }[] = [
      { op: "add", path: "/fields/System.Title", value: input.title },
    ];
    for (const [name, field] of Object.entries(fields)) {
      let value = input[name as keyof typeof fields];
      value = value.replace(
        /https:\/\/orbit\.invalid\/create-ticket-image\/([0-9a-f-]{36})/g,
        (_match, id: string) => {
          const image = this.store.get<Record<string, { url: string }>>(
            `ticket.create-images:${input.source}:${input.requestId}`,
            {},
          )[id];
          if (!image)
            throw new AppError(400, "Изображение ещё не загружено. Повторите создание тикета.");
          return image.url;
        },
      );
      if (!value.trim()) continue;
      if (!options.fields?.includes(field))
        throw new AppError(400, `Выбранный тип не поддерживает поле ${field}`);
      patch.push({ op: "add", path: `/fields/${field}`, value: await commentMarkdown(value) });
    }
    if (input.assigneeId) {
      const users = [
        ...this.store.get<any[]>("developers:" + input.source, []),
        ...this.store.get<any[]>("azure.assignees.recent:" + input.source, []),
      ];
      const user = users.find((u) => u.id === input.assigneeId);
      if (!user?.email) throw new AppError(400, "Найдите и выберите исполнителя в Azure заново");
      patch.push({ op: "add", path: "/fields/System.AssignedTo", value: user.email });
    }
    for (const relation of input.relations)
      patch.push({
        op: "add",
        path: "/relations/-",
        value: {
          rel: relationTypes[relation.kind],
          url: `${base}/_apis/wit/workItems/${relation.id}`,
        },
      });
    guard();
    // Recheck after asynchronous validation: concurrent clicks must not create two items.
    if (this.store.get(key, null))
      throw new AppError(409, "Создание уже выполняется. Дождитесь результата.");
    this.store.set(key, { fingerprint, pending: true });
    try {
      const item = await call(`workitems/$${encodeURIComponent(input.type)}`, {
        method: "POST",
        body: JSON.stringify(patch),
      });
      if (!Number.isSafeInteger(item.id) || item.id <= 0)
        throw new AppError(502, "Azure не вернул номер созданного тикета");
      const result = {
        id: item.id,
        source: input.source,
        title: item.fields?.["System.Title"] || input.title,
      };
      this.store.set(key, { fingerprint, result });
      return result;
    } catch (error) {
      const status = (error as any)?.upstreamStatus;
      if ([400, 401, 403, 404, 409, 422, 429].includes(status)) this.store.set(key, null);
      else
        throw new AppError(
          502,
          "Не удалось подтвердить результат создания. Проверьте Azure перед новой попыткой: тикет мог уже создаться. Черновик сохранён в открытой форме.",
        );
      throw error;
    }
  }
}
