import { syncScheduleSchema } from "./sync-schedule.js";
import type { TicketAnalysisAttachment } from "./chat-ticket-attachment.js";
import { ticketMetadata } from "./ticket-metadata.js";
import Database from "better-sqlite3";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  randomUUID,
} from "node:crypto";

export type Context = { client: string; project: string };
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Approval = {
  id: string;
  chat_id: string;
  chat_name: string;
  body: string;
  status: string;
  created_at: string;
  expires_at: string;
  remote_id: string | null;
  error: string | null;
};
export const defaults = {
  githubClientId: "",
  model: "",
  reviewModel: "",
  microsoftClientId: "",
  microsoftTenantId: "",
  azureUrl: "",
  azureProject: "",
  azureVersion: "7.1",
  teamsEnabled: false,
  azureAutoImport: false,
  azureTypes: [] as string[],
  azureStates: [] as string[],
  statusColors: {} as Record<string, string>,
  typeColors: {} as Record<string, string>,
  syncSeconds: 600,
  syncSchedule: syncScheduleSchema.parse({}),
  prDailyLimit: 20,
  llmTimeoutSeconds: 180,
  llmMaxTokens: 100000,
  llmMaxToolCalls: 30,
  instructions:
    "Reply in the user's language, concisely and clearly. Help track commitments, deadlines and overlooked tickets. Save memory when explicitly asked; otherwise propose useful durable facts, agreements and preferences for approval. Use clear standalone wording, appropriate scope and avoid duplicates.",
  client: "",
  project: "",
};
export type Settings = typeof defaults;
export class Store {
  db: Database.Database;
  private key: Buffer;
  constructor(public readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const keyPath = join(dir, "master.key");
    if (!existsSync(keyPath))
      writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
    this.key = readFileSync(keyPath);
    if (this.key.length !== 32) throw new Error("Invalid master.key");
    this.db = new Database(join(dir, "orbit.sqlite"));
    chmodSync(join(dir, "orbit.sqlite"), 0o600);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_proposals (id TEXT PRIMARY KEY,scope TEXT NOT NULL,client TEXT NOT NULL,project TEXT NOT NULL,body TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pr_question_batches (id TEXT PRIMARY KEY,review_id TEXT NOT NULL,questions TEXT NOT NULL,answers TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS pr_question_review ON pr_question_batches(review_id);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, scope TEXT NOT NULL, client TEXT NOT NULL, project TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, client TEXT NOT NULL, project TEXT NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pr_projects (id TEXT PRIMARY KEY, client TEXT NOT NULL, project TEXT NOT NULL, source TEXT NOT NULL, azure_project TEXT NOT NULL, mode TEXT NOT NULL, enabled INTEGER NOT NULL, error TEXT, synced_at TEXT, UNIQUE(client,project,source,azure_project));
      CREATE TABLE IF NOT EXISTS pull_requests (monitor TEXT NOT NULL, repo TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL, url TEXT NOT NULL, head TEXT NOT NULL, target TEXT NOT NULL, draft INTEGER NOT NULL, in_scope INTEGER NOT NULL DEFAULT 1, synced_at TEXT NOT NULL, PRIMARY KEY(monitor,repo,number));
      CREATE TABLE IF NOT EXISTS pr_reviews (id TEXT PRIMARY KEY, monitor TEXT NOT NULL, repo TEXT NOT NULL, number INTEGER NOT NULL, head TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL, summary TEXT, coverage TEXT, error TEXT, usage_id TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, UNIQUE(monitor,repo,number,head,target));
      CREATE TABLE IF NOT EXISTS ticket_cards (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS contexts (client TEXT NOT NULL, project TEXT NOT NULL, PRIMARY KEY(client,project));
      CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, name TEXT NOT NULL, watched INTEGER NOT NULL DEFAULT 0, synced_at TEXT);
      CREATE TABLE IF NOT EXISTS messages (id TEXT NOT NULL, chat_id TEXT NOT NULL, sender TEXT NOT NULL, body TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(chat_id,id));
      CREATE TABLE IF NOT EXISTS ticket_azure_tags (source TEXT NOT NULL, id INTEGER NOT NULL, tags TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(source,id));
      CREATE TABLE IF NOT EXISTS tickets (source TEXT NOT NULL, id INTEGER NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL, assigned TEXT NOT NULL, type TEXT NOT NULL, url TEXT NOT NULL, changed_at TEXT, synced_at TEXT NOT NULL, PRIMARY KEY(source,id));
      CREATE TABLE IF NOT EXISTS suggestions (id TEXT PRIMARY KEY, source TEXT NOT NULL, ticket_id INTEGER NOT NULL, chat_id TEXT NOT NULL, message_id TEXT NOT NULL, excerpt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL, UNIQUE(source,ticket_id,chat_id,message_id));
      CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, chat_name TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, expires_at TEXT NOT NULL, remote_id TEXT, error TEXT);
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS llm_requests (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, finished_at TEXT, model TEXT NOT NULL, client TEXT NOT NULL, project TEXT NOT NULL, status TEXT NOT NULL, reason TEXT, tool_calls INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS llm_usage (request_id TEXT NOT NULL REFERENCES llm_requests(id), receipt_id TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, PRIMARY KEY(request_id,receipt_id));
      CREATE TABLE IF NOT EXISTS llm_tool_traces (id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES llm_requests(id), name TEXT NOT NULL, arguments TEXT NOT NULL, internal INTEGER NOT NULL, status TEXT NOT NULL, result TEXT, started_at TEXT NOT NULL, finished_at TEXT);
      CREATE INDEX IF NOT EXISTS llm_tool_trace_request ON llm_tool_traces(request_id);
      CREATE INDEX IF NOT EXISTS llm_request_time ON llm_requests(created_at);
      CREATE INDEX IF NOT EXISTS memory_scope ON memories(scope,client,project);
      CREATE INDEX IF NOT EXISTS message_time ON messages(chat_id,created_at);
    `);
    if (
      !(
        this.db.prepare("PRAGMA table_info(llm_tool_traces)").all() as any[]
      ).some((c) => c.name === "full_result")
    )
      this.db.exec("ALTER TABLE llm_tool_traces ADD COLUMN full_result TEXT");
    if (
      !(this.db.prepare("PRAGMA table_info(llm_requests)").all() as any[]).some(
        (c) => c.name === "origin",
      )
    )
      this.db.exec(
        "ALTER TABLE llm_requests ADD COLUMN origin TEXT NOT NULL DEFAULT 'unknown'",
      );
    if (
      !(this.db.prepare("PRAGMA table_info(llm_requests)").all() as any[]).some(
        (c) => c.name === "pull_request",
      )
    )
      this.db.exec("ALTER TABLE llm_requests ADD COLUMN pull_request TEXT");
    if (
      !(this.db.prepare("PRAGMA table_info(pr_reviews)").all() as any[]).some(
        (c) => c.name === "options",
      )
    )
      this.db.exec(
        "ALTER TABLE pr_reviews ADD COLUMN options TEXT NOT NULL DEFAULT '{}'",
      );
    if (!this.get("migration.reviewRuns", false)) {
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE pr_review_runs (id TEXT PRIMARY KEY, monitor TEXT NOT NULL, repo TEXT NOT NULL, number INTEGER NOT NULL, head TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL, summary TEXT, coverage TEXT, error TEXT, usage_id TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, options TEXT NOT NULL DEFAULT '{}');
          INSERT INTO pr_review_runs SELECT id,monitor,repo,number,head,target,status,summary,coverage,error,usage_id,created_at,started_at,finished_at,options FROM pr_reviews ORDER BY rowid;
          DROP TABLE pr_reviews;
          ALTER TABLE pr_review_runs RENAME TO pr_reviews;
          CREATE INDEX pr_review_version ON pr_reviews(monitor,repo,number,head,target);
        `);
        this.set("migration.reviewRuns", true);
      })();
    }
    if (!(this.db.prepare("PRAGMA table_info(pr_reviews)").all() as any[]).some(c => c.name === "model")) {
      this.db.exec("ALTER TABLE pr_reviews ADD COLUMN model TEXT");
      this.db.exec("UPDATE pr_reviews SET model=(SELECT model FROM llm_requests WHERE id=pr_reviews.usage_id)");
    }
    this.db
      .prepare(
        "UPDATE pr_reviews SET status='interrupted', error='Перезапуск во время ревью. Автоповтор отключён.', finished_at=? WHERE status='running'",
      )
      .run(new Date().toISOString());
    if (!this.get("migration.proactiveMemoryInstructions", false)) {
      const saved = this.get<any>("settings", {});
      if (
        saved.instructions ===
        "Отвечай по-русски, кратко и по делу. Помогай видеть обязательства, сроки и упущенные тикеты. Сохраняй факты в память, когда я явно прошу."
      )
        this.set("settings", { ...saved, instructions: defaults.instructions });
      this.set("migration.proactiveMemoryInstructions", true);
    }
    if (!this.get("migration.englishChatInstructions", false)) {
      const saved = this.get<any>("settings", {});
      if (saved.instructions === "Отвечай по-русски, кратко и по делу. Помогай видеть обязательства, сроки и упущенные тикеты. По моей просьбе сохраняй факты в память. Также сам замечай полезные для будущей работы факты, договорённости, правила и предпочтения в нашем разговоре и предлагай сохранить их через подтверждения, даже если я не просил запомнить. Формулируй записи кратко и понятно, выбирай подходящую область памяти и не дублируй уже известное.")
        this.set("settings", { ...saved, instructions: defaults.instructions });
      this.set("migration.englishChatInstructions", true);
    }
    if (!this.get("migration.sync600", false)) {
      const saved = this.get<any>("settings", {});
      if (saved.syncSeconds === 300)
        this.set("settings", { ...saved, syncSeconds: 600 });
      this.set("migration.sync600", true);
    }
    if (
      !(
        this.db.prepare("PRAGMA table_info(conversations)").all() as any[]
      ).some((c) => c.name === "cards")
    )
      this.db.exec(
        "ALTER TABLE conversations ADD COLUMN cards TEXT NOT NULL DEFAULT '[]'",
      );
    if (!(this.db.prepare("PRAGMA table_info(conversations)").all() as any[]).some(column => column.name === "duration_ms"))
      this.db.exec("ALTER TABLE conversations ADD COLUMN duration_ms INTEGER");
    if (
      !(
        this.db.prepare("PRAGMA table_info(conversations)").all() as any[]
      ).some((c) => c.name === "session_id")
    )
      this.db.exec(
        "ALTER TABLE conversations ADD COLUMN session_id TEXT NOT NULL DEFAULT ''",
      );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, client TEXT NOT NULL, project TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS chat_session_context ON chat_sessions(client,project,updated_at);
      CREATE INDEX IF NOT EXISTS conversation_session ON conversations(session_id);
    `);
    if (
      !(
        this.db.prepare("PRAGMA table_info(chat_sessions)").all() as any[]
      ).some((c) => c.name === "attachment")
    )
      this.db.exec("ALTER TABLE chat_sessions ADD COLUMN attachment TEXT");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pr_completed(monitor TEXT NOT NULL,repo TEXT NOT NULL,number INTEGER NOT NULL,closed_at TEXT NOT NULL,expires_at INTEGER NOT NULL,hydrated INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(monitor,repo,number));
      CREATE TABLE IF NOT EXISTS pr_ticket_links (monitor TEXT NOT NULL,repo TEXT NOT NULL,number INTEGER NOT NULL,ticket_id INTEGER NOT NULL,PRIMARY KEY(monitor,repo,number,ticket_id));
      CREATE TABLE IF NOT EXISTS pr_review_attempts (id TEXT PRIMARY KEY,review_id TEXT NOT NULL,started_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ticket_trash (source TEXT NOT NULL,id INTEGER NOT NULL,body TEXT NOT NULL,removed_at INTEGER NOT NULL,PRIMARY KEY(source,id));
      CREATE TABLE IF NOT EXISTS ticket_metadata (source TEXT NOT NULL,id INTEGER NOT NULL,notes TEXT NOT NULL DEFAULT '',priority INTEGER NOT NULL DEFAULT 1,tags TEXT NOT NULL DEFAULT '[]',PRIMARY KEY(source,id));
      CREATE TABLE IF NOT EXISTS ticket_local (source TEXT NOT NULL,id INTEGER NOT NULL,developer_id TEXT NOT NULL DEFAULT '',developer_name TEXT NOT NULL DEFAULT '',removed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(source,id));
    `);
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ticket_tracking_dates (source TEXT NOT NULL,id INTEGER NOT NULL,added_at TEXT,PRIMARY KEY(source,id));
        INSERT OR IGNORE INTO ticket_tracking_dates(source,id,added_at) SELECT source,id,NULL FROM tickets;
        INSERT OR IGNORE INTO ticket_tracking_dates(source,id,added_at) SELECT source,id,NULL FROM ticket_trash;
        CREATE TRIGGER IF NOT EXISTS ticket_first_added AFTER INSERT ON tickets BEGIN
          INSERT INTO ticket_tracking_dates(source,id,added_at) VALUES (NEW.source,NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(source,id) DO NOTHING;
        END;
      `);
    })();
    if (!(this.db.prepare("PRAGMA table_info(ticket_tracking_dates)").all() as any[]).some((c) => c.name === "created_at"))
      this.db.exec("ALTER TABLE ticket_tracking_dates ADD COLUMN created_at TEXT");
    if (!this.get("migration.ticketPriorityOne", false)) {
      this.db.transaction(() => {
        this.db.exec(`
          INSERT OR IGNORE INTO ticket_metadata(source,id,notes,priority,tags)
          SELECT source,id,'',2,'[]' FROM tickets;
          INSERT OR IGNORE INTO ticket_metadata(source,id,notes,priority,tags)
          SELECT source,id,'',2,'[]' FROM ticket_trash;
        `);
        this.set("migration.ticketPriorityOne", true);
      })();
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_developers (id TEXT PRIMARY KEY,name TEXT NOT NULL,client TEXT NOT NULL,project TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS ticket_developers (source TEXT NOT NULL,ticket_id INTEGER NOT NULL,developer_id TEXT NOT NULL REFERENCES local_developers(id),PRIMARY KEY(source,ticket_id,developer_id));
    `);
    if (!this.get("migration.localDevelopers", false)) {
      this.db.transaction(() => {
        const rows = this.db
          .prepare(
            "SELECT source,id,developer_id,developer_name FROM ticket_local WHERE developer_id<>''",
          )
          .all() as any[];
        const migrated = new Map<string, string>();
        for (const row of rows) {
          const key = `${row.source}|${row.developer_id}`;
          let developer = migrated.get(key);
          if (!developer) {
            developer = randomUUID();
            migrated.set(key, developer);
            this.db
              .prepare("INSERT INTO local_developers VALUES (?,?,'','',1)")
              .run(developer, row.developer_name || row.developer_id);
          }
          this.db
            .prepare("INSERT OR IGNORE INTO ticket_developers VALUES (?,?,?)")
            .run(row.source, row.id, developer);
        }
        this.set("migration.localDevelopers", true);
      })();
    }
    if (
      !(this.db.prepare("PRAGMA table_info(pr_projects)").all() as any[]).some(
        (c) => c.name === "repository",
      )
    )
      this.db.exec(
        "ALTER TABLE pr_projects ADD COLUMN repository TEXT NOT NULL DEFAULT ''",
      );
    if (
      !(this.db.prepare("PRAGMA table_info(pr_projects)").all() as any[]).some(
        (c) => c.name === "review_files",
      )
    )
      this.db.exec(
        "ALTER TABLE pr_projects ADD COLUMN review_files TEXT NOT NULL DEFAULT '{}'",
      );
    if (!(this.db.prepare("PRAGMA table_info(pr_projects)").all() as any[]).some(c => c.name === "code_sync_minutes"))
      this.db.exec("ALTER TABLE pr_projects ADD COLUMN code_sync_minutes INTEGER NOT NULL DEFAULT 30");
    if (!(this.db.prepare("PRAGMA table_info(pr_projects)").all() as any[]).some(c => c.name === "fetch_timeout_seconds"))
      this.db.exec("ALTER TABLE pr_projects ADD COLUMN fetch_timeout_seconds INTEGER NOT NULL DEFAULT 300");
    for (const column of [
      "description",
      "ticket_error",
      "created_at",
      "source_branch",
      "target_branch",
      "health",
    ]) {
      if (
        !(
          this.db.prepare("PRAGMA table_info(pull_requests)").all() as any[]
        ).some((c) => c.name === column)
      )
        this.db.exec(
          `ALTER TABLE pull_requests ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`,
        );
    }
    if (!this.get("migration.manualReviews", false)) {
      this.db
        .prepare(
          "UPDATE pr_reviews SET status='cancelled',error='Автоматическое ревью отключено. Запустите вручную.' WHERE status='queued'",
        )
        .run();
      this.set("migration.manualReviews", true);
    }
    // A crash after Graph accepted a request is ambiguous. Never automatically resend it.
    this.db
      .prepare(
        "UPDATE approvals SET status='unknown',error='Приложение перезапустилось во время отправки. Проверьте Teams.' WHERE status='sending'",
      )
      .run();
    this.db
      .prepare(
        "UPDATE llm_requests SET status='interrupted', reason='Перезапуск приложения; отчёт может быть неполным.', finished_at=? WHERE status='running'",
      )
      .run(new Date().toISOString());
    this.purgeTicketTrash();
  }
  get<T>(key: string, fallback: T): T {
    const row = this.db.prepare("SELECT value FROM kv WHERE key=?").get(key) as
      { value: string } | undefined;
    return row ? JSON.parse(row.value) : fallback;
  }
  set(key: string, value: unknown) {
    this.db
      .prepare("INSERT OR REPLACE INTO kv VALUES (?,?)")
      .run(key, JSON.stringify(value));
  }
  rawSettings(): Settings {
    return { ...defaults, ...this.get("settings", {}) };
  }
  projectAzureKey(context: Context, azureUrl = this.rawSettings().azureUrl) {
    return (
      "project.azure:" +
      JSON.stringify([
        azureUrl.replace(/\/$/, ""),
        context.client,
        context.project,
      ])
    );
  }
  azureContextKey(context: Context) {
    return "azure.context:" + JSON.stringify([context.client, context.project]);
  }
  azureBinding(
    context: Context,
  ): { azureUrl: string; azureProject: string } | null {
    const own = this.get<
      { azureUrl: string; azureProject: string } | null | undefined
    >(this.azureContextKey(context), undefined);
    if (own !== undefined) return own;
    const legacy = this.get<string | null>(this.projectAzureKey(context), null);
    return legacy === null
      ? null
      : { azureUrl: this.rawSettings().azureUrl, azureProject: legacy };
  }
  settings(context?: Context): Settings {
    const settings = this.rawSettings();
    const scope = context || settings;
    const customer = scope.client
      ? this.azureBinding({ client: scope.client, project: "" })
      : null;
    const project =
      scope.client && scope.project ? this.azureBinding(scope) : null;
    return { ...settings, ...(project || customer || {}) };
  }
  secret(key: string): string | undefined {
    const row = this.db
      .prepare("SELECT value FROM secrets WHERE key=?")
      .get(key) as { value: string } | undefined;
    if (!row) return undefined;
    const [iv, tag, data] = row.value
      .split(".")
      .map((s) => Buffer.from(s, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString();
  }
  setSecret(key: string, value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    this.db
      .prepare("INSERT OR REPLACE INTO secrets VALUES (?,?)")
      .run(
        key,
        [iv, cipher.getAuthTag(), data]
          .map((b) => b.toString("base64"))
          .join("."),
      );
  }
  deleteSecret(key: string) {
    this.db.prepare("DELETE FROM secrets WHERE key=?").run(key);
  }
  audit(action: string, detail: string, pr?: { monitor: string; repo: string; number: number }) {
    if (pr) {
      const row = this.db.prepare("SELECT title FROM pull_requests WHERE monitor=? AND repo=? AND number=?").get(pr.monitor, pr.repo, pr.number) as { title: string } | undefined;
      detail = JSON.stringify({ detail, pull_request: { monitor: pr.monitor, repo: pr.repo, number: pr.number, title: row?.title || "" } });
    }
    this.db
      .prepare("INSERT INTO audit VALUES (?,?,?,?)")
      .run(randomUUID(), action, detail, new Date().toISOString());
  }
  contexts(): Context[] {
    const current = this.settings();
    return this.db
      .prepare(
        `SELECT client,project FROM contexts UNION SELECT client,project FROM memories WHERE client!='' UNION SELECT client,project FROM conversations WHERE client!='' UNION SELECT ? AS client, ? AS project WHERE ?!='' ORDER BY client,project`,
      )
      .all(current.client, current.project, current.client) as Context[];
  }
  addContext(context: Context) {
    if (!context.client || (context.project && !context.client))
      throw new AppError(400, "Укажите заказчика");
    this.db
      .prepare("INSERT OR IGNORE INTO contexts VALUES (?,?)")
      .run(context.client, "");
    this.db
      .prepare("INSERT OR IGNORE INTO contexts VALUES (?,?)")
      .run(context.client, context.project);
  }
  renameContext(context: Context, name: string) {
    name = name.trim();
    if (!context.client || !name || name.length > 200)
      throw new AppError(400, "Укажите название длиной до 200 символов");
    const known = this.contexts();
    if (!known.some(c => c.client === context.client && (!context.project || c.project === context.project)))
      throw new AppError(404, "Заказчик или проект не найден");
    if (name === (context.project || context.client)) return;
    if (known.some(c => context.project ? c.client === context.client && c.project === name : c.client === name))
      throw new AppError(409, "Такое название уже используется");
    this.db.transaction(() => {
      this.addContext(context);
      const tables = ["contexts", "memories", "memory_proposals", "conversations", "chat_sessions", "pr_projects", "llm_requests", "local_developers"];
      for (const table of tables) {
        if (context.project) this.db.prepare(`UPDATE ${table} SET project=? WHERE client=? AND project=?`).run(name, context.client, context.project);
        else this.db.prepare(`UPDATE ${table} SET client=? WHERE client=?`).run(name, context.client);
      }
      const offsets: Record<string, number> = { "azure.context:": 0, "project.azure:": 1, "chat.active:": 0, "ticket-priorities:": 0, "developer-note:": 0, "developer-status-groups:": 1 };
      const entries = this.db.prepare("SELECT key,value FROM kv").all() as { key: string; value: string }[];
      for (const row of entries) {
        const prefix = Object.keys(offsets).find(prefix => row.key.startsWith(prefix));
        if (!prefix) continue;
        // Old or unrelated entries may share a prefix without using the current
        // JSON tuple format. Preserve those entries instead of aborting the rename.
        let parts: unknown;
        try { parts = JSON.parse(row.key.slice(prefix.length)); }
        catch { continue; }
        const i = offsets[prefix];
        const length = prefix === "developer-note:" ? 3 : i + 2;
        if (!Array.isArray(parts) || parts.length !== length || !parts.every(part => typeof part === "string")) continue;
        if (parts[i] !== context.client || (context.project && parts[i + 1] !== context.project)) continue;
        parts[context.project ? i + 1 : i] = name;
        const nextKey = prefix + JSON.stringify(parts);
        if (this.db.prepare("SELECT 1 FROM kv WHERE key=?").get(nextKey))
          throw new AppError(409, "Для этого названия уже существуют настройки");
        this.db.prepare("UPDATE kv SET key=? WHERE key=?").run(nextKey, row.key);
      }
      const current = this.rawSettings();
      if (current.client === context.client && (!context.project || current.project === context.project)) {
        this.set("settings", { ...current, ...(context.project ? { project: name } : { client: name }) });
      }
      this.audit("context.renamed", JSON.stringify({ from: context, name }));
    })();
  }
  source(s = this.settings()) {
    return `${s.azureUrl.replace(/\/$/, "")}|${s.azureProject}`;
  }
  memories(context: Context) {
    return this.db
      .prepare(
        "SELECT * FROM memories WHERE scope='general' OR (scope='client' AND client=? AND ?!='') OR (scope='project' AND client=? AND project=? AND ?!='') ORDER BY created_at DESC LIMIT 200",
      )
      .all(
        context.client,
        context.client,
        context.client,
        context.project,
        context.project,
      );
  }
  addMemory(scope: string, body: string, context: Context) {
    if (
      !["general", "client", "project"].includes(scope) ||
      !body.trim() ||
      body.length > 8000
    )
      throw new AppError(400, "Неверная запись памяти");
    if (scope !== "general" && !context.client)
      throw new AppError(400, "Выберите заказчика");
    if (scope === "project" && !context.project)
      throw new AppError(400, "Выберите проект");
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO memories VALUES (?,?,?,?,?,?)")
      .run(
        id,
        scope,
        scope === "general" ? "" : context.client,
        scope === "project" ? context.project : "",
        body.trim(),
        new Date().toISOString(),
      );
    this.audit("memory.saved", `${scope}: ${id}`);
    return { id, scope, body };
  }
  azureTags(id: number, source = this.source()): string[] {
    const row = this.db
      .prepare("SELECT tags FROM ticket_azure_tags WHERE source=? AND id=?")
      .get(source, id) as { tags: string } | undefined;
    return row ? JSON.parse(row.tags) : [];
  }
  ticketCreatedAt(id: number, source = this.source()): string | null {
    return (this.db.prepare("SELECT created_at FROM ticket_tracking_dates WHERE source=? AND id=?")
      .get(source, id) as { created_at: string | null } | undefined)?.created_at ?? null;
  }
  saveTicketCreatedAt(id: number, source: string, value: unknown) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return;
    this.db.prepare("UPDATE ticket_tracking_dates SET created_at=? WHERE source=? AND id=?")
      .run(new Date(value).toISOString(), source, id);
  }
  ticketAddedAt(id: number, source = this.source()): string | null {
    const row = this.db
      .prepare(
        "SELECT added_at FROM ticket_tracking_dates WHERE source=? AND id=?",
      )
      .get(source, id) as { added_at: string | null } | undefined;
    return row?.added_at ?? null;
  }
  purgeTicketTrash(now = Date.now()) {
    return this.db.transaction(() => {
      const expired = this.db
        .prepare("SELECT source,id FROM ticket_trash WHERE removed_at<=?")
        .all(now - 30 * 86400000) as any[];
      for (const row of expired) {
        this.db
          .prepare(
            "DELETE FROM ticket_tracking_dates WHERE source=? AND id=? AND NOT EXISTS (SELECT 1 FROM tickets WHERE source=? AND id=?)",
          )
          .run(row.source, row.id, row.source, row.id);
        this.db
          .prepare(
            "DELETE FROM ticket_metadata WHERE source=? AND id=? AND NOT EXISTS (SELECT 1 FROM tickets WHERE source=? AND id=?)",
          )
          .run(row.source, row.id, row.source, row.id);
        this.db
          .prepare(
            "DELETE FROM ticket_azure_tags WHERE source=? AND id=? AND NOT EXISTS (SELECT 1 FROM tickets WHERE source=? AND id=?)",
          )
          .run(row.source, row.id, row.source, row.id);
        this.db
          .prepare("DELETE FROM ticket_trash WHERE source=? AND id=?")
          .run(row.source, row.id);
        this.db
          .prepare(
            "DELETE FROM ticket_developers WHERE source=? AND ticket_id=? AND NOT EXISTS (SELECT 1 FROM tickets WHERE source=? AND id=?)",
          )
          .run(row.source, row.id, row.source, row.id);
        this.db
          .prepare(
            "UPDATE ticket_local SET developer_id='',developer_name='' WHERE source=? AND id=? AND removed=1",
          )
          .run(row.source, row.id);
      }
      return expired.length;
    })();
  }
  hasLocalTicket(id: number, source = this.source()) {
    return !!this.db
      .prepare(
        "SELECT 1 FROM tickets WHERE source=? AND id=? UNION SELECT 1 FROM ticket_trash WHERE source=? AND id=? AND removed_at>?",
      )
      .get(source, id, source, id, Date.now() - 30 * 86400000);
  }
  updateTrashFromAzure(item: any, source: string) {
    const row = this.db
      .prepare(
        "SELECT body FROM ticket_trash WHERE source=? AND id=? AND removed_at>?",
      )
      .get(source, item.id, Date.now() - 30 * 86400000) as any;
    if (!row) return;
    const body = JSON.parse(row.body),
      fields = item.fields || {};
    for (const [key, field] of Object.entries({
      title: "System.Title",
      state: "System.State",
      type: "System.WorkItemType",
      changed_at: "System.ChangedDate",
      created_at: "System.CreatedDate",
    })) {
      if (field in fields) body[key] = fields[field];
    }
    if ("System.AssignedTo" in fields)
      body.assigned =
        typeof fields["System.AssignedTo"] === "string"
          ? fields["System.AssignedTo"]
          : fields["System.AssignedTo"]?.displayName || "";
    if ("System.Tags" in fields)
      this.db
        .prepare(
          "INSERT INTO ticket_azure_tags(source,id,tags) VALUES (?,?,?) ON CONFLICT(source,id) DO UPDATE SET tags=excluded.tags",
        )
        .run(
          source,
          item.id,
          JSON.stringify(
            String(fields["System.Tags"] || "")
              .split(";")
              .map((v) => v.trim())
              .filter(Boolean),
          ),
        );
    this.saveTicketCreatedAt(item.id, source, fields["System.CreatedDate"]);
    body.synced_at = new Date().toISOString();
    this.db
      .prepare("UPDATE ticket_trash SET body=? WHERE source=? AND id=?")
      .run(JSON.stringify(body), source, item.id);
  }
  ticketTrash() {
    this.purgeTicketTrash();
    return (
      this.db
        .prepare(
          "SELECT * FROM ticket_trash WHERE source=? ORDER BY removed_at DESC",
        )
        .all(this.source()) as any[]
    ).map((row) => {
      const developers = this.db
        .prepare(
          "SELECT d.id,d.name,d.active FROM ticket_developers a JOIN local_developers d ON d.id=a.developer_id WHERE a.source=? AND a.ticket_id=? ORDER BY d.name COLLATE NOCASE,d.id",
        )
        .all(row.source, row.id) as {
        id: string;
        name: string;
        active: number;
      }[];
      return {
        ...JSON.parse(row.body),
        added_at: this.ticketAddedAt(row.id, row.source),
        created_at: this.ticketCreatedAt(row.id, row.source) ?? JSON.parse(row.body).created_at ?? null,
        azureTags: this.azureTags(row.id, row.source),
        ...ticketMetadata(this, row.id, row.source),
        developers,
        developer_name: developers.map((d) => d.name).join(", "),
        inTrash: true,
        removedAt: row.removed_at,
        expiresAt: row.removed_at + 30 * 86400000,
      };
    });
  }
  restoreLocalTicket(id: number, source = this.source()) {
    if (source !== this.source())
      throw new AppError(409, "Подключение изменилось. Обновите корзину.");
    this.purgeTicketTrash();
    this.db.transaction(() => {
      const row = this.db
        .prepare("SELECT body FROM ticket_trash WHERE source=? AND id=?")
        .get(source, id) as any;
      if (!row)
        throw new AppError(
          404,
          "Тикет отсутствует в корзине или срок хранения истёк",
        );
      const t = JSON.parse(row.body);
      this.db
        .prepare(
          "INSERT INTO tickets(source,id,title,state,assigned,type,url,changed_at,synced_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(source,id) DO NOTHING",
        )
        .run(
          source,
          id,
          t.title,
          t.state,
          t.assigned,
          t.type,
          t.url,
          t.changed_at,
          t.synced_at,
        );
      this.db
        .prepare("UPDATE ticket_local SET removed=0 WHERE source=? AND id=?")
        .run(source, id);
      this.db
        .prepare("DELETE FROM ticket_trash WHERE source=? AND id=?")
        .run(source, id);
    })();
    this.audit("ticket.restored_locally", String(id));
    return { success: true, id, azureChanged: false };
  }
  removeLocalTicket(id: number) {
    const source = this.source();
    this.purgeTicketTrash();
    this.db.transaction(() => {
      const ticket = this.db
        .prepare(
          "SELECT t.*,l.developer_name FROM tickets t LEFT JOIN ticket_local l ON t.source=l.source AND t.id=l.id WHERE t.source=? AND t.id=?",
        )
        .get(source, id) as any;
      if (ticket) {
        const developers = this.db
          .prepare(
            "SELECT d.id,d.name FROM ticket_developers a JOIN local_developers d ON d.id=a.developer_id WHERE a.source=? AND a.ticket_id=?",
          )
          .all(source, id);
        this.db
          .prepare(
            "INSERT INTO ticket_trash(source,id,body,removed_at) VALUES (?,?,?,?) ON CONFLICT(source,id) DO NOTHING",
          )
          .run(
            source,
            id,
            JSON.stringify({ ...ticket, developers }),
            Date.now(),
          );
      }
      this.db
        .prepare(
          "INSERT INTO ticket_local(source,id,removed) VALUES (?,?,1) ON CONFLICT(source,id) DO UPDATE SET removed=1",
        )
        .run(source, id);
      this.db
        .prepare("DELETE FROM tickets WHERE source=? AND id=?")
        .run(source, id);
    })();
    this.audit("ticket.removed_locally", String(id));
    return {
      success: true,
      id,
      tracked: false,
      retentionDays: 30,
      scope: "local",
      azureChanged: false,
    };
  }
  private activeChatKey(context: Context) {
    return `chat.active:${JSON.stringify([context.client, context.project])}`;
  }
  chatSession(context: Context, id?: string) {
    if (!id) return this.activeChat(context);
    const session = this.db
      .prepare(
        "SELECT id,client,project,title,created_at,updated_at FROM chat_sessions WHERE id=? AND client=? AND project=?",
      )
      .get(id, context.client, context.project) as any;
    if (!session) throw new AppError(404, "Чат не найден в текущем контексте.");
    return session;
  }
  activeChat(context: Context): any {
    return this.db.transaction(() => {
      const legacy = this.db
        .prepare(
          "SELECT body,created_at FROM conversations WHERE client=? AND project=? AND session_id='' ORDER BY rowid",
        )
        .all(context.client, context.project) as any[];
      if (legacy.length) {
        const id = randomUUID();
        this.db
          .prepare(
            "INSERT INTO chat_sessions(id,client,project,title,created_at,updated_at) VALUES (?,?,?,?,?,?)",
          )
          .run(
            id,
            context.client,
            context.project,
            "Предыдущий разговор",
            legacy[0].created_at,
            legacy.at(-1).created_at,
          );
        this.db
          .prepare(
            "UPDATE conversations SET session_id=? WHERE client=? AND project=? AND session_id=''",
          )
          .run(id, context.client, context.project);
        this.set(this.activeChatKey(context), id);
      }
      const id = this.get(this.activeChatKey(context), "");
      const session = this.db
        .prepare(
          "SELECT id,client,project,title,created_at,updated_at FROM chat_sessions WHERE client=? AND project=? ORDER BY (id=?) DESC,updated_at DESC,rowid DESC LIMIT 1",
        )
        .get(context.client, context.project, id) as any;
      if (session) return session;
      return this.createChat(context);
    })();
  }
  createChat(context: Context, attachment?: TicketAnalysisAttachment) {
    const id = randomUUID(),
      now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO chat_sessions(id,client,project,title,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      )
      .run(id, context.client, context.project, "Новый чат", now, now);
    if (attachment)
      this.db
        .prepare("UPDATE chat_sessions SET attachment=?,title=? WHERE id=?")
        .run(
          JSON.stringify(attachment),
          `Анализ #${attachment.id} · ${attachment.title}`.slice(0, 100),
          id,
        );
    this.set(this.activeChatKey(context), id);
    return this.chatSession(context, id);
  }
  selectChat(context: Context, id: string) {
    const session = this.chatSession(context, id);
    this.set(this.activeChatKey(context), id);
    return session;
  }
  chatSessions(context: Context) {
    const active = this.activeChat(context);
    return {
      activeId: active.id,
      sessions: this.db
        .prepare(
          "SELECT s.id,s.client,s.project,s.title,s.created_at,s.updated_at, (SELECT COUNT(*) FROM conversations c WHERE c.session_id=s.id) AS messageCount FROM chat_sessions s WHERE client=? AND project=? ORDER BY updated_at DESC,rowid DESC",
        )
        .all(context.client, context.project),
    };
  }
  chatAttachment(
    context: Context,
    id: string,
  ): TicketAnalysisAttachment | null {
    this.chatSession(context, id);
    const row = this.db
      .prepare("SELECT attachment FROM chat_sessions WHERE id=?")
      .get(id) as { attachment: string | null };
    return row.attachment ? JSON.parse(row.attachment) : null;
  }
  detachChatTicket(context: Context, id: string) {
    this.chatSession(context, id);
    this.db
      .prepare(
        "UPDATE chat_sessions SET attachment=NULL,updated_at=? WHERE id=?",
      )
      .run(new Date().toISOString(), id);
    return { ok: true };
  }
  conversationPage(context: Context, id?: string, before?: number) {
    const session = this.chatSession(context, id);
    const rows = this.db
      .prepare(
        "SELECT rowid AS sequence,* FROM conversations WHERE session_id=? AND client=? AND project=? AND rowid<? ORDER BY rowid DESC LIMIT 101",
      )
      .all(
        session.id,
        context.client,
        context.project,
        before ?? Number.MAX_SAFE_INTEGER,
      ) as any[];
    return {
      messages: rows.slice(0, 100).reverse(),
      hasMore: rows.length > 100,
    };
  }
  clearHistory(context: Context, id?: string) {
    const session = this.chatSession(context, id);
    return this.db.transaction(() => {
      const result = this.db
        .prepare(
          "DELETE FROM conversations WHERE session_id=? AND client=? AND project=?",
        )
        .run(session.id, context.client, context.project);
      this.db
        .prepare(
          "UPDATE chat_sessions SET title='Новый чат',attachment=NULL,updated_at=? WHERE id=?",
        )
        .run(new Date().toISOString(), session.id);
      return { deleted: result.changes };
    })();
  }
  history(context: Context, id?: string) {
    const session = this.chatSession(context, id);
    return this.db
      .prepare(
        "SELECT * FROM (SELECT rowid AS sequence,* FROM conversations WHERE session_id=? AND client=? AND project=? ORDER BY rowid DESC LIMIT 40) ORDER BY sequence",
      )
      .all(session.id, context.client, context.project);
  }
  say(
    role: string,
    body: string,
    context: Context,
    cards: string[] = [],
    id?: string,
    durationMs?: number,
  ) {
    const session = this.chatSession(context, id);
    this.db.transaction(() => {
      const first =
        role === "user" &&
        !this.db
          .prepare(
            "SELECT 1 FROM conversations WHERE session_id=? AND role='user' LIMIT 1",
          )
          .get(session.id);
      const now = new Date().toISOString();
      this.db
        .prepare(
          "INSERT INTO conversations(id,client,project,role,body,created_at,cards,session_id,duration_ms) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          context.client,
          context.project,
          role,
          body,
          now,
          JSON.stringify(cards),
          session.id,
          durationMs === undefined ? null : Math.max(0, Math.round(durationMs)),
        );
      this.db
        .prepare("UPDATE chat_sessions SET title=?,updated_at=? WHERE id=?")
        .run(
          first
            ? body.replace(/\s+/g, " ").trim().slice(0, 80) || "Новый чат"
            : session.title,
          now,
          session.id,
        );
    })();
  }
  close() {
    this.db.close();
  }
}
