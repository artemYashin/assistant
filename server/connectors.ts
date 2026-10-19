import { changeTicketState } from "./ticket-status.js";
import { randomUUID } from "node:crypto";
import { Store, AppError, type Settings } from "./store.js";
import { IntegrationsAuth } from "./auth.js";
import { requestJson, azureBase } from "./http.js";

// Candidates only: Azure checks existence and project when the user adds one.
export function extractTicketIds(content: string): number[] {
  const ids = new Set<number>();
  const add = (value: string) => {
    const id = Number(value);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  };
  const text = plainText(content);
  // No length restriction: small IDs are valid candidates too.
  for (const match of text.matchAll(
    /(?<![\p{L}\p{N}_])([0-9]+)(?![\p{L}\p{N}_])/gu,
  ))
    add(match[1]);
  // Inspect visible URLs and anchor destinations, but not unrelated HTML attributes.
  const links = [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)].map((m) => m[0]);
  for (const anchor of content.matchAll(/<a\b[^>]*>/gi)) {
    const href = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(
      anchor[0],
    );
    if (href) links.push(plainText(href[1] ?? href[2] ?? href[3]));
  }
  for (const link of links) {
    let decoded = link;
    try {
      decoded = decodeURIComponent(link);
    } catch {
      /* Keep malformed URLs searchable. */
    }
    for (const match of decoded.matchAll(/[0-9]+/g)) add(match[0]);
  }
  return [...ids];
}
export function plainText(value: string) {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (entity, value: string) => {
      const code =
        value[0].toLowerCase() === "x"
          ? parseInt(value.slice(1), 16)
          : Number(value);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    })
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}
export class Connectors {
  constructor(
    private store: Store,
    private auth: IntegrationsAuth,
  ) {}
  private async graph(path: string, init: RequestInit = {}) {
    const url = path.startsWith("https:")
      ? new URL(path)
      : new URL(`https://graph.microsoft.com/v1.0${path}`);
    if (
      url.origin !== "https://graph.microsoft.com" ||
      !url.pathname.startsWith("/v1.0/")
    )
      throw new AppError(400, "Недопустимая ссылка Graph");
    return requestJson(
      url.href,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${await this.auth.graphToken()}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      },
      "Microsoft Graph",
    );
  }
  async refreshChats() {
    let next = "/me/chats?$expand=members&$top=50";
    let count = 0;
    while (next) {
      const result = await this.graph(next);
      for (const chat of result.value || []) {
        const name =
          chat.topic ||
          (chat.members || [])
            .map((m: any) => m.displayName)
            .filter(Boolean)
            .join(", ") ||
          `Чат ${chat.id}`;
        this.store.db
          .prepare(
            "INSERT INTO chats(id,name) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
          )
          .run(chat.id, name);
        count++;
      }
      next = result["@odata.nextLink"] || "";
      if (count > 5000) throw new AppError(502, "Список чатов слишком большой");
    }
    return { count };
  }
  async sendMessage(chatId: string, body: string): Promise<{ id: string }> {
    const result = await this.graph(
      `/chats/${encodeURIComponent(chatId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ body: { contentType: "text", content: body } }),
      },
    );
    if (!result.id) throw new Error("Graph returned no message ID");
    return { id: result.id };
  }
  ingest(chatId: string, message: any, source = this.store.source()) {
    if (!message.id) return;
    const text = message.deletedDateTime
      ? ""
      : plainText(message.body?.content || "");
    this.store.db
      .prepare(
        "INSERT INTO messages VALUES (?,?,?,?,?,?) ON CONFLICT(chat_id,id) DO UPDATE SET body=excluded.body,sender=excluded.sender,url=excluded.url",
      )
      .run(
        message.id,
        chatId,
        message.from?.user?.displayName || "Teams",
        text,
        message.webUrl || "",
        message.createdDateTime || new Date().toISOString(),
      );
    const ids = message.deletedDateTime
      ? []
      : extractTicketIds(message.body?.content || "");
    const previous = this.store.db
      .prepare(
        "SELECT id,ticket_id FROM suggestions WHERE source=? AND chat_id=? AND message_id=? AND status='new'",
      )
      .all(source, chatId, message.id) as { id: string; ticket_id: number }[];
    for (const suggestion of previous) {
      if (!ids.includes(suggestion.ticket_id))
        this.store.db
          .prepare("DELETE FROM suggestions WHERE id=?")
          .run(suggestion.id);
      else
        this.store.db
          .prepare("UPDATE suggestions SET excerpt=? WHERE id=?")
          .run(text.slice(0, 2000), suggestion.id);
    }
    for (const ticketId of ids) {
      const tracked = this.store.db
        .prepare("SELECT 1 FROM tickets WHERE source=? AND id=?")
        .get(source, ticketId);
      if (tracked) continue;
      this.store.db
        .prepare(
          "INSERT OR IGNORE INTO suggestions(id,source,ticket_id,chat_id,message_id,excerpt,created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          source,
          ticketId,
          chatId,
          message.id,
          text.slice(0, 2000),
          new Date().toISOString(),
        );
    }
  }
  async syncTeams() {
    const source = this.store.source();
    const chats = this.store.db
      .prepare("SELECT * FROM chats WHERE watched=1")
      .all() as { id: string; synced_at: string | null }[];
    let count = 0;
    for (const chat of chats) {
      let next = `/chats/${encodeURIComponent(chat.id)}/messages?$top=50&$orderby=lastModifiedDateTime%20desc`;
      let pages = 0;
      const started = new Date().toISOString();
      while (next) {
        const result = await this.graph(next);
        let reached = false;
        for (const message of result.value || []) {
          const modified =
            message.lastModifiedDateTime || message.createdDateTime;
          if (chat.synced_at && modified && modified < chat.synced_at) {
            reached = true;
            continue;
          }
          this.ingest(chat.id, message, source);
          count++;
        }
        // First import deliberately covers the latest 50 messages. Subsequent imports paginate to the watermark.
        if (!chat.synced_at || reached) break;
        next = result["@odata.nextLink"] || "";
        if (++pages >= 100 && next)
          throw new AppError(
            502,
            "Слишком много сообщений за период. Синхронизация не завершена; отметка времени не изменена.",
          );
      }
      this.store.db
        .prepare("UPDATE chats SET synced_at=? WHERE id=?")
        .run(started, chat.id);
    }
    return { count, chats: chats.length };
  }
  private async azure(
    path: string,
    init: RequestInit,
    s: Settings,
    pat: string | undefined,
  ) {
    if (!s.azureUrl || !s.azureProject || !pat)
      throw new AppError(400, "Настройте URL, проект и PAT Azure DevOps");
    const base = azureBase(s.azureUrl);
    const url = `${base}/${encodeURIComponent(s.azureProject)}/_apis/wit/${path}${path.includes("?") ? "&" : "?"}api-version=${encodeURIComponent(s.azureVersion)}`;
    return requestJson(
      url,
      {
        ...init,
        headers: {
          Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      },
      "Azure DevOps",
    );
  }
  private saveTicket(item: any, s: Settings) {
    const f = item.fields || {};
    const url = `${azureBase(s.azureUrl)}/${encodeURIComponent(s.azureProject)}/_workitems/edit/${item.id}`;
    this.store.db
      .prepare(
        "INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(source,id) DO UPDATE SET title=excluded.title,state=excluded.state,assigned=excluded.assigned,type=excluded.type,url=excluded.url,changed_at=excluded.changed_at,synced_at=excluded.synced_at",
      )
      .run(
        this.store.source(s),
        item.id,
        f["System.Title"] || "",
        f["System.State"] || "",
        typeof f["System.AssignedTo"] === "string"
          ? f["System.AssignedTo"]
          : f["System.AssignedTo"]?.displayName || "",
        f["System.WorkItemType"] || "",
        url,
        f["System.ChangedDate"] || null,
        new Date().toISOString(),
      );
  }
  async changeTicketStatus(
    id: number,
    state: string,
    guard: () => void = () => {},
  ) {
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat");
    try {
      const result = await changeTicketState(id, state, s.azureProject, {
        read: () => this.azure(`workitems/${id}`, {}, s, pat),
        states: async (type) => {
          const r = await this.azure(
            `workitemtypes/${encodeURIComponent(type)}/states`,
            {},
            s,
            pat,
          );
          return (r.value || []).map((x: any) => x.name);
        },
        beforeWrite: () => {
          guard();
          if (this.store.source() !== this.store.source(s))
            throw new AppError(
              409,
              "Подключение Azure изменилось, запись отменена",
            );
        },
        patch: (revision, target) =>
          this.azure(
            `workitems/${id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json-patch+json" },
              body: JSON.stringify([
                { op: "test", path: "/rev", value: revision },
                { op: "add", path: "/fields/System.State", value: target },
              ]),
            },
            s,
            pat,
          ),
      });
      if (
        this.store.db
          .prepare("SELECT 1 FROM tickets WHERE source=? AND id=?")
          .get(this.store.source(s), id)
      )
        this.saveTicket(result.item, s);
      this.store.audit(
        "ticket.state.verified",
        JSON.stringify({
          id,
          state: result.state,
          outcome: result.outcome,
          source: this.store.source(s),
        }),
      );
      const { item, ...receipt } = result;
      return receipt;
    } catch (e) {
      this.store.audit(
        "ticket.state.unconfirmed",
        JSON.stringify({ id, requested: state, source: this.store.source(s) }),
      );
      throw e;
    }
  }
  async ticketOptions() {
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat");
    const result = await this.azure("workitemtypes", {}, s, pat);
    const options = [];
    for (const type of result.value || []) {
      const states =
        type.states ||
        (
          await this.azure(
            `workitemtypes/${encodeURIComponent(type.name)}/states`,
            {},
            s,
            pat,
          )
        ).value;
      options.push({
        name: type.name,
        states: (states || []).map((v: any) => v.name),
      });
    }
    return options;
  }
  async ticketDetails(id: number) {
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat");
    const item = await this.azure(`workitems/${id}?$expand=all`, {}, s, pat);
    if (item.fields?.["System.TeamProject"] !== s.azureProject)
      throw new AppError(400, "Тикет относится к другому проекту Azure DevOps");
    const comments: any[] = [];
    const warnings: string[] = [];
    let continuation = "";
    const seen = new Set<string>();
    try {
      do {
        const page = await this.azure(
          `workitems/${id}/comments?$top=200&$expand=renderedText&continuationToken=${encodeURIComponent(continuation)}`,
          {},
          {
            ...s,
            azureVersion: s.azureVersion.startsWith("7.0")
              ? "7.0-preview.3"
              : "7.1-preview.4",
          },
          pat,
        );
        if (!Array.isArray(page.comments))
          throw new AppError(502, "Некорректный ответ Comments API");
        comments.push(...page.comments);
        continuation = page.continuationToken || "";
        if (
          continuation &&
          (seen.has(continuation) || comments.length >= 10000)
        ) {
          warnings.push(
            "Комментарии загружены не полностью: достигнут защитный лимит",
          );
          break;
        }
        seen.add(continuation);
      } while (continuation);
    } catch {
      warnings.push(
        "Комментарии недоступны: проверьте разрешения и поддержку Comments API на вашем Azure Server",
      );
    }
    const base = azureBase(s.azureUrl);
    const attachments: { id: string; name: string; image: boolean }[] = [];
    const add = (url: string, name = "Вложение", image = false) => {
      try {
        const u = new URL(url, base + "/");
        const b = new URL(base);
        const match =
          /\/_apis\/wit\/attachments\/([0-9a-f-]{36})(?:$|\/)/i.exec(
            u.pathname,
          );
        if (
          u.origin !== b.origin ||
          !u.pathname.startsWith(b.pathname.replace(/\/$/, "") + "/") ||
          !match
        )
          return;
        if (!attachments.some((a) => a.id === match[1]))
          attachments.push({
            id: match[1],
            name,
            image: image || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name),
          });
        else if (image)
          attachments.find((a) => a.id === match[1])!.image = true;
      } catch {}
    };
    for (const relation of item.relations || [])
      if (relation.rel === "AttachedFile")
        add(relation.url, relation.attributes?.name || "Вложение");
    const content = [
      ...Object.values(item.fields || {}).filter((v) => typeof v === "string"),
      ...comments.map((c) => c.renderedText || c.text || ""),
    ].join("\n");
    for (const match of content.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi))
      add(match[1].replace(/&amp;/g, "&"), "Изображение в тексте", true);
    for (const match of content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g))
      add(match[1], "Изображение в комментарии", true);
    const cardId = randomUUID();
    const card = {
      id,
      source: this.store.source(s),
      base,
      project: s.azureProject,
      fields: item.fields,
      comments: comments.map((c) => ({
        id: c.id,
        author: c.createdBy?.displayName || "",
        date: c.createdDate,
        text: plainText(c.renderedText || c.text || ""),
      })),
      attachments,
      warnings,
      loadedAt: new Date().toISOString(),
      url: `${base}/${encodeURIComponent(s.azureProject)}/_workitems/edit/${id}`,
    };
    this.store.db
      .prepare("INSERT INTO ticket_cards VALUES (?,?)")
      .run(cardId, JSON.stringify(card));
    return { cardId, ...card };
  }
  ticketCard(ref: string) {
    const row = this.store.db
      .prepare("SELECT data FROM ticket_cards WHERE id=?")
      .get(ref) as { data: string } | undefined;
    if (!row) throw new AppError(404, "Карточка не найдена");
    return JSON.parse(row.data);
  }
  async attachment(ref: string, id: string) {
    const card = this.ticketCard(ref);
    const attachment = card.attachments.find((a: any) => a.id === id);
    if (!attachment) throw new AppError(404, "Вложение не найдено в тикете");
    const s = this.store.settings();
    if (card.source !== this.store.source(s))
      throw new AppError(
        409,
        "Подключение Azure изменилось: загрузите тикет заново",
      );
    const pat = this.store.secret("azure.pat");
    if (!pat) throw new AppError(400, "Подключите Azure DevOps");
    const response = await fetch(
      `${card.base}/${encodeURIComponent(card.project)}/_apis/wit/attachments/${encodeURIComponent(id)}?api-version=${encodeURIComponent(s.azureVersion)}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(":" + pat).toString("base64")}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok || !response.body)
      throw new AppError(502, "Не удалось загрузить вложение");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 20 * 1024 * 1024) {
          await reader.cancel();
          throw new AppError(413, "Вложение больше 20 МБ");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = Buffer.concat(chunks);
    const raw = body
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? "image/png"
      : body[0] === 255 && body[1] === 216 && body[2] === 255
        ? "image/jpeg"
        : body.subarray(0, 3).toString() === "GIF"
          ? "image/gif"
          : body.subarray(0, 4).toString() === "RIFF" &&
              body.subarray(8, 12).toString() === "WEBP"
            ? "image/webp"
            : "application/octet-stream";
    const type = [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/bmp",
    ].includes(raw)
      ? raw
      : "application/octet-stream";
    return { body, type, name: attachment.name };
  }
  async trackTicket(id: number) {
    const s = this.store.settings();
    const item = await this.azure(
      `workitems/${id}`,
      {},
      s,
      this.store.secret("azure.pat"),
    );
    if (item.fields?.["System.TeamProject"] !== s.azureProject)
      throw new AppError(400, "Тикет относится к другому проекту Azure DevOps");
    this.saveTicket(item, s);
    this.store.db
      .prepare(
        "UPDATE suggestions SET status='tracked' WHERE source=? AND ticket_id=?",
      )
      .run(this.store.source(s), id);
    this.store.audit("ticket.tracked", String(id));
    return item.id;
  }
  async syncTickets(importMine = false, automatic = false) {
    const s = this.store.settings();
    const pat = this.store.secret("azure.pat");
    const ids = new Set(
      (
        this.store.db
          .prepare("SELECT id FROM tickets WHERE source=?")
          .all(this.store.source(s)) as { id: number }[]
      ).map((x) => x.id),
    );
    if (importMine || (automatic && s.azureAutoImport)) {
      if (automatic && (!s.azureTypes.length || !s.azureStates.length))
        throw new AppError(
          400,
          "Для автоимпорта выберите типы и статусы задач",
        );
      const quote = (v: string) => "'" + v.replace(/'/g, "''") + "'";
      const result = await this.azure(
        "wiql",
        {
          method: "POST",
          body: JSON.stringify({
            query:
              "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AssignedTo] = @Me" +
              (automatic
                ? ` AND [System.WorkItemType] IN (${s.azureTypes.map(quote).join(",")}) AND [System.State] IN (${s.azureStates.map(quote).join(",")})`
                : "") +
              " ORDER BY [System.ChangedDate] DESC",
          }),
        },
        s,
        pat,
      );
      for (const item of result.workItems || []) ids.add(item.id);
    }
    const list = [...ids];
    for (let i = 0; i < list.length; i += 200) {
      const result = await this.azure(
        "workitemsbatch",
        {
          method: "POST",
          body: JSON.stringify({
            ids: list.slice(i, i + 200),
            fields: [
              "System.Title",
              "System.State",
              "System.AssignedTo",
              "System.WorkItemType",
              "System.ChangedDate",
              "System.TeamProject",
            ],
            errorPolicy: "Fail",
          }),
        },
        s,
        pat,
      );
      for (const item of result.value || []) this.saveTicket(item, s);
    }
    return { count: list.length };
  }
}
