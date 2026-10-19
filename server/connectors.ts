import { randomUUID } from "node:crypto";
import { Store, AppError, type Settings } from "./store.js";
import { IntegrationsAuth } from "./auth.js";
import { requestJson, azureBase } from "./http.js";

export function extractTicketIds(text: string): number[] {
  const ids = new Set<number>();
  for (const pattern of [
    /(?:\bAB#|(?<![\w&])#)(\d{1,9})\b/gi,
    /(?<![\p{L}\d])(?:ticket|work\s*item|bug|тикет|задач[аиу]?|баг)\s*(?:№|#|:|-)?\s*(\d{1,9})\b/giu,
    /\/_workitems\/edit\/(\d{1,9})\b/gi,
  ]) {
    for (const m of text.matchAll(pattern)) {
      const id = Number(m[1]);
      if (id > 0) ids.add(id);
    }
  }
  return [...ids];
}
export function plainText(value: string) {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
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
      : extractTicketIds(`${text} ${message.body?.content || ""}`);
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
  async syncTickets(importMine = false) {
    const s = this.store.settings();
    const pat = this.store.secret("azure.pat");
    const ids = new Set(
      (
        this.store.db
          .prepare("SELECT id FROM tickets WHERE source=?")
          .all(this.store.source(s)) as { id: number }[]
      ).map((x) => x.id),
    );
    if (importMine) {
      const result = await this.azure(
        "wiql",
        {
          method: "POST",
          body: JSON.stringify({
            query:
              "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AssignedTo] = @Me ORDER BY [System.ChangedDate] DESC",
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
