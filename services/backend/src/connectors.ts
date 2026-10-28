import { azurePrLinks } from "./ticket-pull-requests.js";
import { azurePriorityValue, AZURE_PRIORITY_FIELD } from "./azure-priority.js";
import { commentMarkdown, commentImageType } from "./comment-markdown.js";
import { browseQuery, azureSummary, orderBrowseIds, type AzureBrowse } from "./azure-browser.js";
import { azureLookupSchema, type AzureLookup } from "./azure-ticket-consent.js";
import { changeTicketStates, type StatusChange } from "./ticket-status-batch.js";
import { changeTicketState } from "./ticket-status.js";
import { createHash, randomUUID } from "node:crypto";
import { Store, AppError, type Settings, type Context } from "./store.js";
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
  for (const match of text.matchAll(/(?<![\p{L}\p{N}_])([0-9]+)(?![\p{L}\p{N}_])/gu)) add(match[1]);
  // Inspect visible URLs and anchor destinations, but not unrelated HTML attributes.
  const links = [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)].map((m) => m[0]);
  for (const anchor of content.matchAll(/<a\b[^>]*>/gi)) {
    const href = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(anchor[0]);
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
      const code = value[0].toLowerCase() === "x" ? parseInt(value.slice(1), 16) : Number(value);
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
/** Preserve link destinations while stripping presentation-only HTML. */
export function ticketContentText(
  value: string,
  base?: string,
  rewrite: (url: string) => string = (url) => url,
) {
  const links: string[] = [];
  const url = (raw: string) => {
    try {
      const parsed = new URL(plainText(raw), base);
      return /^https?:$/.test(parsed.protocol)
        ? rewrite(parsed.href).replace(/\(/g, "%28").replace(/\)/g, "%29")
        : "";
    } catch {
      return "";
    }
  };
  const attr = (tag: string, name: string) => {
    const match = new RegExp(
      "\\s" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
      "i",
    ).exec(tag);
    return match ? (match[1] ?? match[2] ?? match[3]) : "";
  };
  const label = (text: string) => plainText(text).replace(/[[\]\\]/g, " ");
  const stash = (text: string) => {
    const key = `ORBITLINKPLACEHOLDER${links.length}END`;
    links.push(text);
    return key;
  };
  const markdown = value.replace(
    /(!?)\[([^\]\n]*)\]\((https?:[^\s)]+)\)/gi,
    (match, image, title, target) => {
      const href = url(target);
      return href ? stash(`${image}[${label(title)}](${href})`) : match;
    },
  );
  const html = markdown
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = url(attr(tag, "src"));
      return src ? stash(`![${label(attr(tag, "alt")) || "Изображение"}](${src})`) : "";
    })
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs, body) => {
      const href = url("" + attr(" " + attrs, "href"));
      return href ? stash(`[${label(body)}](${href})`) : body;
    });
  let text = plainText(html);
  for (let i = links.length - 1; i >= 0; i--)
    text = text.replaceAll(`ORBITLINKPLACEHOLDER${i}END`, links[i]);
  return text;
}
export class Connectors {
  private browseSnapshots = new Map<
    string,
    {
      source: string;
      pat: string | undefined;
      filters: string;
      ids: number[];
      expires: number;
      limited: boolean;
    }
  >();
  constructor(private store: Store) {}
  private async azure(path: string, init: RequestInit, s: Settings, pat: string | undefined) {
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
      { includeErrorMessage: path === "workitemsbatch" || path.startsWith("wiql") },
    );
  }
  private cacheTicketContent(item: any, s: Settings, complete = false) {
    this.store.cacheTicketRelations(item, this.store.source(s), azureBase(s.azureUrl));
    const fields = item.fields || {};
    const source = this.store.source(s),
      base = azureBase(s.azureUrl);
    const reference = `cache-${createHash("sha256").update(source).digest("hex").slice(0, 24)}-${item.id}`;
    const rewrite = (url: string) => {
      const u = new URL(url),
        b = new URL(base);
      const id = /\/_apis\/wit\/attachments\/([0-9a-f-]{36})(?:$|\/)/i.exec(u.pathname)?.[1];
      return id &&
        u.origin === b.origin &&
        u.pathname.startsWith(b.pathname.replace(/\/$/, "") + "/")
        ? `/api/ticket-cards/${reference}/attachments/${id.toLowerCase()}`
        : url;
    };
    const sections = {
      description: "System.Description",
      criteria: "Microsoft.VSTS.Common.AcceptanceCriteria",
      repro: "Microsoft.VSTS.TCM.ReproSteps",
    };
    const save = this.store.db.prepare(
      "INSERT INTO ticket_content_cache VALUES (?,?,?,?,?,?) ON CONFLICT(source,id,section) DO UPDATE SET body=excluded.body,search_text=excluded.search_text,updated_at=excluded.updated_at",
    );
    this.store.db.transaction(() => {
      for (const [section, field] of Object.entries(sections)) {
        if (!complete && !Object.hasOwn(fields, field)) continue;
        const body = ticketContentText(String(fields[field] || ""), base + "/", rewrite);
        save.run(
          this.store.source(s),
          item.id,
          section,
          body,
          body.toLocaleLowerCase(),
          new Date().toISOString(),
        );
      }
      const cached = this.store.db
        .prepare("SELECT body FROM ticket_content_cache WHERE source=? AND id=?")
        .all(source, item.id) as { body: string }[];
      const pattern = new RegExp(
        `/api/ticket-cards/${reference}/attachments/([0-9a-f-]{36})`,
        "gi",
      );
      const ids = new Set(
        cached.flatMap((row) =>
          [...row.body.matchAll(pattern)].map((match) => match[1].toLowerCase()),
        ),
      );
      this.store.db
        .prepare(
          "INSERT INTO ticket_cards(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(
          reference,
          JSON.stringify({
            id: item.id,
            source,
            base,
            project: s.azureProject,
            attachments: [...ids].map((id) => ({ id, name: "Вложение тикета", image: true })),
          }),
        );
    })();
  }
  private saveTicket(item: any, s: Settings) {
    this.cacheTicketContent(item, s);
    if (
      this.store.db
        .prepare("SELECT 1 FROM ticket_local WHERE source=? AND id=? AND removed=1")
        .get(this.store.source(s), item.id)
    ) {
      this.store.updateTrashFromAzure(item, this.store.source(s));
      return;
    }
    const f = item.fields || {};
    this.store.saveAzurePriority(item.id, this.store.source(s), f[AZURE_PRIORITY_FIELD]);
    const azureTags = [
      ...new Set(
        String(f["System.Tags"] || "")
          .split(";")
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ];
    this.store.db
      .prepare(
        "INSERT INTO ticket_azure_tags(source,id,tags) VALUES (?,?,?) ON CONFLICT(source,id) DO UPDATE SET tags=excluded.tags",
      )
      .run(this.store.source(s), item.id, JSON.stringify(azureTags));
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
    this.store.saveTicketCreatedAt(item.id, this.store.source(s), f["System.CreatedDate"]);
  }
  /** Persist the full work item returned by the post-write verification read. */
  private refreshTicketAfterEdit(item: any, s: Settings) {
    const source = this.store.source(s);
    this.store.db.transaction(() => {
      if (this.store.hasLocalTicket(item.id, source)) this.saveTicket(item, s);
      // A full read also clears cached sections that Azure no longer returns.
      this.cacheTicketContent(item, s, true);
      const rows = this.store.db
        .prepare(
          "SELECT id,data FROM ticket_cards WHERE json_extract(data,'$.source')=? AND json_extract(data,'$.id')=? AND json_type(data,'$.fields')='object'",
        )
        .all(source, item.id) as { id: string; data: string }[];
      for (const row of rows) {
        const card = JSON.parse(row.data);
        card.fields = item.fields;
        delete card.markdownFields;
        this.store.db
          .prepare("UPDATE ticket_cards SET data=? WHERE id=?")
          .run(JSON.stringify(card), row.id);
      }
    })();
  }
  private statusRequests = new Map<string, Promise<any>>();
  private async cachedStatusData<T>(
    kind: string,
    s: Settings,
    pat: string | undefined,
    load: () => Promise<T>,
    refresh = false,
  ): Promise<T> {
    const key =
      "azure.status-cache:" +
      createHash("sha256")
        .update(JSON.stringify([this.store.source(s), s.azureVersion, pat || "", kind]))
        .digest("hex");
    const cached = this.store.get<{ expires: number; value: T } | null>(key, null);
    if (!refresh && cached && cached.expires > Date.now()) return cached.value;
    const pending = this.statusRequests.get(key);
    if (pending) {
      if (!refresh) return pending;
      await pending.catch(() => {});
    }
    const request = load()
      .then((value) => {
        this.store.set(key, { expires: Date.now() + 30 * 86400000, value });
        return value;
      })
      .finally(() => this.statusRequests.delete(key));
    this.statusRequests.set(key, request);
    return request;
  }
  private async typeStates(
    type: string,
    s: Settings,
    pat: string | undefined,
    supplied?: any[],
    refresh = false,
  ) {
    const states = await this.cachedStatusData(
      "states:" + type,
      s,
      pat,
      async () => {
        const response = supplied
          ? { value: supplied }
          : await this.azure(`workitemtypes/${encodeURIComponent(type)}/states`, {}, s, pat);
        if (
          !Array.isArray(response.value) ||
          !response.value.length ||
          response.value.some((v: any) => typeof v.name !== "string" || !v.name)
        )
          throw new AppError(502, "Azure не вернул доступные статусы");
        return response.value.map((v: any) => v.name) as string[];
      },
      refresh,
    );
    const key = "azure.ticket-options:" + this.store.source(s);
    const catalog = this.store.get<{ name: string; states: string[] }[]>(key, []);
    this.store.set(key, [
      ...catalog.filter((entry) => entry.name !== type),
      { name: type, states },
    ]);
    return states;
  }
  private localStateItem(id: number, s: Settings) {
    const row = this.store.db
      .prepare("SELECT id,title,type,state FROM tickets WHERE source=? AND id=?")
      .get(this.store.source(s), id) as any;
    return row?.type
      ? {
          id: row.id,
          fields: {
            "System.Title": row.title,
            "System.WorkItemType": row.type,
            "System.State": row.state,
            "System.TeamProject": s.azureProject,
          },
        }
      : undefined;
  }
  async ticketStates(id: number) {
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat");
    const item = this.localStateItem(id, s) || (await this.azure(`workitems/${id}`, {}, s, pat));
    if (item.id !== id || item.fields?.["System.TeamProject"] !== s.azureProject)
      throw new AppError(400, "Тикет относится к другому проекту");
    const states = await this.typeStates(item.fields["System.WorkItemType"], s, pat);
    if (this.store.source() !== this.store.source(s))
      throw new AppError(409, "Подключение изменилось");
    return {
      source: this.store.source(s),
      title: String(item.fields["System.Title"] || ""),
      state: item.fields["System.State"],
      states,
    };
  }
  async ticketStatesBatch(ids: number[]) {
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat");
    const items = new Map<number, any>();
    for (const id of ids) {
      const item = this.localStateItem(id, s);
      if (item) items.set(id, item);
    }
    const missing = ids.filter((id) => !items.has(id));
    if (missing.length) {
      const response = await this.azure(
        "workitemsbatch",
        {
          method: "POST",
          body: JSON.stringify({
            ids: missing,
            fields: ["System.TeamProject", "System.WorkItemType", "System.State"],
          }),
        },
        s,
        pat,
      );
      for (const item of response.value || []) items.set(item.id, item);
    }
    const byType = new Map<string, string[]>();
    const results = [];
    for (const id of ids) {
      const item = items.get(id);
      if (!item || item.fields?.["System.TeamProject"] !== s.azureProject)
        throw new AppError(400, "Тикет недоступен или относится к другому проекту");
      const type = item.fields["System.WorkItemType"];
      if (!byType.has(type)) byType.set(type, await this.typeStates(type, s, pat));
      results.push({
        id,
        state: item.fields["System.State"],
        states: byType.get(type),
      });
    }
    if (this.store.source() !== this.store.source(s))
      throw new AppError(409, "Подключение изменилось");
    return { source: this.store.source(s), results };
  }
  async changeTicketStatuses(changes: StatusChange[], guard: () => void = () => {}) {
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat");
    const reference = randomUUID();
    const results = await changeTicketStates(changes, s.azureProject, {
      read: async (ids) => {
        const response = await this.azure(
          "workitemsbatch",
          {
            method: "POST",
            body: JSON.stringify({ ids, errorPolicy: "Omit" }),
          },
          s,
          pat,
        );
        if (!Array.isArray(response.value))
          throw new AppError(502, "Azure не вернул список тикетов");
        return response.value;
      },
      states: (type) => this.typeStates(type, s, pat),
      beforeWrite: () => {
        guard();
        if (this.store.source() !== this.store.source(s))
          throw new AppError(409, "Подключение Azure изменилось");
      },
      patch: (items) => {
        // Collection-level endpoint, including custom Azure Server collection paths.
        const url = `${azureBase(s.azureUrl)}/_apis/wit/$batch?api-version=${encodeURIComponent(s.azureVersion)}`;
        return requestJson(
          url,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              items.map((item) => ({
                method: "PATCH",
                uri: `/_apis/wit/workitems/${item.id}?api-version=${encodeURIComponent(s.azureVersion)}`,
                headers: { "Content-Type": "application/json-patch+json" },
                body: [
                  { op: "test", path: "/rev", value: item.revision },
                  {
                    op: "add",
                    path: "/fields/System.State",
                    value: item.state,
                  },
                ],
              })),
            ),
          },
          "Azure DevOps",
        );
      },
    });
    return results.map(({ item, ...receipt }) => {
      if (receipt.success && item) this.refreshTicketAfterEdit(item, s);
      this.store.audit(
        receipt.success ? "ticket.state.verified" : "ticket.state.unconfirmed",
        JSON.stringify({ ...receipt, reference, source: this.store.source(s) }),
      );
      if (!receipt.success)
        console.error("[ticket-state-batch]", JSON.stringify({ ...receipt, reference }));
      return { ...receipt, reference };
    });
  }
  async changeTicketStatus(id: number, state: string, guard: () => void = () => {}) {
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat");
    const reference = randomUUID();
    let stage = "read_initial";
    let reads = 0;
    const log = (outcome: string, error?: unknown) =>
      console.error(
        "[ticket-state]",
        JSON.stringify({
          reference,
          id,
          stage,
          outcome,
          code: error instanceof AppError ? error.status : undefined,
          message:
            error instanceof AppError ? error.message : error ? "Unexpected error" : undefined,
        }),
      );
    try {
      const result = await changeTicketState(id, state, s.azureProject, {
        read: () => {
          stage = ++reads === 1 ? "read_initial" : "verify";
          return this.azure(`workitems/${id}`, {}, s, pat);
        },
        states: async (type) => {
          stage = "load_states";
          return this.typeStates(type, s, pat);
        },
        beforeWrite: () => {
          stage = "before_write";
          guard();
          if (this.store.source() !== this.store.source(s))
            throw new AppError(409, "Подключение Azure изменилось, запись отменена");
        },
        patch: async (revision, target) => {
          stage = "patch";
          try {
            return await this.azure(
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
            );
          } catch (error) {
            log("patch_failed", error);
            throw error;
          }
        },
      });
      this.refreshTicketAfterEdit(result.item, s);
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
      log(result.outcome);
      return receipt;
    } catch (e) {
      log("unconfirmed", e);
      this.store.audit(
        "ticket.state.unconfirmed",
        JSON.stringify({ id, requested: state, source: this.store.source(s) }),
      );
      throw e;
    }
  }
  async developers(query: string, context?: { client: string; project: string }) {
    query = query.trim();
    if (
      query.length < 2 ||
      query.length > 100 ||
      !/[\p{L}\p{N}]{2}/u.test(query) ||
      /[*?]/.test(query)
    )
      throw new AppError(400, "Введите минимум два символа имени или email без * и ?");
    const s = this.store.settings(context),
      source = this.store.source(s),
      pat = this.store.secret("azure.pat");
    if (!pat || !s.azureProject) throw new AppError(400, "Настройте Azure DevOps");
    let base = azureBase(s.azureUrl);
    const url = new URL(base);
    if (url.hostname === "dev.azure.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length !== 1)
        throw new AppError(400, "Для Azure Services укажите URL организации без проекта");
      base = `https://vssps.dev.azure.com/${parts[0]}`;
    } else if (/^[a-z0-9-]+\.visualstudio\.com$/i.test(url.hostname)) {
      base = `https://vssps.dev.azure.com/${url.hostname.split(".")[0]}`;
    }
    const params = new URLSearchParams({
      searchFilter: "General",
      filterValue: query,
      queryMembership: "None",
      "api-version": s.azureVersion,
    });
    const searchIdentities = () =>
      requestJson(
        `${base}/_apis/identities?${params}`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(":" + pat).toString("base64")}`,
          },
        },
        "Azure поиск пользователей (PAT: Identity Read)",
      );
    let response = await searchIdentities();
    if (!Array.isArray(response.value))
      throw new AppError(502, "Azure вернул неверный список пользователей");
    // Some directories resolve account names via General but need an explicit
    // display-name/mail lookup. Keep the fallback bounded; never enumerate users.
    if (!response.value.some((u: any) => u.id && !u.isContainer && u.isActive !== false)) {
      params.set("searchFilter", query.includes("@") ? "MailAddress" : "DisplayName");
      response = await searchIdentities();
      if (!Array.isArray(response.value))
        throw new AppError(502, "Azure вернул неверный список пользователей");
    }
    const isUser = (u: any) => u.id && !u.isContainer && u.isActive !== false;
    let searchFailure = "";
    let graphStage = "поиск по части имени";
    let graphTruncated = false;
    if (!response.value.some(isUser)) {
      try {
        const graph = await requestJson(
          `${base}/_apis/graph/subjectquery?api-version=7.1-preview.1`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(":" + pat).toString("base64")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ query, subjectKind: ["User"] }),
          },
          "Azure поиск по части имени (PAT: Graph Read)",
        );
        if (!Array.isArray(graph.value))
          throw new AppError(502, "Azure вернул неверный результат поиска Graph");
        const subjects = [
          ...new Set<string>(
            graph.value
              .filter(
                (u: any) =>
                  String(u.subjectKind).toLowerCase() === "user" &&
                  typeof u.descriptor === "string",
              )
              .map((u: any) => u.descriptor),
          ),
        ];
        graphTruncated = subjects.length > 20 || graph.value.length >= 100;
        if (subjects.length) {
          // Resolve Graph descriptors to Azure identity IDs in one bounded call.
          // originId is an Entra ID, not the ID used by System.AssignedTo.
          const lookup = new URLSearchParams({
            subjectDescriptors: subjects.slice(0, 20).join(","),
            queryMembership: "None",
            "api-version": s.azureVersion,
          });
          graphStage = "сопоставление пользователей";
          const resolved = await requestJson(
            `${base}/_apis/identities?${lookup}`,
            {
              headers: {
                Authorization: `Basic ${Buffer.from(":" + pat).toString("base64")}`,
              },
            },
            "Azure сопоставление пользователей (PAT: Identity Read)",
          );
          if (!Array.isArray(resolved.value))
            throw new AppError(502, "Azure вернул неверный список пользователей");
          response = resolved;
        }
      } catch (error) {
        const status = (error as { upstreamStatus?: number })?.upstreamStatus;
        const reason =
          status === 401 || status === 403
            ? `сервер отклонил доступ (HTTP ${status}); это не обязательно отсутствие Graph: Read у PAT`
            : status === 404
              ? "API по настроенному адресу не найден (HTTP 404)"
              : status === 429
                ? "Azure ограничил частоту запросов (HTTP 429)"
                : "запрос не выполнен; подробности в логах сервера";
        searchFailure = `Azure: ${graphStage} — ${reason}.`;
      }
    }
    const matches = response.value.filter(isUser);
    const remoteUsers = matches.map((u: any) => ({
      id: String(u.id),
      name: String(
        u.customDisplayName || u.providerDisplayName || u.properties?.Account?.$value || u.id,
      ),
      email: String(u.properties?.Mail?.$value || u.properties?.Account?.$value || ""),
    }));
    if (
      source !== this.store.source(this.store.settings(context)) ||
      pat !== this.store.secret("azure.pat")
    )
      throw new AppError(409, "Подключение изменилось; повторите поиск");
    const old = this.store.get<{ id: string; name: string; email?: string }[]>(
      "developers:" + source,
      [],
    );
    const normalize = (text: string) =>
      text.normalize("NFKC").toLocaleLowerCase().replace(/ё/g, "е").trim();
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    const returnedIds = new Set(response.value.map((u: any) => String(u.id)));
    const cachedMatches = old.filter(
      (u) =>
        !returnedIds.has(u.id) &&
        terms.every((term) => normalize(`${u.name} ${u.email || ""}`).includes(term)),
    );
    const results = [
      ...new Map<string, { id: string; name: string; email?: string }>(
        [...remoteUsers, ...cachedMatches].map((u) => [u.id, u]),
      ).values(),
    ];
    const users = results.slice(0, 20);
    const merged = new Map<string, { id: string; name: string; email?: string }>();
    for (const user of [...users, ...old.filter((u) => !returnedIds.has(u.id))])
      if (!merged.has(user.id)) merged.set(user.id, user);
    this.store.set("developers:" + source, [...merged.values()].slice(0, 1000));
    const warning = searchFailure
      ? `${
          users.length
            ? "Показаны ранее найденные пользователи из локального кэша. Список может быть неполным."
            : "Пользователи не найдены в локальном кэше, а онлайн-поиск не завершён. Попробуйте полное имя или e-mail."
        } ${searchFailure}`
      : "";
    return { users, truncated: graphTruncated || results.length > 20, warning };
  }
  async assignTicket(id: number, source: string, userId: string | null) {
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat");
    const guard = () => {
      if (source !== this.store.source() || pat !== this.store.secret("azure.pat"))
        throw new AppError(409, "Подключение Azure изменилось. Откройте выбор исполнителя заново.");
    };
    guard();
    const users = this.store.get<any[]>("developers:" + source, []);
    const recentKey = "azure.assignees.recent:" + source;
    const recent = this.store.get<{ id: string; name: string; email: string }[]>(recentKey, []);
    const user = userId ? [...users, ...recent].find((p) => p.id === userId) : null;
    if (userId && !user?.email)
      throw new AppError(
        400,
        "Найдите пользователя через поиск Azure: нужен email или уникальный аккаунт.",
      );
    const read = async () => {
      const item = await this.azure(`workitems/${id}`, {}, s, pat);
      if (item.id !== id || item.fields?.["System.TeamProject"] !== s.azureProject)
        throw new AppError(400, "Тикет относится к другому проекту Azure");
      return item;
    };
    const before = await read();
    if (!Number.isSafeInteger(before.rev))
      throw new AppError(502, "Azure не вернул ревизию тикета");
    guard();
    let failure: unknown;
    try {
      await this.azure(
        `workitems/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json-patch+json" },
          body: JSON.stringify([
            { op: "test", path: "/rev", value: before.rev },
            {
              op: "add",
              path: "/fields/System.AssignedTo",
              value: user?.email || "",
            },
          ]),
        },
        s,
        pat,
      );
    } catch (e) {
      failure = e;
    }
    let after: any;
    try {
      after = await read();
    } catch {
      throw new AppError(
        502,
        "Не удалось проверить исполнителя после записи. Изменение могло выполниться; обновите тикет перед повторной попыткой.",
      );
    }
    guard();
    const actual = after.fields["System.AssignedTo"];
    const confirmed = user
      ? String(actual?.id || "").toLowerCase() === user.id.toLowerCase() ||
        String(typeof actual === "string" ? actual : actual?.uniqueName || "").toLowerCase() ===
          user.email.toLowerCase()
      : !actual;
    if (!confirmed)
      throw new AppError(
        409,
        `Изменение исполнителя не подтверждено. ${failure instanceof Error ? failure.message : "Azure вернул другого исполнителя; проверьте права и правила проекта."}`,
      );
    this.refreshTicketAfterEdit(after, s);
    this.store.audit("ticket.assigned", `#${id}: ${user?.name || "Не назначен"}`);
    if (user) {
      // Store only assignments confirmed by the read-back, never mere selections.
      const person = {
        id: user.id,
        name: actual?.displayName || user.name,
        email: actual?.uniqueName || user.email,
      };
      const latest = this.store.get<typeof recent>(recentKey, []);
      this.store.set(recentKey, [person, ...latest.filter((p) => p.id !== person.id)].slice(0, 8));
    }
    return { id, source, assigned: actual || null, verified: true };
  }
  async ticketOptions(refresh = false, context?: Context) {
    const s = this.store.settings(context),
      pat = this.store.secret("azure.pat");
    const options = await this.cachedStatusData(
      "catalog",
      s,
      pat,
      async () => {
        const result = await this.azure("workitemtypes", {}, s, pat);
        if (!Array.isArray(result.value) || !result.value.length)
          throw new AppError(502, "Azure не вернул типы задач");
        const options: { name: string; states: string[] }[] = [];
        for (const type of result.value) {
          options.push({
            name: type.name,
            states: await this.typeStates(type.name, s, pat, type.states, refresh),
          });
        }
        return options;
      },
      refresh,
    );
    const updated = await Promise.all(
      options.map(async (type) => ({
        name: type.name,
        states: await this.typeStates(type.name, s, pat),
      })),
    );
    this.store.set("azure.ticket-options:" + this.store.source(s), updated);
    return updated;
  }
  async ticketSummary(id: number) {
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat");
    const fields = [
      "System.Id",
      "System.TeamProject",
      "System.Title",
      "System.WorkItemType",
      "System.State",
      "System.AssignedTo",
      "System.CreatedDate",
      "System.ChangedDate",
    ];
    const item = await this.azure(`workitems/${id}?fields=${fields.join(",")}`, {}, s, pat);
    if (item.id !== id || item.fields?.["System.TeamProject"] !== s.azureProject)
      throw new AppError(400, "Номер или проект тикета не соответствует запросу");
    if (this.store.source(s) !== this.store.source())
      throw new AppError(409, "Подключение Azure изменилось");
    const f = item.fields;
    const assigned = f["System.AssignedTo"];
    return {
      id,
      source: this.store.source(s),
      created_at: f["System.CreatedDate"] || null,
      changed_at: f["System.ChangedDate"] || null,
      title: f["System.Title"] || "",
      type: f["System.WorkItemType"] || "",
      state: f["System.State"] || "",
      assigned: typeof assigned === "string" ? assigned : assigned?.displayName || "",
    };
  }

  private cachedTicketDetails(id: number, s: Settings) {
    const source = this.store.source(s),
      base = azureBase(s.azureUrl);
    this.store.purgeTicketTrash();
    const saved = this.store.db
      .prepare(
        "SELECT data FROM ticket_cards WHERE json_extract(data,'$.source')=? AND json_extract(data,'$.id')=? AND json_type(data,'$.fields')='object' AND json_extract(data,'$.cacheFallback') IS NULL ORDER BY json_extract(data,'$.loadedAt') DESC,rowid DESC LIMIT 1",
      )
      .get(source, id) as { data: string } | undefined;
    const snapshot = saved ? JSON.parse(saved.data) : null;
    const sections = this.store.db
      .prepare("SELECT section,body,updated_at FROM ticket_content_cache WHERE source=? AND id=?")
      .all(source, id) as { section: string; body: string; updated_at: string }[];
    const local = this.store.db
      .prepare("SELECT * FROM tickets WHERE source=? AND id=?")
      .get(source, id) as any;
    const trash = !local
      ? (this.store.db
          .prepare("SELECT body FROM ticket_trash WHERE source=? AND id=?")
          .get(source, id) as { body: string } | undefined)
      : undefined;
    const summary = local || (trash ? JSON.parse(trash.body) : null);
    if (!snapshot && !sections.length && !summary) return undefined;
    const fields = { ...snapshot?.fields };
    if (summary && (!snapshot || summary.synced_at >= snapshot.loadedAt)) {
      for (const [key, field] of Object.entries({
        title: "System.Title",
        state: "System.State",
        type: "System.WorkItemType",
        assigned: "System.AssignedTo",
        changed_at: "System.ChangedDate",
      }))
        fields[field] = summary[key];
      fields["System.CreatedDate"] = this.store.ticketCreatedAt(id, source);
      fields[AZURE_PRIORITY_FIELD] = this.store.azurePriority(id, source);
      fields["System.Tags"] = this.store.azureTags(id, source).join("; ");
    }
    fields["System.Title"] ||= `Тикет #${id}`;
    const attachments = [...(snapshot?.attachments || [])];
    const markdownFields: string[] = [];
    const sectionFields: Record<string, string> = {
      description: "System.Description",
      criteria: "Microsoft.VSTS.Common.AcceptanceCriteria",
      repro: "Microsoft.VSTS.TCM.ReproSteps",
    };
    for (const section of sections) {
      const field = sectionFields[section.section];
      if (!field || (snapshot && section.updated_at <= snapshot.loadedAt)) continue;
      fields[field] = section.body.replace(
        /\/api\/ticket-cards\/cache-[a-f0-9]+-\d+\/attachments\/([a-f0-9-]{36})/gi,
        (_match, attachmentId: string) => {
          if (!attachments.some((a: any) => a.id === attachmentId))
            attachments.push({ id: attachmentId, name: "Изображение в тексте", image: true });
          return `${base}/${encodeURIComponent(s.azureProject)}/_apis/wit/attachments/${attachmentId}`;
        },
      );
      markdownFields.push(field);
    }
    const savedAt =
      [snapshot?.loadedAt, summary?.synced_at, ...sections.map((section) => section.updated_at)]
        .filter((value) => value && Number.isFinite(Date.parse(value)))
        .sort()
        .at(-1) || null;
    const cachedComments: {
      id: number;
      author: string;
      date: string;
      text: string;
      richText: string;
    }[] = snapshot?.comments || [];
    const card = {
      id,
      source,
      base,
      project: s.azureProject,
      fields,
      markdownFields,
      comments: cachedComments,
      azurePullRequests: snapshot?.azurePullRequests,
      attachments,
      warnings: [
        ...(snapshot?.warnings || []),
        ...(!snapshot ? ["Комментарии и полный список вложений не сохранены в кэше."] : []),
      ],
      loadedAt: savedAt,
      url: snapshot?.url || `${base}/${encodeURIComponent(s.azureProject)}/_workitems/edit/${id}`,
      cacheFallback: { savedAt },
    };
    const cardId = randomUUID();
    this.store.db
      .prepare("INSERT INTO ticket_cards VALUES (?,?)")
      .run(cardId, JSON.stringify(card));
    return { cardId, ...card };
  }
  async ticketDetails(id: number, allowCachedFallback = false) {
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat");
    let item: any;
    try {
      item = await this.azure(`workitems/${id}?$expand=all`, {}, s, pat);
    } catch (error) {
      if (this.store.source() !== this.store.source(s))
        throw new AppError(409, "Подключение Azure изменилось");
      if (allowCachedFallback) {
        const cached = this.cachedTicketDetails(id, s);
        if (cached) return cached;
      }
      throw error;
    }
    if (this.store.source() !== this.store.source(s))
      throw new AppError(409, "Подключение Azure изменилось");
    if (item.id !== id || item.fields?.["System.TeamProject"] !== s.azureProject)
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
            azureVersion: s.azureVersion.startsWith("7.0") ? "7.0-preview.3" : "7.1-preview.4",
          },
          pat,
        );
        if (!Array.isArray(page.comments))
          throw new AppError(502, "Некорректный ответ Comments API");
        comments.push(...page.comments);
        continuation = page.continuationToken || "";
        if (continuation && (seen.has(continuation) || comments.length >= 10000)) {
          warnings.push("Комментарии загружены не полностью: достигнут защитный лимит");
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
        const match = /\/_apis\/wit\/attachments\/([0-9a-f-]{36})(?:$|\/)/i.exec(u.pathname);
        if (
          u.origin !== b.origin ||
          !u.pathname.startsWith(b.pathname.replace(/\/$/, "") + "/") ||
          !match
        )
          return;
        const attachmentId = match[1].toLowerCase();
        if (!attachments.some((a) => a.id === attachmentId))
          attachments.push({
            id: attachmentId,
            name,
            image: image || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name),
          });
        else if (image) attachments.find((a) => a.id === attachmentId)!.image = true;
      } catch {}
    };
    for (const relation of item.relations || [])
      if (relation.rel === "AttachedFile")
        add(relation.url, relation.attributes?.name || "Вложение");
    const content = [
      ...Object.values(item.fields || {}).filter((v) => typeof v === "string"),
      ...comments.map((c) => c.renderedText || c.text || ""),
    ].join("\n");
    for (const imageTag of content.matchAll(/<img\b[^>]*>/gi)) {
      const source = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(imageTag[0]);
      if (source)
        add(
          (source[1] ?? source[2] ?? source[3]).replace(/&amp;/gi, "&"),
          "Изображение в тексте",
          true,
        );
    }
    for (const match of content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g))
      add(match[1], "Изображение в комментарии", true);
    if (this.store.hasLocalTicket(id, this.store.source(s))) {
      this.store.db.transaction(() => {
        this.saveTicket(item, s);
        this.cacheTicketContent(item, s, true);
      })();
    }
    this.store.cacheTicketRelations(item, this.store.source(s), base, true);
    const cardId = randomUUID();
    const card = {
      id,
      source: this.store.source(s),
      base,
      project: s.azureProject,
      fields: item.fields,
      azurePullRequests: azurePrLinks(item.relations || []),
      comments: comments.map((c) => ({
        id: c.id,
        author: c.createdBy?.displayName || "",
        date: c.createdDate,
        text: plainText(c.renderedText || c.text || ""),
        richText: c.renderedText || c.text || "",
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
  async uploadCommentImage(ref: string, bytes: Buffer, name: string, uploadId: string) {
    const card = this.ticketCard(ref),
      s = this.store.settings(),
      source = this.store.source(s);
    if (card.source !== source)
      throw new AppError(409, "Подключение Azure изменилось: загрузите тикет заново");
    const type = commentImageType(bytes);
    const key = `ticket.comment-upload:${source}:${card.id}:${uploadId}`;
    const hash = createHash("sha256").update(bytes).digest("hex");
    const previous = this.store.get<any>(key, null);
    if (previous) {
      if (previous.hash !== hash)
        throw new AppError(409, "Изображение изменилось. Добавьте его заново.");
      return previous.image;
    }
    await this.ticketSummary(card.id);
    if (source !== this.store.source())
      throw new AppError(409, "Подключение Azure изменилось: загрузите тикет заново");
    // eslint-disable-next-line no-control-regex -- Remove control bytes from untrusted input/output.
    const safeName = name.replace(/[\\/<>\x00-\x1f]/g, "_").slice(0, 150) || "image";
    const result = await this.azure(
      `attachments?fileName=${encodeURIComponent(safeName)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(bytes),
      },
      s,
      this.store.secret("azure.pat"),
    );
    const id = String(result.id || "").toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
      throw new AppError(502, "Azure не вернул ссылку на изображение. Повторите загрузку.");
    // Construct a trusted URL; never forward a server-supplied arbitrary URL with credentials.
    const url = `${azureBase(s.azureUrl)}/${encodeURIComponent(s.azureProject)}/_apis/wit/attachments/${id}?fileName=${encodeURIComponent(safeName)}`;
    const image = { id, url, name: safeName, image: true, type };
    this.store.set(key, { hash, image });
    return image;
  }
  async addTicketComment(
    ref: string,
    text: string,
    options: { markdown?: boolean; imageUploads?: string[]; requestId?: string } = {},
  ) {
    const card = this.ticketCard(ref);
    const s = this.store.settings();
    const source = this.store.source(s);
    if (card.source !== source)
      throw new AppError(409, "Подключение Azure изменилось: загрузите тикет заново");
    text = text.trim();
    if (!text || text.length > 10000)
      throw new AppError(400, "Комментарий должен содержать от 1 до 10000 символов");
    const receiptKey = options.requestId
      ? `ticket.comment-receipt:${source}:${card.id}:${options.requestId}`
      : undefined;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({ text, markdown: !!options.markdown, images: options.imageUploads || [] }),
      )
      .digest("hex");
    const receipt = receiptKey ? this.store.get<any>(receiptKey, null) : null;
    if (receipt) {
      if (receipt.fingerprint !== fingerprint)
        throw new AppError(409, "Черновик изменился. Повторите отправку с новым идентификатором.");
      return receipt.result;
    }
    const images = (options.imageUploads || []).map((uploadId) => {
      const stored = this.store.get<any>(
        `ticket.comment-upload:${source}:${card.id}:${uploadId}`,
        null,
      );
      if (!stored) throw new AppError(400, "Не найдена загруженная картинка. Добавьте её заново.");
      return stored.image;
    });
    // Check the current project before writing, including for old cached cards.
    await this.ticketSummary(card.id);
    if (source !== this.store.source())
      throw new AppError(409, "Подключение Azure изменилось: загрузите тикет заново");
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/\r\n?|\n/g, "<br>");
    const html = options.markdown ? await commentMarkdown(text) : `<p>${escaped}</p>`;
    const result = await this.azure(
      `workitems/${card.id}/comments?format=html`,
      { method: "POST", body: JSON.stringify({ text: html }) },
      {
        ...s,
        azureVersion: s.azureVersion.startsWith("7.0") ? "7.0-preview.3" : "7.1-preview.4",
      },
      this.store.secret("azure.pat"),
    );
    if (!Number.isInteger(result.id) || result.id <= 0)
      throw new AppError(
        502,
        "Azure не вернул номер комментария. Проверьте тикет в Azure перед повторной отправкой.",
      );
    const comment = {
      id: result.id,
      author: result.createdBy?.displayName || "",
      date: result.createdDate,
      text,
      richText: html,
    };
    const response = { id: card.id, source, comment, attachments: images };
    if (receiptKey) this.store.set(receiptKey, { fingerprint, result: response });
    // Keep all open/saved cards consistent without refetching the full ticket.
    this.store.db.transaction(() => {
      const rows = this.store.db.prepare("SELECT id,data FROM ticket_cards").all() as {
        id: string;
        data: string;
      }[];
      for (const row of rows) {
        const saved = JSON.parse(row.data);
        if (saved.id !== card.id || saved.source !== source) continue;
        saved.attachments = [
          ...new Map(
            [...(saved.attachments || []), ...images].map((image: any) => [image.id, image]),
          ).values(),
        ];
        saved.comments = [
          ...(saved.comments || []).filter((c: any) => c.id !== comment.id),
          comment,
        ];
        this.store.db
          .prepare("UPDATE ticket_cards SET data=? WHERE id=?")
          .run(JSON.stringify(saved), row.id);
      }
    })();
    this.store.audit("ticket.comment.added", `${card.id}: ${comment.id}`);
    return response;
  }
  async ticketHistory(ref: string, skip = 0) {
    if (!Number.isSafeInteger(skip) || skip < 0)
      throw new AppError(400, "Некорректная страница истории");
    const card = this.ticketCard(ref);
    const settings = this.store.settings();
    const source = this.store.source(settings);
    if (card.source !== source)
      throw new AppError(409, "Подключение Azure изменилось: загрузите тикет заново");
    const pat = this.store.secret("azure.pat");
    const assertCurrent = () => {
      if (this.store.source() !== source || this.store.secret("azure.pat") !== pat)
        throw new AppError(409, "Подключение Azure изменилось: загрузите тикет заново");
    };
    // Capture the upper revision once; subsequent pages walk backwards from it.
    let end = skip;
    if (!end) {
      const latest = await this.azure(`workitems/${card.id}?$fields=System.Id`, {}, settings, pat);
      assertCurrent();
      if (latest.id !== card.id || !Number.isSafeInteger(latest.rev) || latest.rev < 1)
        throw new AppError(502, "Azure не вернул версию тикета для истории");
      end = latest.rev;
    }
    const start = Math.max(0, end - 20);
    const page = await this.azure(
      `workitems/${card.id}/updates?$top=${end - start}&$skip=${start}`,
      {},
      settings,
      pat,
    );
    assertCurrent();
    if (!Array.isArray(page.value) || page.value.some((row: any) => !Number.isSafeInteger(row?.id)))
      throw new AppError(502, "Некорректный ответ истории Azure");
    const items = page.value
      .slice(0, end - start)
      .reverse()
      .map((row: any) => ({
        id: row.id,
        revision: row.rev,
        author: row.revisedBy?.displayName || row.revisedBy?.name || "Автор не указан",
        date: row.fields?.["System.ChangedDate"]?.newValue || row.revisedDate,
        fields: row.fields || {},
        relations: row.relations || {},
      }));
    return { items, nextSkip: start > 0 ? start : null };
  }
  async relatedTickets(ref: string) {
    const card = this.ticketCard(ref);
    const settings = this.store.settings(),
      pat = this.store.secret("azure.pat");
    const source = this.store.source(settings);
    const check = () => {
      if (
        card.source !== source ||
        source !== this.store.source() ||
        pat !== this.store.secret("azure.pat")
      )
        throw new AppError(409, "Подключение Azure изменилось. Откройте тикет заново.");
    };
    check();
    const item = await this.azure(`workitems/${card.id}?$expand=relations`, {}, settings, pat);
    check();
    if (item.id !== card.id || !Array.isArray(item.relations ?? []))
      throw new AppError(502, "Azure не вернул связи тикета");
    this.store.cacheTicketRelations(item, source, azureBase(settings.azureUrl), true);
    const labels: Record<string, string> = {
      "System.LinkTypes.Hierarchy-Reverse": "Родитель",
      "System.LinkTypes.Hierarchy-Forward": "Дочерний",
      "System.LinkTypes.Related": "Связанный",
      "System.LinkTypes.Dependency-Forward": "Последователь",
      "System.LinkTypes.Dependency-Reverse": "Предшественник",
      "System.LinkTypes.Duplicate-Forward": "Дубликат",
      "System.LinkTypes.Duplicate-Reverse": "Дубликат для",
    };
    const links = new Map<string, { id: number; relation: string }>();
    for (const relation of item.relations || []) {
      if (
        typeof relation?.rel !== "string" ||
        !relation.rel.includes("LinkTypes.") ||
        typeof relation.url !== "string"
      )
        continue;
      // Extract IDs only; never fetch arbitrary relation URLs with the PAT.
      const match = /\/_apis\/wit\/workitems\/([1-9]\d*)$/i.exec(relation.url);
      if (!match || !relation.url.startsWith(azureBase(settings.azureUrl) + "/")) continue;
      const id = Number(match[1]);
      if (!Number.isSafeInteger(id)) continue;
      links.set(id + ":" + relation.rel, {
        id,
        relation: labels[relation.rel] || relation.attributes?.name || relation.rel,
      });
    }
    const ids = [...new Set([...links.values()].map((link) => link.id))];
    const details = new Map<number, any>();
    for (let start = 0; start < ids.length; start += 200) {
      const batch = await this.azure(
        "workitemsbatch",
        {
          method: "POST",
          body: JSON.stringify({
            ids: ids.slice(start, start + 200),
            fields: [
              "System.Title",
              "System.WorkItemType",
              "System.State",
              "System.TeamProject",
              "System.AssignedTo",
            ],
            errorPolicy: "Omit",
          }),
        },
        settings,
        pat,
      );
      check();
      if (!Array.isArray(batch.value)) throw new AppError(502, "Azure не вернул связанные тикеты");
      for (const ticket of batch.value) details.set(ticket.id, ticket.fields || {});
    }
    return {
      source,
      items: [...links.values()].map((link) => {
        const fields = details.get(link.id);
        const assigned = fields?.["System.AssignedTo"];
        return {
          ...link,
          assigned: typeof assigned === "string" ? assigned : assigned?.displayName || "",
          title: fields?.["System.Title"] || "",
          type: fields?.["System.WorkItemType"] || "",
          state: fields?.["System.State"] || "",
          project: fields?.["System.TeamProject"] || "",
          canOpen: !!fields && fields["System.TeamProject"] === settings.azureProject,
          unavailable: !fields,
        };
      }),
    };
  }

  ticketCard(ref: string) {
    const row = this.store.db.prepare("SELECT data FROM ticket_cards WHERE id=?").get(ref) as
      { data: string } | undefined;
    if (!row) throw new AppError(404, "Карточка не найдена");
    return JSON.parse(row.data);
  }
  async attachment(ref: string, id: string) {
    const card = this.ticketCard(ref);
    const attachment = card.attachments.find((a: any) => a.id === id);
    if (!attachment) throw new AppError(404, "Вложение не найдено в тикете");
    const s = this.store.settings();
    if (card.source !== this.store.source(s))
      throw new AppError(409, "Подключение Azure изменилось: загрузите тикет заново");
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
    if (!response.ok || !response.body) throw new AppError(502, "Не удалось загрузить вложение");
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
    const raw = body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? "image/png"
      : body[0] === 255 && body[1] === 216 && body[2] === 255
        ? "image/jpeg"
        : body.subarray(0, 3).toString() === "GIF"
          ? "image/gif"
          : body.subarray(0, 4).toString() === "RIFF" && body.subarray(8, 12).toString() === "WEBP"
            ? "image/webp"
            : "application/octet-stream";
    const type = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"].includes(raw)
      ? raw
      : "application/octet-stream";
    return { body, type, name: attachment.name };
  }
  // Read-only Azure batch API (POST is its read protocol); persistence is local SQLite only.
  async importPrTickets(ids: number[]) {
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat");
    const missing = [...new Set(ids)].filter(
      (id) =>
        !this.store.db
          .prepare(
            "SELECT 1 FROM tickets WHERE source=? AND id=? UNION SELECT 1 FROM ticket_local WHERE source=? AND id=? AND removed=1",
          )
          .get(this.store.source(s), id, this.store.source(s), id),
    );
    if (missing.length > 500)
      throw new AppError(400, "В описаниях PR более 500 новых тикетов: сузьте выборку PR.");
    for (let i = 0; i < missing.length; i += 200) {
      const batch = missing.slice(i, i + 200);
      const result = await this.azure(
        "workitemsbatch",
        {
          method: "POST",
          body: JSON.stringify({ ids: batch, $expand: "relations", errorPolicy: "Omit" }),
        },
        s,
        pat,
      );
      if (this.store.source() !== this.store.source(s) || this.store.secret("azure.pat") !== pat)
        throw new AppError(409, "Подключение Azure изменилось во время импорта");
      if (!Array.isArray(result.value))
        throw new AppError(502, "Azure вернул неверный список тикетов");
      for (const item of result.value) {
        if (batch.includes(item.id) && item.fields?.["System.TeamProject"] === s.azureProject) {
          this.store.cacheTicketRelations(item, this.store.source(s), azureBase(s.azureUrl), true);
          this.saveTicket(item, s);
        }
      }
    }
  }
  async browseAzureTickets(input: AzureBrowse, local: any[]) {
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat"),
      source = this.store.source(s);
    const check = () => {
      if (
        input.source !== source ||
        source !== this.store.source() ||
        pat !== this.store.secret("azure.pat")
      )
        throw new AppError(409, "Подключение Azure изменилось. Повторите поиск.");
    };
    check();
    const { page, snapshot: requestedSnapshot, ...filters } = input;
    const filterKey = JSON.stringify(filters);
    const now = Date.now();
    for (const [key, value] of this.browseSnapshots)
      if (value.expires <= now) this.browseSnapshots.delete(key);
    let snapshot = requestedSnapshot;
    let entry = snapshot ? this.browseSnapshots.get(snapshot) : undefined;
    if (
      snapshot &&
      (!entry || entry.source !== source || entry.pat !== pat || entry.filters !== filterKey)
    )
      throw new AppError(
        409,
        "Результаты поиска устарели. Нажмите «Найти», чтобы обновить список страниц.",
      );
    if (!entry) {
      const query = browseQuery(input, local);
      const found = query
        ? await this.azure(
            "wiql?$top=20000",
            { method: "POST", body: JSON.stringify({ query }) },
            s,
            pat,
          )
        : { workItems: [] };
      check();
      if (!Array.isArray(found.workItems))
        throw new AppError(502, "Azure не вернул список тикетов");
      const allIds: number[] = found.workItems.map((v: any) => v.id);
      if (allIds.some((id) => !Number.isSafeInteger(id) || id <= 0))
        throw new AppError(502, "Некорректные номера тикетов Azure");
      entry = {
        source,
        pat,
        filters: filterKey,
        ids: orderBrowseIds(allIds.slice(0, 20000), input.sort, local),
        expires: now + 15 * 60 * 1000,
        limited: allIds.length >= 20000,
      };
      while (this.browseSnapshots.size >= 10)
        this.browseSnapshots.delete(this.browseSnapshots.keys().next().value!);
      snapshot = randomUUID();
      this.browseSnapshots.set(snapshot, entry);
    }
    const total = entry.ids.length;
    const totalPages = Math.max(1, Math.ceil(total / 50));
    const currentPage = Math.min(page, totalPages);
    const pagination = { snapshot, total, totalPages, page: currentPage, limited: entry.limited };
    const ids = entry.ids.slice((currentPage - 1) * 50, currentPage * 50);
    if (!ids.length) return { tickets: [], ...pagination };
    const result = await this.azure(
      "workitemsbatch",
      {
        method: "POST",
        body: JSON.stringify({
          ids,
          $expand: "relations",
          errorPolicy: "Omit",
        }),
      },
      s,
      pat,
    );
    check();
    if (!Array.isArray(result.value)) throw new AppError(502, "Azure не вернул данные тикетов");
    const tickets = result.value
      .filter(
        (item: any) =>
          ids.includes(item.id) && item.fields?.["System.TeamProject"] === s.azureProject,
      )
      .map((item: any) => {
        this.store.cacheTicketRelations(item, source, azureBase(s.azureUrl), true);
        return {
          ...azureSummary(item, source, azureBase(s.azureUrl), s.azureProject),
          ...this.store.ticketRelations(item.id, source),
        };
      })
      .sort((a: any, b: any) => ids.indexOf(a.id) - ids.indexOf(b.id));
    return {
      tickets,
      ...pagination,
    };
  }
  async importAzureSelection(ids: number[], source: string) {
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat");
    const check = () => {
      if (
        source !== this.store.source(s) ||
        source !== this.store.source() ||
        pat !== this.store.secret("azure.pat")
      )
        throw new AppError(409, "Подключение Azure изменилось. Повторите импорт.");
    };
    check();
    const missing = [...new Set(ids)].filter(
      (id) =>
        !this.store.db.prepare("SELECT 1 FROM tickets WHERE source=? AND id=?").get(source, id),
    );
    if (!missing.length) return { added: [], missing: [] };
    const response = await this.azure(
      "workitemsbatch",
      {
        method: "POST",
        body: JSON.stringify({
          ids: missing,
          $expand: "relations",
          errorPolicy: "Omit",
        }),
      },
      s,
      pat,
    );
    check();
    if (!Array.isArray(response.value)) throw new AppError(502, "Azure не вернул данные тикетов");
    const added: number[] = [];
    this.store.db.transaction(() => {
      for (const item of response.value) {
        if (!missing.includes(item.id) || item.fields?.["System.TeamProject"] !== s.azureProject)
          continue;
        this.store.db
          .prepare("UPDATE ticket_local SET removed=0 WHERE source=? AND id=?")
          .run(source, item.id);
        this.store.cacheTicketRelations(item, this.store.source(s), azureBase(s.azureUrl), true);
        this.saveTicket(item, s);
        this.store.db
          .prepare("DELETE FROM ticket_trash WHERE source=? AND id=?")
          .run(source, item.id);
        added.push(item.id);
      }
      this.store.audit("tickets.imported", `Из Azure: ${added.join(", ")}`);
    })();
    return { added, missing: missing.filter((id) => !added.includes(id)) };
  }
  async lookupTickets(input: AzureLookup, add: boolean, guard: () => void) {
    const plan = azureLookupSchema.parse(input);
    const s = this.store.settings(),
      pat = this.store.secret("azure.pat");
    const check = () => {
      guard();
      if (this.store.source(s) !== this.store.source())
        throw new AppError(409, "Подключение Azure изменилось");
    };
    check();
    let ids = plan.ids ? [...new Set(plan.ids)] : [];
    let hasMore = false;
    if (!ids.length) {
      const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
      const filters = ["[System.TeamProject] = @project"];
      if (plan.search) filters.push(`[System.Title] CONTAINS ${quote(plan.search)}`);
      if (plan.type) filters.push(`[System.WorkItemType] = ${quote(plan.type)}`);
      if (plan.state) filters.push(`[System.State] = ${quote(plan.state)}`);
      if (plan.azurePriority?.length)
        filters.push(`[${AZURE_PRIORITY_FIELD}] IN (${plan.azurePriority.join(",")})`);
      const found = await this.azure(
        "wiql?$top=51",
        {
          method: "POST",
          body: JSON.stringify({
            query: `SELECT [System.Id] FROM WorkItems WHERE ${filters.join(" AND ")} ORDER BY [System.Id] ASC`,
          }),
        },
        s,
        pat,
      );
      if (!Array.isArray(found.workItems))
        throw new AppError(502, "Azure не вернул результаты поиска");
      hasMore = found.workItems.length > 50;
      ids = found.workItems.slice(0, 50).map((item: any) => item.id);
    }
    check();
    if (!ids.length) return { scope: "azure", tickets: [], added: [], missing: [], hasMore };
    const response = await this.azure(
      "workitemsbatch",
      {
        method: "POST",
        body: JSON.stringify({
          ids,
          $expand: "relations",
          errorPolicy: "Omit",
        }),
      },
      s,
      pat,
    );
    check();
    if (!Array.isArray(response.value)) throw new AppError(502, "Azure не вернул тикеты");
    const items = response.value.filter(
      (item: any) =>
        ids.includes(item.id) && item.fields?.["System.TeamProject"] === s.azureProject,
    );
    const tickets = items.map((item: any) => {
      this.store.cacheTicketRelations(item, this.store.source(s), azureBase(s.azureUrl), true);
      const f = item.fields;
      return {
        id: item.id,
        azurePriority: azurePriorityValue(f[AZURE_PRIORITY_FIELD]),
        azureTags: [
          ...new Set(
            String(f["System.Tags"] || "")
              .split(";")
              .map((tag) => tag.trim())
              .filter(Boolean),
          ),
        ],
        title: f["System.Title"] || "",
        state: f["System.State"] || "",
        type: f["System.WorkItemType"] || "",
        assigned:
          typeof f["System.AssignedTo"] === "string"
            ? f["System.AssignedTo"]
            : f["System.AssignedTo"]?.displayName || "",
        source: this.store.source(s),
        localUrl: `/tickets?${new URLSearchParams({ id: String(item.id), source: this.store.source(s) })}`,
      };
    });
    if (add)
      this.store.db.transaction(() => {
        check();
        for (const item of items) {
          this.store.db
            .prepare("UPDATE ticket_local SET removed=0 WHERE source=? AND id=?")
            .run(this.store.source(s), item.id);
          this.saveTicket(item, s);
          this.store.db
            .prepare("DELETE FROM ticket_trash WHERE source=? AND id=?")
            .run(this.store.source(s), item.id);
          this.store.audit("ticket.tracked", String(item.id));
        }
      })();
    return {
      scope: "azure",
      tickets,
      added: add ? tickets.map((item: any) => item.id) : [],
      missing: ids.filter((id) => !items.some((item: any) => item.id === id)),
      hasMore,
      note: hasMore
        ? "Показаны первые 50 результатов; уточните критерии для следующего поиска"
        : undefined,
    };
  }
  async trackTicket(id: number, guard: () => void = () => {}) {
    this.store.purgeTicketTrash();
    const s = this.store.settings();
    const item = await this.azure(
      `workitems/${id}?$expand=relations`,
      {},
      s,
      this.store.secret("azure.pat"),
    );
    guard();
    if (this.store.source(s) !== this.store.source())
      throw new AppError(409, "Подключение Azure изменилось во время запроса");
    if (item.id !== id) throw new AppError(502, "Azure вернул неверный номер тикета");
    if (item.fields?.["System.TeamProject"] !== s.azureProject)
      throw new AppError(400, "Тикет относится к другому проекту Azure DevOps");
    this.store.db
      .prepare("UPDATE ticket_local SET removed=0 WHERE source=? AND id=?")
      .run(this.store.source(s), id);
    this.store.cacheTicketRelations(item, this.store.source(s), azureBase(s.azureUrl), true);
    this.saveTicket(item, s);
    this.store.db
      .prepare("DELETE FROM ticket_trash WHERE source=? AND id=?")
      .run(this.store.source(s), id);
    this.store.audit("ticket.tracked", String(id));
    return item.id;
  }
  async ticketRelationsBatch(ids: number[], source: string, refresh = false) {
    const settings = this.store.settings();
    const pat = this.store.secret("azure.pat");
    const check = () => {
      if (
        source !== this.store.source(settings) ||
        source !== this.store.source() ||
        pat !== this.store.secret("azure.pat")
      )
        throw new AppError(409, "Подключение изменилось. Обновите список тикетов.");
    };
    check();
    const unique = [...new Set(ids)];
    const missing = unique.filter(
      (id) => refresh || this.store.ticketRelations(id, source).relations === null,
    );
    const received = new Set<number>();
    if (missing.length) {
      const response = await this.azure(
        "workitemsbatch",
        {
          method: "POST",
          body: JSON.stringify({
            ids: missing,
            $expand: "relations",
            errorPolicy: "Omit",
          }),
        },
        settings,
        pat,
      );
      check();
      if (!Array.isArray(response.value)) throw new AppError(502, "Azure не вернул связи тикетов");
      this.store.db.transaction(() => {
        for (const item of response.value) {
          if (
            !missing.includes(item.id) ||
            item.fields?.["System.TeamProject"] !== settings.azureProject
          )
            continue;
          if (item.relations !== undefined && !Array.isArray(item.relations)) continue;
          this.store.cacheTicketRelations(item, source, azureBase(settings.azureUrl), true);
          received.add(item.id);
        }
      })();
    }
    return {
      source,
      unavailable: missing.filter((id) => !received.has(id)),
      tickets: unique.map((id) => ({ id, ...this.store.ticketRelations(id, source) })),
    };
  }
  async syncTickets(
    importSelected = false,
    automatic = false,
    context?: { client: string; project: string },
    fetched?: Map<string, Set<number>>,
  ) {
    const s = this.store.settings(context);
    const already = fetched?.get(this.store.source(s)) || new Set<number>();
    const pat = this.store.secret("azure.pat");
    const ids = new Set(
      (
        this.store.db
          .prepare("SELECT id FROM tickets WHERE source=?")
          .all(this.store.source(s)) as { id: number }[]
      ).map((x) => x.id),
    );
    const matched = new Set<number>();
    if ((importSelected || (automatic && s.azureAutoImport)) && s.azureImportAssignees.length) {
      if (!s.azureTypes.length || !s.azureStates.length)
        throw new AppError(
          400,
          "Выберите типы и статусы задач: Заказчики и проекты → Автоматический импорт",
        );
      const quote = (v: string) => "'" + v.replace(/'/g, "''") + "'";
      const result = await this.azure(
        "wiql",
        {
          method: "POST",
          body: JSON.stringify({
            query:
              "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND " +
              "[System.AssignedTo] IN (" +
              s.azureImportAssignees.map((person) => quote(person.email)).join(",") +
              ")" +
              ` AND [System.WorkItemType] IN (${s.azureTypes.map(quote).join(",")}) AND [System.State] IN (${s.azureStates.map(quote).join(",")})` +
              " ORDER BY [System.ChangedDate] DESC",
          }),
        },
        s,
        pat,
      );
      for (const item of result.workItems || []) {
        matched.add(item.id);
        ids.add(item.id);
      }
    }
    const list = [...ids].filter(
      (id) =>
        !already.has(id) &&
        !this.store.db
          .prepare("SELECT 1 FROM ticket_local WHERE source=? AND id=? AND removed=1")
          .get(this.store.source(s), id),
    );
    const stages = [list.filter((id) => matched.has(id)), list.filter((id) => !matched.has(id))];
    for (const stage of stages) {
      for (let i = 0; i < stage.length; i += 200) {
        const result = await this.azure(
          "workitemsbatch",
          {
            method: "POST",
            body: JSON.stringify({
              ids: stage.slice(i, i + 200),
              $expand: "relations",
              errorPolicy: "Fail",
            }),
          },
          s,
          pat,
        );
        if (!Array.isArray(result.value) || result.value.length !== stage.slice(i, i + 200).length)
          throw new AppError(502, "Azure вернул неполный список тикетов");
        for (const item of result.value) {
          this.store.cacheTicketRelations(item, this.store.source(s), azureBase(s.azureUrl), true);
          this.saveTicket(item, s);
          this.cacheTicketContent(item, s, true);
          already.add(item.id);
        }
        fetched?.set(this.store.source(s), already);
      }
    }
    if (list.length || importSelected || (automatic && s.azureAutoImport))
      this.store.set("tickets.lastSync:" + this.store.source(s), new Date().toISOString());
    return { count: list.length };
  }
}
