import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { Store, AppError, type Context, defaults } from "./store.js";
import { Approvals } from "./approvals.js";
import { IntegrationsAuth } from "./auth.js";
import { Connectors } from "./connectors.js";
import { Agent } from "./agent.js";
import { azureBase } from "./http.js";

const text = z.string().trim().max(200);
const contextSchema = z.object({
  client: text.default(""),
  project: text.default(""),
});
const settingsSchema = z
  .object({
    githubClientId: text,
    model: text,
    microsoftClientId: text,
    microsoftTenantId: text,
    azureUrl: z.string().trim().max(1000),
    azureProject: text,
    azureVersion: z.string().regex(/^\d+\.\d+(?:-preview\.\d+)?$/),
    syncSeconds: z.number().int().min(60).max(3600),
    instructions: z.string().max(12000),
    client: text,
    project: text,
    azurePat: z.string().max(2000).optional(),
  })
  .strict();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function sessionToken(req: Request) {
  return (
    /(?:^|;\s*)orbit_session=([^;]+)/.exec(req.headers.cookie || "")?.[1] || ""
  );
}
export function createApp(
  store: Store,
  options: {
    sendMessage?: (id: string, body: string) => Promise<{ id: string }>;
    origins?: string[];
  } = {},
) {
  const auth = new IntegrationsAuth(store);
  const connectors = new Connectors(store, auth);
  const approvals = new Approvals(
    store,
    options.sendMessage || ((id, body) => connectors.sendMessage(id, body)),
  );
  const agent = new Agent(store, approvals);
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
      strictTransportSecurity: false,
    }),
  );
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  const origins =
    options.origins ||
    (
      process.env.APP_ORIGINS ||
      "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173"
    ).split(",");
  const hosts = new Set(origins.map((o) => new URL(o).host));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!hosts.has(req.headers.host || ""))
      return next(new AppError(403, "Неизвестный Host"));
    if (req.headers.origin && !origins.includes(req.headers.origin))
      return next(new AppError(403, "Недопустимый Origin"));
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers["x-orbit-request"] !== "1"
    )
      return next(
        new AppError(403, "Запрос должен поступить из интерфейса Orbit"),
      );
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  function currentSession(req: Request) {
    return store.db
      .prepare("SELECT * FROM sessions WHERE token=? AND expires>?")
      .get(hash(sessionToken(req)), Date.now()) as { csrf: string } | undefined;
  }
  function login(res: Response) {
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(32).toString("hex");
    store.db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
    store.db
      .prepare("INSERT INTO sessions VALUES (?,?,?)")
      .run(hash(token), csrf, Date.now() + 86400000 * 7);
    res.cookie("orbit_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: origins.every((o) => o.startsWith("https:")),
      maxAge: 86400000 * 7,
      path: "/",
    });
    res.json({ authenticated: true, csrf });
  }
  app.get("/api/auth/session", (req, res) => {
    const session = currentSession(req);
    res.json({
      setupRequired: !store.secret("password"),
      authenticated: !!session,
      csrf: session?.csrf,
    });
  });
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Слишком много попыток входа. Повторите через 15 минут.",
    },
  });
  app.post("/api/auth/setup", loginLimit, (req, res) => {
    if (store.secret("password"))
      throw new AppError(409, "Пароль уже настроен");
    const { password } = z
      .object({ password: z.string().min(12).max(256) })
      .parse(req.body);
    const salt = randomBytes(16).toString("hex");
    store.setSecret(
      "password",
      `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
    );
    login(res);
  });
  app.post("/api/auth/login", loginLimit, (req, res) => {
    const { password } = z
      .object({ password: z.string().max(256) })
      .parse(req.body);
    const stored = store.secret("password");
    if (!stored) throw new AppError(400, "Сначала создайте пароль");
    const [salt, key] = stored.split(":");
    if (
      !timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, "hex"))
    )
      throw new AppError(401, "Неверный пароль");
    login(res);
  });
  app.use("/api", (req, _res, next) => {
    const session = currentSession(req);
    if (!session) return next(new AppError(401, "Войдите в Orbit"));
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers["x-csrf-token"] !== session.csrf
    )
      return next(
        new AppError(403, "Обновите страницу: недействительный CSRF token"),
      );
    next();
  });
  app.post("/api/auth/logout", (req, res) => {
    store.db
      .prepare("DELETE FROM sessions WHERE token=?")
      .run(hash(sessionToken(req)));
    res.clearCookie("orbit_session");
    res.json({ ok: true });
  });
  app.get("/api/settings", (_req, res) =>
    res.json({
      ...store.settings(),
      githubConnected: !!store.secret("github.token"),
      microsoftConnected: store.get("microsoft.connected", false),
      azurePatSet: !!store.secret("azure.pat"),
    }),
  );
  app.put("/api/settings", (req, res) => {
    const parsed = settingsSchema.parse(req.body);
    const { azurePat, ...settings } = parsed;
    if (settings.azureUrl) settings.azureUrl = azureBase(settings.azureUrl);
    if (settings.project && !settings.client)
      throw new AppError(400, "Проект должен принадлежать заказчику");
    const old = store.settings();
    const microsoftChanged =
      old.microsoftClientId !== settings.microsoftClientId ||
      old.microsoftTenantId !== settings.microsoftTenantId;
    if (
      microsoftChanged &&
      store.db
        .prepare(
          "SELECT 1 FROM approvals WHERE status IN ('pending','sending')",
        )
        .get()
    )
      throw new AppError(
        409,
        "Сначала обработайте ожидающие сообщения перед сменой аккаунта Teams",
      );
    store.set("settings", settings);
    if (microsoftChanged) {
      store.set("microsoft.connected", false);
      store.db.exec(
        "DELETE FROM chats; DELETE FROM messages; DELETE FROM suggestions;",
      );
    }
    if (old.githubClientId !== settings.githubClientId)
      store.deleteSecret("github.token");
    if (azurePat?.trim()) store.setSecret("azure.pat", azurePat.trim());
    store.audit("settings.updated", "Настройки сохранены");
    res.json({ ok: true });
  });
  app.post("/api/connect/github", async (_req, res) =>
    res.json(await auth.startGitHub()),
  );
  app.post("/api/connect/github/poll", async (_req, res) =>
    res.json(await auth.pollGitHub()),
  );
  app.post("/api/connect/microsoft", async (_req, res) =>
    res.json(await auth.startMicrosoft()),
  );
  app.get("/api/connect/microsoft", (_req, res) =>
    res.json(auth.microsoftStatus()),
  );
  app.get("/api/copilot/models", async (_req, res) =>
    res.json(await agent.models()),
  );
  app.get("/api/overview", (_req, res) => {
    const source = store.source();
    res.json({
      pending: (
        store.db
          .prepare(
            "SELECT count(*) AS n FROM approvals WHERE status='pending' AND expires_at>?",
          )
          .get(new Date().toISOString()) as any
      ).n,
      tickets: (
        store.db
          .prepare("SELECT count(*) AS n FROM tickets WHERE source=?")
          .get(source) as any
      ).n,
      inbox: (
        store.db
          .prepare(
            "SELECT count(*) AS n FROM suggestions WHERE source=? AND status='new'",
          )
          .get(source) as any
      ).n,
      memories: (
        store.db.prepare("SELECT count(*) AS n FROM memories").get() as any
      ).n,
      sync: store.get("sync.status", { state: "idle" }),
      activity: store.db
        .prepare("SELECT * FROM audit ORDER BY created_at DESC LIMIT 8")
        .all(),
    });
  });
  app.get("/api/memories", (req, res) =>
    res.json(store.memories(contextSchema.parse(req.query))),
  );
  app.post("/api/memories", (req, res) => {
    const v = z
      .object({
        scope: z.enum(["general", "client", "project"]),
        body: z.string().trim().min(1).max(8000),
        context: contextSchema,
      })
      .parse(req.body);
    res.json(store.addMemory(v.scope, v.body, v.context));
  });
  app.delete("/api/memories/:id", (req, res) => {
    store.db.prepare("DELETE FROM memories WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/conversation", (req, res) =>
    res.json(store.history(contextSchema.parse(req.query))),
  );
  app.post(
    "/api/conversation",
    rateLimit({
      windowMs: 60000,
      limit: 15,
      message: { error: "Слишком много запросов к модели" },
    }),
    async (req, res) => {
      const v = z
        .object({
          prompt: z.string().trim().min(1).max(16000),
          context: contextSchema,
        })
        .parse(req.body);
      res.json(await agent.chat(v.prompt, v.context));
    },
  );
  app.get("/api/chats", (_req, res) =>
    res.json(
      store.db.prepare("SELECT * FROM chats ORDER BY watched DESC,name").all(),
    ),
  );
  app.post("/api/chats/refresh", async (_req, res) =>
    res.json(await connectors.refreshChats()),
  );
  app.put("/api/chats/:id", (req, res) => {
    const v = z.object({ watched: z.boolean() }).parse(req.body);
    store.db
      .prepare("UPDATE chats SET watched=? WHERE id=?")
      .run(v.watched ? 1 : 0, req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/chats/:id/messages", (req, res) =>
    res.json(
      store.db
        .prepare(
          "SELECT * FROM messages WHERE chat_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .all(req.params.id),
    ),
  );
  app.get("/api/approvals", (_req, res) => res.json(approvals.list()));
  app.post("/api/approvals", (req, res) => {
    const v = z
      .object({ chatId: z.string(), body: z.string().min(1).max(12000) })
      .strict()
      .parse(req.body);
    res.json(approvals.propose(v.chatId, v.body));
  });
  app.post("/api/approvals/:id/approve", async (req, res) => {
    // This is the only route capable of sending. It requires an authenticated browser and CSRF token.
    z.object({}).strict().parse(req.body);
    res.json(await approvals.approve(String(req.params.id)));
  });
  app.post("/api/approvals/:id/reject", (req, res) => {
    approvals.reject(String(req.params.id));
    res.json({ ok: true });
  });
  app.get("/api/tickets", (_req, res) =>
    res.json(
      store.db
        .prepare(
          "SELECT * FROM tickets WHERE source=? ORDER BY changed_at DESC",
        )
        .all(store.source()),
    ),
  );
  app.post("/api/tickets", async (req, res) => {
    const { id } = z
      .object({ id: z.number().int().positive().max(999999999) })
      .parse(req.body);
    res.json({ id: await connectors.trackTicket(id) });
  });
  app.post("/api/tickets/import", async (_req, res) =>
    res.json(await connectors.syncTickets(true)),
  );
  app.get("/api/inbox", (_req, res) =>
    res.json(
      store.db
        .prepare(
          "SELECT s.*,c.name AS chat_name,m.sender,m.url AS message_url FROM suggestions s LEFT JOIN chats c ON c.id=s.chat_id LEFT JOIN messages m ON m.chat_id=s.chat_id AND m.id=s.message_id WHERE s.source=? AND s.status='new' ORDER BY s.created_at DESC LIMIT 200",
        )
        .all(store.source()),
    ),
  );
  app.post("/api/inbox/:id/dismiss", (req, res) => {
    store.db
      .prepare("UPDATE suggestions SET status='dismissed' WHERE id=?")
      .run(req.params.id);
    res.json({ ok: true });
  });
  let syncing = false;
  async function sync() {
    if (syncing) throw new AppError(409, "Синхронизация уже выполняется");
    syncing = true;
    const errors: string[] = [];
    store.set("sync.status", {
      state: "running",
      at: new Date().toISOString(),
    });
    try {
      if (store.get("microsoft.connected", false))
        try {
          await connectors.syncTeams();
        } catch (e) {
          errors.push(
            e instanceof AppError ? e.message : "Ошибка синхронизации Teams",
          );
        }
      if (store.secret("azure.pat"))
        try {
          await connectors.syncTickets();
        } catch (e) {
          errors.push(
            e instanceof AppError
              ? e.message
              : "Ошибка синхронизации Azure DevOps",
          );
        }
      const result = {
        state: errors.length ? "error" : "ok",
        at: new Date().toISOString(),
        errors,
      };
      store.set("sync.status", result);
      return result;
    } finally {
      syncing = false;
    }
  }
  app.post("/api/sync", async (_req, res) => res.json(await sync()));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  });
  app.post(
    "/api/voice/transcribe",
    upload.single("audio"),
    async (req, res) => {
      if (!req.file) throw new AppError(400, "Нет аудиозаписи");
      if (!/^(audio\/|video\/webm)/.test(req.file.mimetype))
        throw new AppError(400, "Нужен аудиофайл");
      const form = new FormData();
      form.append(
        "audio",
        new Blob([new Uint8Array(req.file.buffer)], {
          type: req.file.mimetype,
        }),
        "recording",
      );
      let result: globalThis.Response;
      try {
        result = await fetch(
          `${process.env.VOICE_URL || "http://127.0.0.1:8000"}/transcribe`,
          { method: "POST", body: form, signal: AbortSignal.timeout(300000) },
        );
      } catch {
        throw new AppError(
          503,
          "Распознавание недоступно. Запустите voice-контейнер; первая загрузка модели может занять несколько минут.",
        );
      }
      if (!result.ok)
        throw new AppError(
          502,
          "Не удалось распознать запись. Проверьте voice-контейнер.",
        );
      res.json(await result.json());
    },
  );
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (req, res) => {
    if (req.path.startsWith("/api/"))
      return res.status(404).json({ error: "Маршрут не найден" });
    res.sendFile(resolve("dist/index.html"));
  });
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof z.ZodError)
        return res.status(400).json({
          error: "Проверьте поля формы",
          fields: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        });
      if (error instanceof AppError)
        return res.status(error.status).json({ error: error.message });
      if (error instanceof multer.MulterError)
        return res
          .status(400)
          .json({ error: "Аудиозапись слишком большая (максимум 20 МБ)" });
      console.error(
        "Request failed:",
        error instanceof Error ? error.name : "UnknownError",
      );
      res.status(500).json({
        error: "Внутренняя ошибка. Проверьте настройки и повторите запрос.",
      });
    },
  );
  return { app, sync, agent, approvals, connectors };
}
