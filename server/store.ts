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
  microsoftClientId: "",
  microsoftTenantId: "",
  azureUrl: "",
  azureProject: "",
  azureVersion: "7.1",
  syncSeconds: 300,
  instructions:
    "Отвечай по-русски, кратко и по делу. Помогай видеть обязательства, сроки и упущенные тикеты. Сохраняй факты в память, когда я явно прошу.",
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
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, scope TEXT NOT NULL, client TEXT NOT NULL, project TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, client TEXT NOT NULL, project TEXT NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, name TEXT NOT NULL, watched INTEGER NOT NULL DEFAULT 0, synced_at TEXT);
      CREATE TABLE IF NOT EXISTS messages (id TEXT NOT NULL, chat_id TEXT NOT NULL, sender TEXT NOT NULL, body TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(chat_id,id));
      CREATE TABLE IF NOT EXISTS tickets (source TEXT NOT NULL, id INTEGER NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL, assigned TEXT NOT NULL, type TEXT NOT NULL, url TEXT NOT NULL, changed_at TEXT, synced_at TEXT NOT NULL, PRIMARY KEY(source,id));
      CREATE TABLE IF NOT EXISTS suggestions (id TEXT PRIMARY KEY, source TEXT NOT NULL, ticket_id INTEGER NOT NULL, chat_id TEXT NOT NULL, message_id TEXT NOT NULL, excerpt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL, UNIQUE(source,ticket_id,chat_id,message_id));
      CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, chat_name TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, expires_at TEXT NOT NULL, remote_id TEXT, error TEXT);
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS memory_scope ON memories(scope,client,project);
      CREATE INDEX IF NOT EXISTS message_time ON messages(chat_id,created_at);
    `);
    // A crash after Graph accepted a request is ambiguous. Never automatically resend it.
    this.db
      .prepare(
        "UPDATE approvals SET status='unknown',error='Приложение перезапустилось во время отправки. Проверьте Teams.' WHERE status='sending'",
      )
      .run();
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
  settings(): Settings {
    return { ...defaults, ...this.get("settings", {}) };
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
  audit(action: string, detail: string) {
    this.db
      .prepare("INSERT INTO audit VALUES (?,?,?,?)")
      .run(randomUUID(), action, detail, new Date().toISOString());
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
  history(context: Context) {
    return this.db
      .prepare(
        "SELECT * FROM (SELECT rowid AS sequence,* FROM conversations WHERE client=? AND project=? ORDER BY rowid DESC LIMIT 40) ORDER BY sequence",
      )
      .all(context.client, context.project);
  }
  say(role: string, body: string, context: Context) {
    this.db
      .prepare("INSERT INTO conversations VALUES (?,?,?,?,?,?)")
      .run(
        randomUUID(),
        context.client,
        context.project,
        role,
        body,
        new Date().toISOString(),
      );
  }
  close() {
    this.db.close();
  }
}
