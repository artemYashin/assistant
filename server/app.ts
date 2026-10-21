import { CodeBrowser, codeBrowserSchema } from "./code-browser.js";
import { syncScheduleSchema } from "./sync-schedule.js";
import { azureBrowseSchema } from "./azure-browser.js";
import {
  ticketAnalysisAttachment,
  attachmentPreview,
} from "./chat-ticket-attachment.js";
import { overviewAudit } from "./overview-activity.js";
import { overviewUsage, recentUsage } from "./overview-usage.js";
import { PrCreate } from "./pr-create.js";
import { reviewFileSettings } from "./review-files.js";
import {
  ticketMetadata,
  localTicketTags,
  saveTicketMetadata,
  priorityCount,
  metadataContext,
  metadataPatch,
} from "./ticket-metadata.js";
import { PrMerge } from "./pr-merge.js";
import { LocalDevelopers } from "./local-developers.js";
import { MemoryProposals } from "./memory-proposals.js";
import { ReviewQuestions, reviewOptionsSchema } from "./review-questions.js";
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
import { PullRequests } from "./pull-requests.js";
import { Agent } from "./agent.js";
import { azureBase } from "./http.js";
import { UsageLedger } from "./usage.js";

const text = z.string().trim().max(200);
const contextSchema = z.object({
  client: text.default(""),
  project: text.default(""),
});
const settingsSchema = z
  .object({
    githubClientId: text,
    model: text,
    reviewModel: text.default(""),
    microsoftClientId: text,
    microsoftTenantId: text,
    azureUrl: z.string().trim().max(1000),
    azureProject: text,
    azureVersion: z.string().regex(/^\d+\.\d+(?:-preview\.\d+)?$/),
    syncSeconds: z.number().int().min(60).max(3600),
    syncSchedule: syncScheduleSchema.default(() => syncScheduleSchema.parse({})),
    teamsEnabled: z.boolean().default(false),
    azureAutoImport: z.boolean().default(false),
    azureTypes: z.array(text.min(1)).max(50).default([]),
    azureStates: z.array(text.min(1)).max(100).default([]),
    typeColors: z
      .record(z.string().min(1).max(200), z.string().regex(/^#[0-9a-fA-F]{6}$/))
      .default({}),
    statusColors: z
      .record(z.string().min(1).max(200), z.string().regex(/^#[0-9a-fA-F]{6}$/))
      .default({}),
    prDailyLimit: z.number().int().min(1).max(100).default(20),
    llmTimeoutSeconds: z.number().int().min(15).max(600).default(180),
    llmMaxTokens: z.number().int().min(1000).max(1000000).default(100000),
    llmMaxToolCalls: z.number().int().min(1).max(100).default(30),
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
  const agent = new Agent(store, approvals, undefined, connectors);
  const pullRequests = new PullRequests(store, agent);
  const prMerge = new PrMerge(store, connectors);
  const prCreate = new PrCreate(store);
  const codeBrowser = new CodeBrowser(store);
  agent.setPullRequests(pullRequests);
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
      "http://localhost:43871,http://127.0.0.1:43871,http://localhost:5173,http://127.0.0.1:5173"
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
  app.get("/api/contexts", (_req, res) => res.json(store.contexts()));
  app.post("/api/contexts", (req, res) => {
    const context = contextSchema.strict().parse(req.body);
    store.addContext(context);
    res.json(store.contexts());
  });
  app.post("/api/contexts/rename", (req, res) => {
    const input = z.object({ context: contextSchema.strict(), name: z.string().trim().min(1).max(200) }).strict().parse(req.body);
    store.renameContext(input.context, input.name);
    const { client, project } = store.settings();
    res.json({ items: store.contexts(), context: { client, project } });
  });
  app.put("/api/context", (req, res) => {
    const context = contextSchema.strict().parse(req.body);
    if (context.project && !context.client)
      throw new AppError(400, "Проект должен принадлежать заказчику");
    const known = store.contexts();
    if (
      context.client &&
      !known.some(
        (c) =>
          c.client === context.client &&
          (!context.project || c.project === context.project),
      )
    )
      throw new AppError(400, "Сначала добавьте заказчика и проект");
    const previous = store.settings();
    if (previous.client)
      store.addContext({ client: previous.client, project: previous.project });
    if (context.client) store.addContext(context);
    store.set("settings", { ...store.rawSettings(), ...context });
    res.json(context);
  });
  app.get("/api/context/azure", (req, res) => {
    const context = contextSchema.strict().parse(req.query);
    const resolved = store.settings(context);
    const parent = store.settings({
      client: context.project ? context.client : "",
      project: "",
    });
    res.json({
      azureProject: resolved.azureProject,
      azureUrl: resolved.azureUrl,
      inherit: !store.azureBinding(context),
      parent: { azureUrl: parent.azureUrl, azureProject: parent.azureProject },
    });
  });
  app.put("/api/context/azure", (req, res) => {
    const input = contextSchema
      .extend({
        azureProject: text.default(""),
        azureUrl: z.string().max(2000).default(""),
        inherit: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    if (!input.client) throw new AppError(400, "Выберите заказчика");
    if (
      !store
        .contexts()
        .some((c) => c.client === input.client && c.project === input.project)
    )
      throw new AppError(400, "Заказчик или проект не найден");
    if (!input.inherit && !input.azureProject)
      throw new AppError(400, "Укажите проект Azure DevOps");
    const azureUrl = input.inherit
      ? ""
      : azureBase(input.azureUrl || store.settings(input).azureUrl);
    store.set(
      store.azureContextKey(input),
      input.inherit ? null : { azureUrl, azureProject: input.azureProject },
    );
    store.audit(
      "context.azure.updated",
      `Azure: ${input.client} / ${input.project || "настройки заказчика"}`,
    );
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
    if (
      settings.azureAutoImport &&
      (!settings.azureTypes.length || !settings.azureStates.length)
    )
      throw new AppError(400, "Выберите типы и статусы для автоимпорта");
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
    store.set("settings", {
      ...settings,
      azureUrl: old.client ? store.rawSettings().azureUrl : settings.azureUrl,
      azureProject: old.client
        ? store.rawSettings().azureProject
        : settings.azureProject,
      client: old.client,
      project: old.project,
    });
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
  app.get("/api/overview", (req, res) => {
    const context = contextSchema.parse(req.query);
    const source = store.source();
    res.json({
      usage: overviewUsage(store, context),
      pullRequests: (
        store.db
          .prepare(
            `SELECT COUNT(*) AS n FROM pull_requests p JOIN pr_projects m ON m.id=p.monitor WHERE p.in_scope=1 AND m.enabled=1 AND (?='' OR m.client=?) AND (?='' OR m.project=?)`,
          )
          .get(
            context.client,
            context.client,
            context.project,
            context.project,
          ) as any
      ).n,
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
      ticketsLastSync: store.get<string | null>(
        "tickets.lastSync:" + source,
        null,
      ),
      activity: overviewAudit(store),
    });
  });
  app.get("/api/overview/activity", (req, res) => {
    const context = contextSchema.parse(req.query);
    res.json({ audit: overviewAudit(store, 100), requests: recentUsage(store, context, 100) });
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
  app.patch("/api/memories/:id", (req, res) => {
    const { body } = z
      .object({ body: z.string().trim().min(1).max(8000) })
      .parse(req.body);
    const result = store.db
      .prepare("UPDATE memories SET body=? WHERE id=?")
      .run(body, String(req.params.id));
    if (!result.changes) throw new AppError(404, "Запись памяти не найдена");
    store.audit("memory.updated", String(req.params.id));
    res.json({ ok: true, body });
  });
  app.delete("/api/memories/:id", (req, res) => {
    store.db.prepare("DELETE FROM memories WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/conversation/tools/:id/result", (req, res) =>
    res.json(
      new UsageLedger(store).toolResult(
        String(req.params.id),
        contextSchema.parse(req.query),
      ),
    ),
  );
  app.get("/api/conversation/tools", (req, res) =>
    res.json(new UsageLedger(store).chatTools(contextSchema.parse(req.query))),
  );
  app.get("/api/conversation/sessions", (req, res) =>
    res.json(store.chatSessions(contextSchema.parse(req.query))),
  );
  app.post("/api/conversation/sessions", (req, res) => {
    const context = contextSchema.parse(req.body);
    store.activeChat(context); // Preserve pre-session conversations before creating another chat.
    const ref = z.string().uuid().optional().parse(req.body.ticketCardRef);
    const attachment = ref
      ? ticketAnalysisAttachment(connectors.ticketCard(ref), store.source())
      : undefined;
    res.json(store.createChat(context, attachment));
  });
  app.delete("/api/conversation/sessions/:id/attachment", (req, res) => {
    const context = contextSchema.parse(req.body);
    const id = z.string().uuid().parse(req.params.id);
    if (agent.active())
      throw new AppError(
        409,
        "Дождитесь завершения ответа или остановите его, затем уберите тикет из контекста.",
      );
    res.json(store.detachChatTicket(context, id));
  });
  app.put("/api/conversation/sessions/:id/active", (req, res) =>
    res.json(
      store.selectChat(contextSchema.parse(req.body), String(req.params.id)),
    ),
  );
  app.get("/api/conversation", (req, res) => {
    const context = contextSchema.parse(req.query);
    const id = z.string().uuid().optional().parse(req.query.sessionId);
    if (req.query.page === "true") {
      const before = z.coerce
        .number()
        .int()
        .positive()
        .safe()
        .optional()
        .parse(req.query.before);
      const session = store.chatSession(context, id);
      res.json({
        ...store.conversationPage(context, session.id, before),
        attachment: attachmentPreview(
          store.chatAttachment(context, session.id),
        ),
      });
    } else res.json(store.history(context, id));
  });
  app.delete("/api/conversation", (req, res) => {
    const context = contextSchema.parse(req.body);
    const id = z.string().uuid().optional().parse(req.body.sessionId);
    if (agent.active())
      throw new AppError(
        409,
        "Дождитесь завершения ответа или остановите его, затем очистите историю.",
      );
    res.json(store.clearHistory(context, id));
  });
  app.get("/api/usage", (req, res) => {
    const days = z.coerce
      .number()
      .refine((value) => [0, 1, 7, 30].includes(value))
      .parse(req.query.days ?? 0);
    res.json({
      ...new UsageLedger(store).report(days),
      activeRequestId: agent.active(),
    });
  });
  app.post("/api/conversation/stop", (_req, res) => res.json(agent.stop()));
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
          model: z.string().trim().max(200).optional(),
          context: contextSchema,
          sessionId: z.string().uuid().optional(),
          selectedTickets: z
            .array(
              z.object({
                id: z.number().int().positive().safe(),
                source: z.string().min(1).max(2000),
              }),
            )
            .max(1000)
            .default([]),
        })
        .parse(req.body);
      if (v.selectedTickets.some((ticket) => ticket.source !== store.source()))
        throw new AppError(
          409,
          "Подключение Azure изменилось. Выберите тикеты заново.",
        );
      const ids = [...new Set(v.selectedTickets.map((ticket) => ticket.id))];
      const prompt = ids.length
        ? `${v.prompt}\n\nВыбранные пользователем тикеты в таблице: ${ids.map((id) => `#${id}`).join(", ")}. Это номера, а не содержимое тикетов. При необходимости прочитай данные доступными инструментами; сам выбор не является просьбой изменить тикеты.`
        : v.prompt;
      if (!req.headers.accept?.includes("application/x-ndjson")) {
        res.json(await agent.chat(prompt, v.context, false, undefined, v.sessionId, v.model));
        return;
      }
      res.status(200).set({ "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
      res.flushHeaders();
      const write = (event: unknown) => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + "\n"); };
      const heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write("\n"); }, 15000);
      try {
        const result = await agent.chat(prompt, v.context, false, undefined, v.sessionId, v.model,
          progress => write({ type: "progress", progress }));
        write({ type: "result", data: result });
      } catch (error) {
        write({ type: "error", error: error instanceof AppError ? error.message : "Не удалось завершить ответ ассистента" });
      } finally { clearInterval(heartbeat); res.end(); }
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
  const memoryProposals = new MemoryProposals(store);
  const reviewQuestions = new ReviewQuestions(store);
  app.get("/api/memory-proposals", (_req, res) =>
    res.json(memoryProposals.list()),
  );
  app.delete("/api/memory-proposals/:id", (req, res) => {
    const result = store.db
      .prepare("DELETE FROM memory_proposals WHERE id=?")
      .run(String(req.params.id));
    if (!result.changes) throw new AppError(404, "Предложение не найдено");
    store.audit("memory.proposal_removed", String(req.params.id));
    res.json({ ok: true });
  });
  app.post("/api/memory-proposals/:id/approve", (req, res) =>
    res.json(memoryProposals.decide(String(req.params.id), true)),
  );
  app.post("/api/memory-proposals/:id/reject", (req, res) =>
    res.json(memoryProposals.decide(String(req.params.id), false)),
  );
  app.get("/api/review-questions", (_req, res) =>
    res.json(reviewQuestions.list()),
  );
  app.post("/api/review-questions/:id/answers", (req, res) =>
    res.json(reviewQuestions.answer(String(req.params.id), req.body.answers)),
  );
  app.post("/api/review-questions/:id/dismiss", (req, res) => {
    reviewQuestions.dismiss(String(req.params.id));
    res.json({ ok: true });
  });
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
  const localDevelopers = new LocalDevelopers(store);
  const developerNoteKey = (context: Context, id: string) =>
    `developer-note:${JSON.stringify([context.client, context.project, id])}`;
  const developerStatusKey = (context: Context) =>
    `developer-status-groups:${JSON.stringify([store.source(), context.client, context.project])}`;
  const importedDeveloperStates = () => {
    const cached = store.get<{ name: string; states: string[] }[] | null>(
      "azure.ticket-options:" + store.source(),
      null,
    );
    return [
      ...new Set(
        cached
          ? cached.flatMap((type) => type.states)
          : store.settings().azureStates,
      ),
    ].sort();
  };
  app.put("/api/developer-board/status-groups", (req, res) => {
    const input = z
      .object({
        context: contextSchema,
        source: z.string(),
        showDeleted: z.boolean().optional(),
        statusGroups: z
          .record(
            z.string().trim().min(1).max(200),
            z.enum(["active", "review", "done"]),
          )
          .refine((value) => Object.keys(value).length <= 300),
      })
      .strict()
      .parse(req.body);
    if (!input.context.project) throw new AppError(400, "Выберите проект");
    if (input.source !== store.source())
      throw new AppError(
        409,
        "Подключение изменилось; откройте настройки заново",
      );
    const keys = Object.keys(input.statusGroups).map((key) =>
      key.toLocaleLowerCase(),
    );
    if (new Set(keys).size !== keys.length)
      throw new AppError(
        400,
        "Статусы не должны повторяться без учёта регистра",
      );
    store.set(developerStatusKey(input.context), input.statusGroups);
    const visibilityKey = developerStatusKey(input.context) + ":show-deleted";
    if (input.showDeleted !== undefined)
      store.set(visibilityKey, input.showDeleted);
    res.json({
      statusGroups: input.statusGroups,
      showDeleted: store.get(visibilityKey, true),
    });
  });
  app.get("/api/developer-board", (req, res) => {
    const context = contextSchema.parse(req.query);
    res.json({
      developers: localDevelopers.list(context).map((person) => ({
        ...person,
        notes: store.get<string>(developerNoteKey(context, person.id), ""),
      })),
      completedTickets: store.ticketTrash(),
      availableStates: importedDeveloperStates(),
      source: store.source(),
      statusGroups: store.get(developerStatusKey(context), {}),
      showDeleted: store.get(
        developerStatusKey(context) + ":show-deleted",
        true,
      ),
    });
  });
  app.put("/api/developer-board/:id/notes", (req, res) => {
    const input = z
      .object({ context: contextSchema, notes: z.string().max(20000) })
      .parse(req.body);
    const id = String(req.params.id);
    if (!localDevelopers.list(input.context).some((person) => person.id === id))
      throw new AppError(404, "Разработчик не найден в этом проекте");
    store.set(developerNoteKey(input.context, id), input.notes);
    res.json({ ok: true });
  });
  app.get("/api/local-developers", (req, res) =>
    res.json(localDevelopers.list(contextSchema.parse(req.query))),
  );
  app.post("/api/local-developers", (req, res) =>
    res.json(
      localDevelopers.add(
        req.body.names,
        contextSchema.parse(req.body.context),
      ),
    ),
  );
  app.put("/api/local-developers/:id", (req, res) => {
    localDevelopers.edit(String(req.params.id), req.body.name);
    res.json({ ok: true });
  });
  app.delete("/api/local-developers/:id", (req, res) => {
    localDevelopers.remove(String(req.params.id));
    res.json({ ok: true });
  });
  app.put("/api/tickets/:id/developers", (req, res) => {
    const v = z
      .object({
        developerIds: z.array(z.string()).max(50),
        context: contextSchema,
        source: z.string().min(1).max(2000),
      })
      .parse(req.body);
    res.json(
      localDevelopers.assign(
        z.coerce.number().int().positive().parse(req.params.id),
        v.developerIds,
        v.context,
        v.source,
      ),
    );
  });
  app.post("/api/tickets/states/batch", async (req, res) => {
    const input = z
      .object({
        ids: z.array(z.number().int().positive()).min(1).max(25),
        source: z.string().min(1),
      })
      .parse(req.body);
    if (input.source !== store.source())
      throw new AppError(409, "Подключение изменилось");
    res.json(await connectors.ticketStatesBatch([...new Set(input.ids)]));
  });
  app.put("/api/tickets/state/batch", async (req, res) => {
    const input = z
      .object({
        ids: z.array(z.number().int().positive()).min(1).max(25),
        state: text.min(1),
        source: z.string().min(1),
      })
      .parse(req.body);
    const guard = () => {
      if (input.source !== store.source())
        throw new AppError(409, "Подключение изменилось");
    };
    guard();
    res.json({
      results: await connectors.changeTicketStatuses(
        [...new Set(input.ids)].map((id) => ({ id, state: input.state })),
        guard,
      ),
    });
  });
  app.get("/api/tickets/:id/states", async (req, res) =>
    res.json(
      await connectors.ticketStates(
        z.coerce.number().int().positive().parse(req.params.id),
      ),
    ),
  );
  app.put("/api/tickets/:id/state", async (req, res) => {
    const input = z
      .object({ state: text.min(1), source: z.string().min(1).max(2000) })
      .parse(req.body);
    const guard = () => {
      if (input.source !== store.source())
        throw new AppError(
          409,
          "Подключение изменилось. Обновите карточку тикета.",
        );
    };
    guard();
    res.json(
      await connectors.changeTicketStatus(
        z.coerce.number().int().positive().parse(req.params.id),
        input.state,
        guard,
      ),
    );
  });
  app.get("/api/ticket-priorities", (req, res) => {
    const context = metadataContext.parse(req.query);
    res.json({ count: priorityCount(store, context) });
  });
  app.get("/api/local-ticket-tags", (req, res) => {
    const source = z.string().min(1).max(2000).parse(req.query.source);
    if (source !== store.source()) throw new AppError(409, "Подключение изменилось. Откройте редактор заново.");
    res.json(localTicketTags(store, source));
  });
  app.put("/api/ticket-priorities", (req, res) => {
    const { context, count } = z
      .object({
        context: metadataContext,
        count: z.number().int().min(2).max(20).nullable(),
      })
      .parse(req.body);
    const key = `ticket-priorities:${JSON.stringify([context.client, context.project])}`;
    if (count === null) store.db.prepare("DELETE FROM kv WHERE key=?").run(key);
    else store.set(key, count);
    res.json({ count: priorityCount(store, context) });
  });
  app.get("/api/tickets/:id/metadata", (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    res.json(ticketMetadata(store, id));
  });
  app.put("/api/tickets/:id/metadata", (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const input = z
      .object({
        source: z.string(),
        context: metadataContext,
        patch: metadataPatch,
      })
      .strict()
      .parse(req.body);
    res.json(
      saveTicketMetadata(store, id, input.source, input.context, input.patch),
    );
  });
  const localTickets = () =>
    store.db
      .prepare(
        "SELECT t.*,l.developer_id,l.developer_name FROM tickets t LEFT JOIN ticket_local l ON t.source=l.source AND t.id=l.id WHERE t.source=? ORDER BY t.changed_at DESC",
      )
      .all(store.source())
      .map((ticket: any) => {
        const developers = localDevelopers.assigned(ticket.id, ticket.source);
        return {
          ...ticket,
          added_at: store.ticketAddedAt(ticket.id, ticket.source),
          created_at: store.ticketCreatedAt(ticket.id, ticket.source),
          ...ticketMetadata(store, ticket.id, ticket.source),
          azureTags: store.azureTags(ticket.id, ticket.source),
          developers,
          developer_name: developers.length
            ? developers.map((d) => d.name).join(", ")
            : ticket.developer_name,
        };
      });
  app.get("/api/tickets", (_req, res) => res.json(localTickets()));
  app.post("/api/azure/tickets/search", async (req, res) => {
    const input = azureBrowseSchema.parse(req.body);
    const result = await connectors.browseAzureTickets(input, [
      ...localTickets(),
      ...store.ticketTrash(),
    ]);
    const local = new Map(localTickets().map((t: any) => [t.id, t]));
    const trash = new Map(store.ticketTrash().map((t: any) => [t.id, t]));
    res.json({
      ...result,
      tickets: result.tickets.map((t: any) => ({
        ...(local.get(t.id) || trash.get(t.id) || {}),
        ...t,
        imported: local.has(t.id),
        inTrash: !local.has(t.id) && trash.has(t.id),
      })),
    });
  });
  app.post("/api/azure/tickets/import", async (req, res) => {
    const input = z
      .object({
        source: z.string().max(2200),
        ids: z.array(z.number().int().positive()).min(1).max(50),
      })
      .strict()
      .parse(req.body);
    res.json(await connectors.importAzureSelection(input.ids, input.source));
  });
  app.get("/api/azure/tickets/catalog", async (_req, res) => {
    const source = store.source();
    const cached = store.get<{ name: string; states: string[] }[] | null>(
      "azure.ticket-options:" + source,
      null,
    );
    const types = cached || (await connectors.ticketOptions());
    if (source !== store.source())
      throw new AppError(409, "Подключение Azure изменилось");
    res.json({
      types: types.map((t) => t.name),
      states: [...new Set(types.flatMap((t) => t.states))],
    });
  });
  app.put("/api/tickets/:id/assignee", async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const { source, userId } = z
      .object({
        source: z.string().min(1),
        userId: z.string().uuid().nullable(),
      })
      .parse(req.body);
    res.json(await connectors.assignTicket(id, source, userId));
  });
  app.post("/api/developers/search", async (req, res) => {
    const { query } = z
      .object({ query: z.string().trim().min(2).max(100) })
      .strict()
      .parse(req.body);
    res.json(await connectors.developers(query));
  });
  app.get("/api/tickets/trash", (_req, res) => res.json(store.ticketTrash()));
  app.post("/api/tickets/:id/restore", (req, res) => {
    const { source } = z
      .object({ source: z.string().min(1).max(2000) })
      .parse(req.body);
    res.json(
      store.restoreLocalTicket(
        z.coerce.number().int().positive().parse(req.params.id),
        source,
      ),
    );
  });
  app.delete("/api/tickets/:id", (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const source = z.string().min(1).optional().parse(req.body?.source);
    if (source && source !== store.source())
      throw new AppError(
        409,
        "Подключение Azure изменилось. Обновите карточку перед удалением.",
      );
    res.json(store.removeLocalTicket(id));
  });
  app.put("/api/tickets/:id/developer", (_req, _res) => {
    throw new AppError(
      410,
      "Назначение из Azure больше не поддерживается. Выберите разработчиков из локального списка проекта.",
    );
  });
  app.get("/api/tickets/filter-options", (req, res) => {
    const context = metadataContext.parse(req.query);
    const settings = store.settings();
    const catalog = store.get<{ name: string; states: string[] }[] | null>(
      "azure.ticket-options:" + store.source(),
      null,
    );
    res.json({
      source: store.source(),
      types: [...new Set(catalog ? catalog.map((type) => type.name) : settings.azureTypes)],
      states: [...new Set(catalog ? catalog.flatMap((type) => type.states) : settings.azureStates)],
      priorityCount: priorityCount(store, context),
    });
  });
  app.get("/api/tickets/options", async (_req, res) =>
    res.json(await connectors.ticketOptions()),
  );
  app.get("/api/tickets/:id/details", async (req, res) =>
    res.json(
      await connectors.ticketDetails(
        z.coerce.number().int().positive().parse(req.params.id),
      ),
    ),
  );
  app.get("/api/ticket-cards/:ref", (req, res) => {
    const card = connectors.ticketCard(String(req.params.ref));
    res.json({
      ...card,
      localMetadata: ticketMetadata(store, card.id, card.source),
      developers: localDevelopers.assigned(card.id, card.source),
      localContext: {
        client: store.settings().client,
        project: store.settings().project,
      },
      locallyAvailable: store.hasLocalTicket(card.id, card.source),
      locallyTracked: !!store.db
        .prepare("SELECT 1 FROM tickets WHERE source=? AND id=?")
        .get(card.source, card.id),
      linkedPullRequests: pullRequests.linkedToTicket(card.id, card.source),
    });
  });
  app.post("/api/ticket-cards/:ref/comments", async (req, res) => {
    const { text } = z
      .object({ text: z.string().trim().min(1).max(10000) })
      .parse(req.body);
    res.json(await connectors.addTicketComment(String(req.params.ref), text));
  });
  app.get("/api/ticket-cards/:ref/attachments/:id", async (req, res) => {
    const file = await connectors.attachment(
      String(req.params.ref),
      String(req.params.id),
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.type(file.type);
    res.setHeader(
      "Content-Disposition",
      `${file.type.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    res.send(file.body);
  });
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
  app.get("/api/pr/completed", async (req, res) => {
    const input = z
      .object({
        monitor: z.string().min(1),
        page: z.coerce.number().int().min(0).max(10000).default(0),
      })
      .parse(req.query);
    res.json(await pullRequests.completed(input.monitor, input.page));
  });
  app.post("/api/code-browser", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.headers.accept !== "application/x-ndjson") {
      res.json(await codeBrowser.request(req.body));
      return;
    }
    const input = codeBrowserSchema.parse(req.body);
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const send = (event: unknown) => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + "\n"); };
    try {
      const data = await codeBrowser.request(input, progress => send({ type: "progress", progress }));
      send({ type: "result", data });
    } catch (error) {
      send({ type: "error", error: error instanceof AppError ? error.message : "Операция кода не завершена. Проверьте подключение и повторите запрос." });
    } finally { res.end(); }
  });
  app.get("/api/pr/branches", async (req, res) => {
    const q = z
      .object({
        monitor: z.string().min(1),
        q: z.string().max(300).default(""),
      })
      .parse(req.query);
    res.json(await prCreate.branches(q.monitor, q.q));
  });
  app.post("/api/pr/create", async (req, res) => {
    const result = await prCreate.create(req.body);
    // Creation has already succeeded: a refresh failure must not invite a
    // second creation attempt or hide the confirmed PR number.
    let refreshError = "";
    try {
      await pullRequests.sync(req.body.monitor);
      const monitor = pullRequests.monitors().find(
        (m) => m.id === req.body.monitor,
      );
      refreshError = monitor?.error ||
        (!monitor?.enabled ? "Мониторинг репозитория выключен." : "");
    } catch {
      refreshError = "Не удалось обновить список PR. Повторите синхронизацию.";
    }
    res.json({ ...result, refreshError });
  });
  app.get("/api/pr/projects", (_req, res) => res.json(pullRequests.monitors()));
  app.post("/api/pr/projects", (req, res) => {
    const input = z
      .object({
        client: text.min(1),
        project: text.min(1),
        repository: text.min(1),
        mode: z.enum(["required", "all"]),
        enabled: z.boolean(),
        reviewFiles: reviewFileSettings.optional(),
        codeSyncMinutes: z.number().int().min(0).max(1440).optional(),
        fetchTimeoutSeconds: z.number().int().min(60).max(1800).optional(),
      })
      .strict()
      .parse(req.body);
    pullRequests.save(input);
    res.json({ ok: true });
  });
  app.put("/api/pr/projects/:id", (req, res) => {
    const input = z
      .object({ mode: z.enum(["required", "all"]), enabled: z.boolean() })
      .strict()
      .parse(req.body);
    const changed = store.db
      .prepare("UPDATE pr_projects SET mode=?,enabled=?,error=NULL WHERE id=?")
      .run(input.mode, Number(input.enabled), String(req.params.id));
    if (!changed.changes)
      throw new AppError(404, "Проект мониторинга не найден");
    // Invalidate membership until a fresh scan applies the new filter.
    store.db
      .prepare("UPDATE pull_requests SET in_scope=0 WHERE monitor=?")
      .run(String(req.params.id));
    res.json({ ok: true });
  });
  app.post("/api/pr/merge/tickets", async (req, res) => {
    const key = z
      .object({
        monitor: text.min(1),
        repo: text.min(1),
        number: z.number().int().positive(),
      })
      .strict()
      .parse(req.body);
    res.json(await prMerge.linkedTickets(key));
  });
  app.post("/api/pr/merge/prepare", async (req, res) => {
    const key = z
      .object({
        monitor: text.min(1),
        repo: text.min(1),
        number: z.number().int().positive(),
        moveTickets: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    const { moveTickets, ...identity } = key;
    res.json(await prMerge.prepare(identity, moveTickets));
  });
  app.post("/api/pr/merge/:id", async (req, res) => {
    const input = z
      .object({
        tickets: z
          .array(
            z.object({
              id: z.number().int().positive(),
              state: text.min(1).nullable(),
            }),
          )
          .max(100),
        strategy: z.enum(["noFastForward", "squash", "rebase", "rebaseMerge"]),
        bypassPolicy: z.boolean().default(false),
        bypassReason: z.string().trim().max(2000).default(""),
      })
      .strict()
      .parse(req.body);
    res.json(
      await prMerge.execute(
        String(req.params.id),
        input.tickets,
        input.strategy,
        { enabled: input.bypassPolicy, reason: input.bypassReason },
      ),
    );
  });
  app.get("/api/pr/merge/:id", (req, res) =>
    res.json(prMerge.result(String(req.params.id))),
  );
  app.post("/api/pr/tickets", async (req, res) => {
    const input = z
      .object({
        monitor: text.min(1),
        repo: text.min(1),
        number: z.number().int().positive(),
        ticketId: z.number().int().positive(),
        source: z.string().min(1).max(2000),
        action: z.enum(["link", "unlink"]),
      })
      .strict()
      .parse(req.body);
    res.json(await pullRequests.linkTicket(input));
  });
  app.post("/api/pr/review", (req, res) => {
    const input = z
      .object({
        monitor: text.min(1),
        repo: text.min(1),
        number: z.number().int().positive(),
        options: reviewOptionsSchema.optional(),
        restart: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    res.json({
      id: pullRequests.requestReview(
        input.monitor,
        input.repo,
        input.number,
        input.options,
        input.restart,
      ),
    });
  });
  app.get("/api/pr/commits", async (req, res) => {
    const input = z
      .object({
        monitor: text.min(1),
        repo: text.min(1),
        number: z.coerce.number().int().positive(),
        continuationToken: z.string().max(2000).default(""),
      })
      .parse(req.query);
    res.json(
      await pullRequests.commits(
        input.monitor,
        input.repo,
        input.number,
        input.continuationToken,
      ),
    );
  });
  app.get("/api/pr/commit-diff", async (req, res) => {
    const input = z
      .object({
        monitor: text.min(1),
        repo: text.min(1),
        number: z.coerce.number().int().positive(),
        commit: z.string().regex(/^[0-9a-f]{40}$/i),
      })
      .parse(req.query);
    res.json(
      await pullRequests.commitDiff(
        input.monitor,
        input.repo,
        input.number,
        input.commit,
      ),
    );
  });
  app.get("/api/pr/diff", async (req, res) => {
    const input = z
      .object({
        monitor: text.min(1),
        repo: text.min(1),
        number: z.coerce.number().int().positive(),
      })
      .parse(req.query);
    res.json(
      await pullRequests.viewDiff(input.monitor, input.repo, input.number),
    );
  });
  app.post("/api/pr/line-comment", async (req, res) => {
    const input = z.object({
      monitor: text.min(1), repo: text.min(1),
      number: z.number().int().positive(),
      head: z.string().regex(/^[a-f0-9]{40}$/i),
      base: z.string().regex(/^[a-f0-9]{40}$/i),
      target: z.string().regex(/^[a-f0-9]{40}$/i),
      path: z.string().min(2).max(2000).startsWith("/"),
      line: z.number().int().positive(),
      content: z.string().min(1).max(20000).refine((value) => !!value.trim()),
    }).strict().parse(req.body);
    res.json(await pullRequests.commentOnLine(input));
  });
  app.get("/api/pr/line-comments", async (req, res) => {
    const input = z.object({
      monitor: text.min(1), repo: text.min(1), number: z.coerce.number().int().positive(),
      head: z.string().regex(/^[a-f0-9]{40}$/i), base: z.string().regex(/^[a-f0-9]{40}$/i),
    }).parse(req.query);
    res.json(await pullRequests.lineComments(input.monitor, input.repo, input.number, input.head, input.base));
  });
  app.get("/api/pr/image", async (req, res) => {
    const input = z
      .object({
        monitor: text.min(1),
        repo: text.min(1),
        number: z.coerce.number().int().positive(),
        source: z.string().min(1).max(8192),
      })
      .parse(req.query);
    const image = await pullRequests.image(
      input.monitor,
      input.repo,
      input.number,
      input.source,
    );
    res
      .set("Content-Type", image.type)
      .set("Content-Disposition", "inline")
      .set("X-Content-Type-Options", "nosniff")
      .send(image.body);
  });
  app.get("/api/pr/reviews", (req, res) => {
    const input = z
      .object({
        monitor: text.min(1),
        repo: text.min(1),
        number: z.coerce.number().int().positive(),
      })
      .parse(req.query);
    res.json(
      store.db
        .prepare(
          "SELECT * FROM pr_reviews WHERE monitor=? AND repo=? AND number=? ORDER BY created_at DESC,rowid DESC",
        )
        .all(input.monitor, input.repo, input.number),
    );
  });
  app.get("/api/pr", (req, res) => {
    const target =
      req.query.monitor !== undefined
        ? z
            .object({
              monitor: text.min(1),
              repo: text.min(1),
              number: z.coerce.number().int().positive(),
            })
            .parse(req.query)
        : undefined;
    res.json(
      pullRequests.list(
        target ? { client: "", project: "" } : contextSchema.parse(req.query),
        target,
      ),
    );
  });
  let syncing = false;
  async function sync() {
    store.purgeTicketTrash();
    if (syncing) throw new AppError(409, "Синхронизация уже выполняется");
    syncing = true;
    const errors: string[] = [];
    store.set("sync.status", {
      state: "running",
      at: new Date().toISOString(),
    });
    try {
      if (
        store.settings().teamsEnabled &&
        store.get("microsoft.connected", false)
      )
        try {
          await connectors.syncTeams();
        } catch (e) {
          errors.push(
            e instanceof AppError ? e.message : "Ошибка синхронизации Teams",
          );
        }
      if (store.secret("azure.pat"))
        try {
          await connectors.syncTickets(false, true);
        } catch (e) {
          errors.push(
            e instanceof AppError
              ? e.message
              : "Ошибка синхронизации Azure DevOps",
          );
        }
      if (store.secret("azure.pat")) await pullRequests.sync();
      for (const m of pullRequests.monitors() as any[])
        if (m.enabled && m.error) errors.push(`${m.azure_project}: ${m.error}`);
      const result = {
        state: errors.length ? "error" : "ok",
        at: new Date().toISOString(),
        errors,
      };
      store.set("sync.status", result);
      store.audit(errors.length ? "sync.error" : "sync.completed", errors.length ? errors.join("; ") : "Фоновое обновление данных завершено");
      return result;
    } catch (error) {
      const message = error instanceof AppError ? error.message : "Ошибка синхронизации";
      store.set("sync.status", { state: "error", at: new Date().toISOString(), errors: [...errors, message] });
      store.audit("sync.error", [...errors, message].join("; "));
      throw error;
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
      if (!result.ok) {
        const detail = (await result.json().catch(() => ({})))?.detail;
        const messages: Record<string, string> = {
          model_load:
            "Не удалось загрузить голосовую модель. Проверьте доступ voice-контейнера к Hugging Face, VPN, сертификаты и права на /models.",
          transcribe:
            "Ошибка обработки аудио голосовой моделью. Причина записана в логах voice.",
          audio_too_long: "Запись слишком длинная: максимум 150 секунд.",
        };
        const reference =
          typeof detail?.reference === "string" &&
          /^[0-9a-f-]{36}$/.test(detail.reference)
            ? detail.reference
            : "";
        console.error(
          "[voice]",
          JSON.stringify({
            status: result.status,
            code: Object.hasOwn(messages, detail?.code)
              ? detail.code
              : "unknown",
            reference,
          }),
        );
        throw new AppError(
          result.status === 422 ? 422 : 503,
          ((Object.hasOwn(messages, detail?.code)
            ? messages[detail.code]
            : "") ||
            "Не удалось распознать запись. Проверьте логи voice-контейнера.") +
            (reference ? ` Код диагностики: ${reference}` : ""),
        );
      }
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
  return { app, sync, agent, approvals, connectors, pullRequests, codeBrowser };
}
