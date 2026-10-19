import { CompletedPullRequests } from "./CompletedPullRequests.js";
import { LastSync } from "./LastSync.js";
import { TicketMetadata } from "./TicketMetadata.js";
import { TicketTrash } from "./TicketTrash.js";
import { MemoryProposalList } from "./MemoryProposals.js";
import { ReviewQuestionInbox } from "./ReviewQuestions.js";
import { MultiSelect } from "./MultiSelect.js";
import {
  BrowserRouter,
  Link,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { pagePaths, pageForPath, type Page } from "./routing.js";
import {
  useAssistantResize,
  readChatPreference,
  saveChatPreference,
} from "./AssistantResize.js";
import { LocalDeveloper, StatusBadge, TicketStatus } from "./TicketControls.js";
import { ChatMarkdown } from "./ChatMarkdown.js";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowDown,
  ArrowUpDown,
  ArrowUp,
  Activity,
  AudioLines,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  Command,
  ExternalLink,
  GitPullRequest,
  GitMerge,
  Github,
  Inbox,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MessageSquare,
  Mic,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Ticket,
  Trash2,
  X,
  Users,
  Globe,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { api, setCsrf } from "./api.js";
import "./style.css";
import { ContextPicker } from "./ContextPicker.js";
import { PullRequestsPage } from "./PullRequestsPage.js";
import { TicketLookupDialog } from "./TicketLookupDialog.js";
import { TicketCard, TicketTableRow } from "./TicketCard.js";
import { TicketImportSettings } from "./TicketImportSettings.js";
import { Usage } from "./Usage.js";

type Context = { client: string; project: string };
const navigation = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard },
  { id: "inbox", label: "Входящие", icon: Inbox },
  { id: "tickets", label: "Тикеты", icon: Ticket },
  { id: "pullrequests", label: "Pull requests", icon: FolderOpen },
  { id: "approvals", label: "Подтверждения", icon: ShieldCheck },
  { id: "memory", label: "Память", icon: BookOpen },
  { id: "teams", label: "Сообщения Teams", icon: MessageSquare },
  { id: "usage", label: "Использование LLM", icon: Activity },
] as const;
const date = (s?: string) =>
  s
    ? new Date(s).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Ещё не было";
function Mark({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand-mark ${small ? "small" : ""}`}>
      <span />
      <i />
    </div>
  );
}
function Badge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({
  icon: Icon = Inbox,
  title,
  description,
  children,
}: {
  icon?: any;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={25} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function App() {
  const [session, setSession] = useState<any>(null),
    [error, setError] = useState(""),
    [password, setPassword] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    api("/auth/session")
      .then((s) => {
        setSession(s);
        setCsrf(s.csrf || "");
      })
      .catch((e) => setError(e.message));
  }, []);
  async function enter(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const s = await api(
        session.setupRequired ? "/auth/setup" : "/auth/login",
        "POST",
        { password },
      );
      setCsrf(s.csrf);
      setSession(s);
      setPassword("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  if (!session)
    return (
      <div className="loading-page">
        <Mark />
        <p>{error || "Подключаем рабочее пространство…"}</p>
      </div>
    );
  if (!session.authenticated)
    return (
      <div className="login-layout">
        <section className="login-story">
          <div className="brand">
            <Mark />
            <b>
              orbit<span>personal workspace</span>
            </b>
          </div>
          <div>
            <span className="eyebrow">ВАШ КОНТЕКСТ. ПОД ВАШИМ КОНТРОЛЕМ.</span>
            <h1>
              Меньше шума.
              <br />
              Больше ясности.
            </h1>
            <p>
              Сообщения, задачи и важные детали —<br />в одном рабочем
              пространстве.
            </p>
            <div className="orbit-illustration">
              <div className="orbit-ring one" />
              <div className="orbit-ring two" />
              <div className="orbit-core">
                <Sparkles size={33} />
              </div>
              <span className="orbit-node n1">
                <MessageSquare /> Teams
              </span>
              <span className="orbit-node n2">
                <Ticket /> Тикеты
              </span>
              <span className="orbit-node n3">
                <BookOpen /> Память
              </span>
            </div>
          </div>
          <small>
            <ShieldCheck size={16} /> Сообщения отправляются только с вашего
            подтверждения
          </small>
        </section>
        <section className="login-form">
          <div className="login-box">
            <Badge tone="green">
              <span className="dot" /> Локальное приложение
            </Badge>
            <h2>
              {session.setupRequired
                ? "Добро пожаловать в Orbit"
                : "С возвращением"}
            </h2>
            <p>
              {session.setupRequired
                ? "Создайте пароль для своего рабочего пространства. Подключения к рабочим сервисам настроим внутри."
                : "Войдите, чтобы вернуться к сообщениям, задачам и ассистенту."}
            </p>
            <form onSubmit={enter}>
              <Field
                label={
                  session.setupRequired ? "Придумайте пароль" : "Ваш пароль"
                }
                hint={
                  session.setupRequired
                    ? "Не менее 12 символов. Защищает доступ к памяти и подтверждениям."
                    : undefined
                }
              >
                <input
                  type="password"
                  autoComplete={
                    session.setupRequired ? "new-password" : "current-password"
                  }
                  required
                  minLength={session.setupRequired ? 12 : 1}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              </Field>
              {error && (
                <div role="alert" className="error">
                  {error}
                </div>
              )}
              <button className="primary wide" disabled={loading}>
                {loading ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <>
                    {session.setupRequired ? "Создать пространство" : "Войти"}
                    <ArrowUpRight size={18} />
                  </>
                )}
              </button>
            </form>
            <div className="login-note">
              <LockKeyhole size={17} />
              <span>
                Данные хранятся на вашем устройстве.
                <br />
                Вы решаете, что и кому отправлять.
              </span>
            </div>
          </div>
        </section>
      </div>
    );
  return (
    <Workspace
      onLogout={async () => {
        await api("/auth/logout", "POST", {});
        setCsrf("");
        setSession({ authenticated: false, setupRequired: false });
      }}
    />
  );
}
function Workspace({ onLogout }: { onLogout: () => Promise<void> }) {
  const location = useLocation();
  const navigate = useNavigate();
  const page = pageForPath(location.pathname);
  const setPage = (next: Page) =>
    navigate(next === "inbox" ? "/pull-requests?tab=inbox" : pagePaths[next]);
  const completedTab =
    new URLSearchParams(location.search).get("tab") === "completed";
  const inboxTab = new URLSearchParams(location.search).get("tab") === "inbox";
  useEffect(() => {
    if (page === "inbox")
      navigate("/pull-requests?tab=inbox", { replace: true });
  }, [page, navigate]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () =>
      readChatPreference(
        "orbit.sidebar.collapsed",
        String(window.innerWidth <= 800),
      ) === "true",
  );
  useEffect(
    () =>
      saveChatPreference("orbit.sidebar.collapsed", String(sidebarCollapsed)),
    [sidebarCollapsed],
  );
  const [settings, setSettings] = useState<any>(null),
    [overview, setOverview] = useState<any>({}),
    [items, setItems] = useState<any[]>([]),
    [reviewQuestions, setReviewQuestions] = useState<any[]>([]),
    [memoryProposals, setMemoryProposals] = useState<any[]>([]),
    [tickets, setTickets] = useState<any[]>([]),
    [approvals, setApprovals] = useState<any[]>([]),
    [memories, setMemories] = useState<any[]>([]),
    [chats, setChats] = useState<any[]>([]),
    [context, setContext] = useState<Context>({ client: "", project: "" }),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(""),
    [assistantOpen, setAssistantOpen] = useState(
      () =>
        readChatPreference(
          "orbit.chat.open",
          String(window.innerWidth > 800),
        ) === "true",
    ),
    [refresh, setRefresh] = useState(0),
    [query, setQuery] = useState("");
  useEffect(
    () => saveChatPreference("orbit.chat.open", String(assistantOpen)),
    [assistantOpen],
  );
  useEffect(() => {
    setQuery("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname, location.search]);
  useEffect(() => {
    const changed = () => setRefresh((n) => n + 1);
    window.addEventListener("orbit:ticket-state", changed);
    return () => window.removeEventListener("orbit:ticket-state", changed);
  }, []);
  const initialized = useRef(false);
  const loadGeneration = useRef(0);
  async function reload() {
    const generation = ++loadGeneration.current;
    const [o, i, t, a, m, c, rq, mp] = await Promise.all([
      api("/overview"),
      api("/inbox"),
      api("/tickets"),
      api("/approvals"),
      api(`/memories?${new URLSearchParams(context)}`),
      api("/chats"),
      api("/review-questions"),
      api("/memory-proposals"),
    ]);
    if (generation !== loadGeneration.current) return;
    setOverview(o);
    setItems(i);
    setTickets(t);
    setApprovals(a);
    setMemories(m);
    setChats(c);
    setReviewQuestions(rq);
    setMemoryProposals(mp);
  }
  useEffect(() => {
    api("/settings")
      .then((s) => {
        setSettings(s);
        if (!initialized.current) {
          setContext({ client: s.client, project: s.project });
          initialized.current = true;
        }
      })
      .catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    let live = true;
    setMemories([]);
    const tick = () =>
      reload().catch((e) => {
        if (live) setError(e.message);
      });
    tick();
    const id = setInterval(tick, 10000);
    return () => {
      live = false;
      loadGeneration.current++;
      clearInterval(id);
    };
  }, [context, refresh]);
  async function run(key: string, fn: () => Promise<any>, message = "") {
    setBusy(key);
    setError("");
    try {
      const result = await fn();
      setRefresh((n) => n + 1);
      if (message) setNotice(message);
      return result;
    } catch (e: any) {
      setError(e.message);
      return undefined;
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  const pending = approvals.filter((a) => a.status === "pending");
  const connected = [
    !!settings?.githubConnected,
    !!settings?.microsoftConnected,
    !!settings?.azurePatSet && !!settings?.azureUrl && !!settings?.azureProject,
  ];
  const filtered = (arr: any[], keys: string[]) =>
    arr.filter((x) =>
      keys.some((k) =>
        String(x[k] || "")
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    );
  const heading =
    page === "settings"
      ? "Настройки"
      : navigation.find((n) => n.id === page)?.label || "Страница не найдена";
  return (
    <div className={`workspace ${assistantOpen ? "with-assistant" : ""}`}>
      <aside
        className={`sidebar ${sidebarCollapsed ? "sidebar-collapsed" : "sidebar-expanded"}`}
        aria-label="Основная навигация"
      >
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed((value) => !value)}
          aria-expanded={!sidebarCollapsed}
          aria-label={
            sidebarCollapsed ? "Развернуть сайдбар" : "Свернуть сайдбар"
          }
          title={sidebarCollapsed ? "Развернуть сайдбар" : "Свернуть сайдбар"}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={19} />
          ) : (
            <PanelLeftClose size={19} />
          )}
          <span className="sidebar-text">Свернуть меню</span>
        </button>
        <div className="brand">
          <Mark />
          <b>
            orbit<span>personal workspace</span>
          </b>
        </div>
        <div className="workspace-label">
          <span className="avatar">Я</span>
          <div>
            <b>Моё пространство</b>
            <small>Локально · только для вас</small>
          </div>
        </div>
        <div className="nav-title">РАБОЧИЙ ДЕНЬ</div>
        <nav>
          {navigation
            .filter((n) => !["teams", "inbox"].includes(n.id))
            .map((n) => (
              <Link
                key={n.id}
                to={pagePaths[n.id]}
                title={n.label}
                aria-label={n.label}
                aria-current={page === n.id ? "page" : undefined}
                className={page === n.id ? "active" : ""}
              >
                <n.icon size={19} />
                <span className="sidebar-text">{n.label}</span>
                {n.id === "approvals" &&
                  pending.length +
                    memoryProposals.filter((p) => p.status === "pending")
                      .length >
                    0 && (
                    <span className="nav-count">
                      {pending.length +
                        memoryProposals.filter((p) => p.status === "pending")
                          .length}
                    </span>
                  )}
              </Link>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={20} />
            <strong>Последнее слово за вами</strong>
            <p>Предложения в память сохраняются после вашего подтверждения.</p>
          </div>
          <Link
            to={pagePaths.settings}
            title="Настройки"
            aria-label="Настройки"
            aria-current={page === "settings" ? "page" : undefined}
            className={page === "settings" ? "active" : ""}
          >
            <Settings2 size={19} />
            <span className="sidebar-text">Настройки</span>
          </Link>
          <button
            className="sidebar-disabled"
            disabled
            title="Интеграция Teams временно отложена"
            aria-label="Сообщения Teams — недоступно"
          >
            <MessageSquare size={18} />
            <span className="sidebar-text">
              Сообщения Teams<small>Позже</small>
            </span>
          </button>
          <button
            title="Выйти"
            aria-label="Выйти"
            onClick={() => run("logout", onLogout)}
          >
            <LogOut size={18} />
            <span className="sidebar-text">Выйти</span>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Рабочее пространство <ChevronRight size={15} />
            <b>{heading}</b>
          </div>
          <div className="topbar-actions">
            <TicketLookupDialog
              key={`${settings?.azureUrl}:${settings?.azureProject}`}
            />
            <span className="local-label">
              <span className="dot" /> Локально
            </span>
            <button
              className="icon-button"
              title="Подтверждения"
              aria-label="Подтверждения"
              onClick={() => setPage("approvals")}
            >
              <Bell size={18} />
              {(pending.length > 0 ||
                memoryProposals.some((p) => p.status === "pending")) && (
                <i className="notification-dot" />
              )}
            </button>
            <button
              className="icon-button"
              id="assistant-toggle"
              title={assistantOpen ? "Свернуть чат" : "Развернуть чат"}
              aria-label={assistantOpen ? "Свернуть чат" : "Развернуть чат"}
              aria-expanded={assistantOpen}
              aria-controls="assistant-panel"
              onClick={() => setAssistantOpen(!assistantOpen)}
            >
              {assistantOpen ? (
                <PanelRightClose size={19} />
              ) : (
                <PanelRightOpen size={19} />
              )}
            </button>
          </div>
        </header>
        <div className="work-area">
          <main>
            {!page && (
              <div className="empty">
                <h1>Страница не найдена</h1>
                <Link to="/">Перейти к обзору</Link>
              </div>
            )}
            <ContextPicker context={context} onChange={setContext} />
            {error && (
              <div className="error dismissible" role="alert">
                {error}
                <button
                  aria-label="Закрыть ошибку"
                  onClick={() => setError("")}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {notice && (
              <div className="toast" role="status">
                <Check size={17} />
                {notice}
              </div>
            )}
            {page === "overview" && (
              <>
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">ВАШ РАБОЧИЙ ФОКУС</span>
                    <h1>Всё важное — в поле зрения.</h1>
                    <p>
                      Orbit помнит детали, замечает задачи и помогает двигаться
                      дальше.
                    </p>
                  </div>
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() =>
                      run(
                        "sync",
                        () => api("/sync", "POST", {}),
                        "Синхронизация завершена. Статус — ниже.",
                      )
                    }
                  >
                    <RefreshCw
                      size={16}
                      className={busy === "sync" ? "spin" : ""}
                    />
                    Обновить
                  </button>
                </div>
                <div className="stats-grid">
                  {[
                    {
                      label: "Требуют внимания",
                      value: items.length,
                      icon: Inbox,
                      target: "inbox",
                      note: "упоминания тикетов",
                    },
                    {
                      label: "В работе",
                      value: tickets.length,
                      icon: Ticket,
                      target: "tickets",
                      note: "в вашем трекере",
                    },
                    {
                      label: "Ждут решения",
                      value: pending.length,
                      icon: ShieldCheck,
                      target: "approvals",
                      note: "сообщения для отправки",
                    },
                    {
                      label: "В памяти",
                      value: memories.length,
                      icon: BookOpen,
                      target: "memory",
                      note: "в выбранном контексте",
                    },
                  ].map((s) => (
                    <button
                      className="stat-card"
                      key={s.label}
                      onClick={() => setPage(s.target as Page)}
                    >
                      <span>
                        {s.label}
                        <s.icon size={18} />
                      </span>
                      <strong>{s.value.toString().padStart(2, "0")}</strong>
                      <small>
                        {s.note}
                        <ArrowUpRight size={14} />
                      </small>
                    </button>
                  ))}
                </div>
                {!connected.every(Boolean) && (
                  <section className="setup-card">
                    <div className="section-heading">
                      <div>
                        <Badge tone="green">НАЧНЁМ С ОСНОВ</Badge>
                        <h2>Подключите свой рабочий мир</h2>
                        <p>
                          Три подключения, чтобы ассистент видел нужный
                          контекст.
                        </p>
                      </div>
                      <span className="setup-progress">
                        {connected.filter(Boolean).length} / 3
                      </span>
                    </div>
                    <div className="integration-steps">
                      {[
                        {
                          title: "GitHub Copilot",
                          description: "Модель из вашей подписки",
                          icon: Github,
                        },
                        {
                          title: "Microsoft Teams",
                          description: "Сообщения и черновики",
                          icon: MessageSquare,
                        },
                        {
                          title: "Azure DevOps",
                          description: "Тикеты и их статусы",
                          icon: Ticket,
                        },
                      ].map((s, i) => (
                        <button
                          key={s.title}
                          onClick={() => setPage("settings")}
                          className={connected[i] ? "done" : ""}
                        >
                          <div className="integration-icon">
                            <s.icon size={21} />
                          </div>
                          <div>
                            <b>{s.title}</b>
                            <small>{s.description}</small>
                          </div>
                          {connected[i] ? (
                            <Check size={18} />
                          ) : (
                            <ArrowUpRight size={17} />
                          )}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                <div className="dashboard-columns">
                  <section className="panel">
                    <div className="section-heading">
                      <h2>
                        Требует внимания <span>{items.length}</span>
                      </h2>
                      <button
                        className="text-button"
                        onClick={() => setPage("inbox")}
                      >
                        Все входящие <ArrowUpRight size={15} />
                      </button>
                    </div>
                    {items.length ? (
                      <div className="compact-list">
                        {items.slice(0, 4).map((i) => (
                          <button key={i.id} onClick={() => setPage("inbox")}>
                            <span className="ticket-square">
                              <Ticket size={18} />
                            </span>
                            <div>
                              <b>Возможный тикет #{i.ticket_id}</b>
                              <p>{i.excerpt}</p>
                              <small>{i.chat_name}</small>
                            </div>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title="Ничего не потерялось"
                        description="Здесь появятся упоминания тикетов из выбранных чатов Teams."
                      />
                    )}
                  </section>
                  <section className="panel">
                    <div className="section-heading">
                      <h2>Под вашим контролем</h2>
                      <ShieldCheck size={19} />
                    </div>
                    {pending.length ? (
                      <div className="compact-list">
                        {pending.slice(0, 3).map((a) => (
                          <button
                            key={a.id}
                            onClick={() => setPage("approvals")}
                          >
                            <div>
                              <Badge tone="amber">Нужен апрув</Badge>
                              <b>{a.chat_name}</b>
                              <p>{a.body}</p>
                            </div>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        icon={CheckCheck}
                        title="Все решения приняты"
                        description="Когда ассистент подготовит сообщение, здесь появится черновик на проверку."
                      />
                    )}
                    <div className="panel-footer">
                      <LockKeyhole size={14} /> Отправка только после вашего
                      подтверждения
                    </div>
                  </section>
                </div>
                <section className="panel activity-panel">
                  <div className="section-heading">
                    <h2>Последняя активность</h2>
                    <small>Синхронизация: {date(overview.sync?.at)}</small>
                  </div>
                  {overview.sync?.errors?.map((e: string) => (
                    <div key={e} className="error">
                      {e}
                    </div>
                  ))}
                  {overview.activity?.length ? (
                    <div className="activity-list">
                      {overview.activity.slice(0, 5).map((a: any) => (
                        <div key={a.id}>
                          <span className="activity-dot" />
                          <span>
                            {(
                              {
                                "settings.updated": "Настройки сохранены",
                                "memory.saved": "Добавлена запись в память",
                                "message.proposed":
                                  "Подготовлен черновик Teams",
                                "message.approved": "Отправка подтверждена",
                                "message.sent": "Сообщение отправлено",
                                "ticket.state.verified":
                                  "Статус тикета подтверждён",
                                "ticket.state.unconfirmed":
                                  "Смена статуса не подтверждена",
                                "ticket.tracked": "Тикет добавлен в трекер",
                                "github.connected": "GitHub подключён",
                                "teams.connected": "Teams подключён",
                                "message.rejected": "Черновик отклонён",
                                "message.unknown":
                                  "Проверьте результат отправки в Teams",
                              } as any
                            )[a.action] || a.action}
                          </span>
                          <time>{date(a.created_at)}</time>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">
                      Ваша история действий появится здесь.
                    </p>
                  )}
                </section>
              </>
            )}
            {page === "pullrequests" && (
              <nav className="pr-page-tabs" aria-label="Разделы Pull Requests">
                <Link
                  to="/pull-requests"
                  aria-current={!inboxTab && !completedTab ? "page" : undefined}
                >
                  <GitPullRequest size={16} /> Активные
                </Link>
                <Link
                  to="/pull-requests?tab=completed"
                  aria-current={completedTab ? "page" : undefined}
                >
                  <GitMerge size={16} /> Завершённые
                </Link>
                <Link
                  to="/pull-requests?tab=inbox"
                  aria-current={inboxTab ? "page" : undefined}
                >
                  <Inbox size={16} /> Входящие
                  {items.length +
                    reviewQuestions.filter((q) => q.status === "pending")
                      .length >
                    0 && (
                    <span className="nav-count">
                      {items.length +
                        reviewQuestions.filter((q) => q.status === "pending")
                          .length}
                    </span>
                  )}
                </Link>
              </nav>
            )}
            {page === "pullrequests" && completedTab && (
              <CompletedPullRequests
                settings={settings}
                key={JSON.stringify(context)}
                context={context}
              />
            )}
            {page === "pullrequests" && !inboxTab && !completedTab && (
              <PullRequestsPage context={context} settings={settings} />
            )}
            {page === "pullrequests" && inboxTab && (
              <>
                <PageHeading
                  title="Не упустите важное"
                  subtitle="Вопросы ревьюера и задачи, требующие вашего внимания."
                />
                <ReviewQuestionInbox
                  items={reviewQuestions}
                  onChange={() => setRefresh((n) => n + 1)}
                />
                {items.length ? (
                  <div className="card-list">
                    {items.map((i) => (
                      <article className="panel suggestion" key={i.id}>
                        <div className="section-heading">
                          <Badge tone="violet">
                            <MessageSquare size={13} /> {i.chat_name}
                          </Badge>
                          <small>{date(i.created_at)}</small>
                        </div>
                        <h2>Обратите внимание на #{i.ticket_id}</h2>
                        <p className="source-label">{i.sender} написал(а)</p>
                        <blockquote>
                          {i.excerpt || "Упоминание в ссылке на тикет"}
                        </blockquote>
                        <div className="card-actions">
                          <button
                            className="primary"
                            disabled={!!busy}
                            onClick={() =>
                              run(
                                i.id,
                                () =>
                                  api("/tickets", "POST", { id: i.ticket_id }),
                                "Тикет загружен из Azure DevOps",
                              )
                            }
                          >
                            <Plus size={16} />
                            Добавить в трекер
                          </button>
                          <button
                            className="secondary"
                            disabled={!!busy}
                            onClick={() =>
                              run(i.id, () =>
                                api(`/inbox/${i.id}/dismiss`, "POST", {}),
                              )
                            }
                          >
                            Пропустить
                          </button>
                          {i.message_url?.startsWith("https://") && (
                            <a
                              href={i.message_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Открыть Teams <ExternalLink size={14} />
                            </a>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  !reviewQuestions.length && (
                    <Empty
                      icon={Inbox}
                      title="Входящие разобраны"
                      description="Если для ревью потребуется уточнение, здесь появится полный набор вопросов."
                    />
                  )
                )}
              </>
            )}
            {page === "tickets" && (
              <nav className="pr-page-tabs" aria-label="Разделы тикетов">
                <Link
                  to="/tickets"
                  aria-current={
                    new URLSearchParams(location.search).get("tab") !== "trash"
                      ? "page"
                      : undefined
                  }
                >
                  <Ticket size={16} />
                  Тикеты
                </Link>
                <Link
                  to="/tickets?tab=trash"
                  aria-current={
                    new URLSearchParams(location.search).get("tab") === "trash"
                      ? "page"
                      : undefined
                  }
                >
                  <Trash2 size={16} />
                  Корзина
                </Link>
              </nav>
            )}
            {page === "tickets" &&
              new URLSearchParams(location.search).get("tab") === "trash" && (
                <TicketTrash
                  settings={settings}
                  key={`${settings?.azureUrl}|${settings?.azureProject}`}
                  onChange={() => setRefresh((n) => n + 1)}
                />
              )}
            {page === "tickets" &&
              new URLSearchParams(location.search).get("tab") !== "trash" && (
                <Tickets
                  context={context}
                  settings={settings}
                  key={`${settings?.azureUrl}|${settings?.azureProject}|${location.search}`}
                  tickets={tickets}
                  lastSync={overview?.ticketsLastSync}
                  query={query}
                  setQuery={setQuery}
                  run={run}
                  busy={busy}
                />
              )}
            {page === "approvals" && (
              <>
                <PageHeading
                  title="Подтверждения"
                  subtitle="Проверьте предложения ассистента перед сохранением в память или отправкой сообщения."
                />
                <MemoryProposalList
                  items={memoryProposals}
                  onChange={() => setRefresh((n) => n + 1)}
                />
                {approvals.length ? (
                  <div className="card-list">
                    {approvals.map((a) => (
                      <article className="panel approval" key={a.id}>
                        <div className="section-heading">
                          <div className="recipient">
                            <span className="integration-icon">
                              <MessageSquare size={20} />
                            </span>
                            <div>
                              <small>ПОЛУЧАТЕЛЬ · TEAMS</small>
                              <b>{a.chat_name}</b>
                              <code>{a.chat_id}</code>
                            </div>
                          </div>
                          <Badge
                            tone={
                              a.status === "pending"
                                ? "amber"
                                : a.status === "sent"
                                  ? "green"
                                  : "muted"
                            }
                          >
                            {
                              (
                                {
                                  pending: "Ожидает решения",
                                  sent: "Отправлено",
                                  rejected: "Отклонено",
                                  expired: "Истёк срок",
                                  sending: "Отправляется",
                                  unknown: "Проверьте Teams",
                                } as any
                              )[a.status]
                            }
                          </Badge>
                        </div>
                        <div className="draft-body">{a.body}</div>
                        {a.error && <div className="error">{a.error}</div>}
                        <div className="card-actions">
                          {a.status === "pending" ? (
                            <>
                              <button
                                className="primary"
                                disabled={!!busy}
                                onClick={() =>
                                  run(
                                    a.id,
                                    () =>
                                      api(
                                        `/approvals/${a.id}/approve`,
                                        "POST",
                                        {},
                                      ),
                                    "Сообщение отправлено в Teams",
                                  )
                                }
                              >
                                <Send size={16} />
                                Подтвердить и отправить
                              </button>
                              <button
                                className="secondary"
                                disabled={!!busy}
                                onClick={() =>
                                  run(
                                    a.id,
                                    () =>
                                      api(
                                        `/approvals/${a.id}/reject`,
                                        "POST",
                                        {},
                                      ),
                                    "Черновик отклонён",
                                  )
                                }
                              >
                                <X size={16} />
                                Отклонить
                              </button>
                              <small>Действует до {date(a.expires_at)}</small>
                            </>
                          ) : (
                            <small>
                              Создано {date(a.created_at)}{" "}
                              {a.remote_id && `· ID Teams: ${a.remote_id}`}
                            </small>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </>
            )}
            {page === "memory" && (
              <Memory
                memories={memories}
                context={context}
                run={run}
                busy={busy}
              />
            )}
            {page === "teams" && <Teams chats={chats} run={run} busy={busy} />}
            {page === "usage" && (
              <Usage onSettings={() => setPage("settings")} />
            )}
            {page === "settings" && settings && (
              <Settings
                settings={settings}
                context={context}
                run={run}
                busy={busy}
              />
            )}
            <footer className="main-footer">
              <span>
                orbit <span className="footer-dot">·</span> пространство для
                ясности
              </span>
              <span>
                <LockKeyhole size={12} /> На вашем устройстве
              </span>
            </footer>
          </main>
          <Assistant
            open={assistantOpen}
            onCollapse={() => {
              setAssistantOpen(false);
              document.getElementById("assistant-toggle")?.focus();
            }}
            context={context}
            connected={settings?.githubConnected}
            onChange={() => setRefresh((n) => n + 1)}
            onSettings={() => setPage("settings")}
            onApprovals={() => setPage("approvals")}
            pending={pending.length}
          />
        </div>
      </div>
    </div>
  );
}
function PageHeading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
function Tickets({
  tickets,
  lastSync,
  query,
  setQuery,
  run,
  busy,
  settings,
  context,
}: any) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const rawTarget = params.get("id");
  const targetId =
    rawTarget &&
    /^[1-9][0-9]*$/.test(rawTarget) &&
    Number.isSafeInteger(Number(rawTarget))
      ? Number(rawTarget)
      : null;
  const targetSource = params.get("source");
  const currentSource = `${(settings?.azureUrl || "").replace(/\/$/, "")}|${settings?.azureProject || ""}`;
  const sourceMismatch =
    !!targetSource && !!settings && targetSource !== currentSource;
  const [id, setId] = useState(targetId ? String(targetId) : "");
  const [sort, setSort] = useState("id-desc");
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const values = (key: string) =>
    [...new Set<string>(tickets.map((t: any) => t[key] || ""))].sort((a, b) =>
      a.localeCompare(b, "ru"),
    );
  const localDevelopers = [
    ...new Map<string, string>(
      tickets.flatMap((t: any) =>
        (t.developers || []).map((d: any) => [d.id, d.name]),
      ),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  const filteredTickets = tickets.filter((t: any) => {
    if (rawTarget) return !sourceMismatch && t.id === targetId;
    const matchesQuery = [
      "id",
      "title",
      "type",
      "state",
      "assigned",
      "developer_name",
      "notes",
      "tags",
    ].some((key) =>
      String(t[key] || "")
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    );
    const people = assigneeFilter.map((value) => JSON.parse(value));
    return (
      matchesQuery &&
      (!priorityFilter.length ||
        priorityFilter.includes(String(t.priority ?? 1))) &&
      (!tagFilter.length ||
        tagFilter.some((tag) =>
          tag === "" ? !t.tags?.length : t.tags?.includes(tag),
        )) &&
      (!typeFilter.length || typeFilter.includes(t.type || "")) &&
      (!stateFilter.length || stateFilter.includes(t.state || "")) &&
      (!people.length ||
        people.some((person) =>
          person[0] === "azure"
            ? (t.assigned || "") === person[1]
            : person[1]
              ? (t.developers || []).some((d: any) => d.id === person[1])
              : !(t.developers || []).length,
        ))
    );
  });
  const [sortKey, sortDirection] = sort.split("-");
  const sortButton = (key: string, label: string) => (
    <button
      type="button"
      className={`ticket-column-sort${sortKey === key ? " is-active" : ""}`}
      aria-label={`Сортировать: ${label}, ${sortKey === key && sortDirection === "asc" ? "по убыванию" : "по возрастанию"}`}
      onClick={() =>
        setSort(
          `${key}-${sortKey === key && sortDirection === "asc" ? "desc" : "asc"}`,
        )
      }
    >
      <span>{label}</span>
      {sortKey === key ? (
        sortDirection === "asc" ? (
          <ArrowUp size={13} />
        ) : (
          <ArrowDown size={13} />
        )
      ) : (
        <ArrowUpDown size={13} />
      )}
    </button>
  );
  const columnSort = (keys: string[]): "ascending" | "descending" | "none" =>
    keys.includes(sortKey)
      ? sortDirection === "asc"
        ? "ascending"
        : "descending"
      : "none";
  const sorted = [...filteredTickets].sort((a, b) => {
    const [key, direction] = sort.split("-");
    const cmp =
      key === "id"
        ? a.id - b.id
        : String(a[key] || "").localeCompare(String(b[key] || ""), "ru", {
            numeric: true,
          });
    return (direction === "desc" ? -cmp : cmp) || a.id - b.id;
  });
  return (
    <>
      <PageHeading
        title="Ваши тикеты"
        subtitle="Актуальный статус из Azure DevOps. Данные обновляются в фоне."
      />
      <LastSync at={lastSync} />
      {rawTarget && (
        <div className="ticket-target-notice" role="status">
          <p>
            {!targetId
              ? "Некорректный номер тикета в ссылке."
              : sourceMismatch
                ? "Этот тикет относится к другому подключению Azure. Выберите соответствующее подключение в настройках."
                : `Показан тикет #${targetId} из ссылки. Если его ещё нет в локальном списке, добавьте по номеру ниже.`}
          </p>
          <Link to="/tickets">Показать все тикеты</Link>
        </div>
      )}
      <div className="toolbar">
        <label className="search">
          <Search size={17} />
          <input
            placeholder="Номер, название, исполнитель…"
            disabled={!!rawTarget}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          className="secondary"
          disabled={!!busy}
          onClick={() =>
            run(
              "import",
              () => api("/tickets/import", "POST", {}),
              "Ваши тикеты импортированы",
            )
          }
        >
          <RefreshCw size={15} />
          Импортировать мои
        </button>
      </div>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            "track",
            () => api("/tickets", "POST", { id: Number(id) }),
            "Тикет добавлен",
          );
        }}
      >
        <input
          type="number"
          min="1"
          required
          placeholder="Номер тикета"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <button className="primary" disabled={!!busy || sourceMismatch}>
          <Plus size={16} />
          Добавить по номеру
        </button>
      </form>
      <div className="ticket-filters">
        <MultiSelect
          label="Приоритет"
          placeholder="Все приоритеты"
          value={priorityFilter}
          onChange={setPriorityFilter}
          disabled={!!rawTarget}
          options={[
            ...new Set<number>(tickets.map((t: any) => t.priority ?? 1)),
          ]
            .sort((a, b) => a - b)
            .map((v) => ({ value: String(v), label: "P" + v }))}
        />
        <MultiSelect
          label="Теги"
          placeholder="Все теги"
          value={tagFilter}
          onChange={setTagFilter}
          disabled={!!rawTarget}
          options={[
            { value: "", label: "Без тегов" },
            ...[...new Set<string>(tickets.flatMap((t: any) => t.tags || []))]
              .sort()
              .map((v) => ({ value: v, label: v })),
          ]}
        />

        <MultiSelect
          label="Тип задачи"
          placeholder="Все типы"
          disabled={!!rawTarget}
          value={typeFilter}
          onChange={setTypeFilter}
          options={values("type").map((value) => ({
            value,
            label: value || "Тип не указан",
          }))}
        />
        <MultiSelect
          label="Статус"
          placeholder="Все статусы"
          disabled={!!rawTarget}
          value={stateFilter}
          onChange={setStateFilter}
          options={values("state").map((value) => ({
            value,
            label: value || "Статус не указан",
          }))}
        />
        <MultiSelect
          label="Исполнитель"
          placeholder="Все исполнители"
          disabled={!!rawTarget}
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          options={[
            ...values("assigned").map((name) => ({
              value: JSON.stringify(["azure", name]),
              label: name || "Не назначен в Azure",
              group: "Назначен в Azure",
            })),
            {
              value: JSON.stringify(["local", ""]),
              label: "Нет локального поручения",
              group: "Локальное поручение",
            },
            ...localDevelopers.map(([id, name]) => ({
              value: JSON.stringify(["local", id]),
              label: name,
              group: "Локальное поручение",
            })),
          ]}
        />
        <button
          className="secondary"
          disabled={
            !rawTarget &&
            !priorityFilter.length &&
            !tagFilter.length &&
            !typeFilter.length &&
            !stateFilter.length &&
            !assigneeFilter.length &&
            !query
          }
          onClick={() => {
            if (rawTarget) navigate("/tickets");
            setPriorityFilter([]);
            setTagFilter([]);
            setTypeFilter([]);
            setStateFilter([]);
            setAssigneeFilter([]);
            setQuery("");
          }}
        >
          Сбросить фильтры
        </button>
      </div>
      <p className="muted" role="status">
        Показано {sorted.length} из {tickets.length}
      </p>
      <p className="muted">
        Удаление и локальное поручение не изменяют Azure. Удалённый тикет можно
        вернуть кнопкой «Добавить по номеру».
      </p>
      {sorted.length ? (
        <div className="panel ticket-table-fit">
          <table>
            <thead>
              <tr>
                <th aria-sort={columnSort(["id", "title"])}>
                  <div className="ticket-heading-sorts">
                    {sortButton("id", "ID")}
                    <span aria-hidden="true">/</span>
                    {sortButton("title", "Тикет")}
                  </div>
                </th>
                {(
                  [
                    ["type", "Тип задачи"],
                    ["state", "Статус"],
                    ["priority", "Приоритет"],
                    ["tags", "Теги"],
                    ["assigned", "Исполнитель в Azure"],
                    ["developer_name", "Локальное поручение"],
                    ["synced_at", "Синхронизация"],
                  ] as const
                ).map(([key, label]) => (
                  <th key={key} aria-sort={columnSort([key])}>
                    {sortButton(key, label)}
                  </th>
                ))}
                <th>Просмотр</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t: any) => (
                <TicketTableRow
                  key={`${t.source}:${t.id}`}
                  id={t.id}
                  columns={9}
                  actions={
                    <TicketMetadata
                      ticket={t}
                      context={context}
                      field="notes"
                      onChange={() => run("refresh-notes", async () => {})}
                    />
                  }
                  highlighted={targetId === t.id && !sourceMismatch}
                  onRemove={() =>
                    run(
                      "remove",
                      () => api(`/tickets/${t.id}`, "DELETE"),
                      "Тикет перемещён в корзину на 30 дней",
                    )
                  }
                >
                  <td>
                    <a
                      className="ticket-link"
                      href={t.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      #{t.id}
                      <ArrowUpRight size={13} />
                    </a>
                    <b className="ticket-title-clamp" title={t.title}>
                      {t.title}
                    </b>
                  </td>
                  <td>
                    <StatusBadge
                      state={t.type || "Тип не указан"}
                      colors={settings?.typeColors}
                      kind="type"
                    />
                  </td>
                  <td>
                    <TicketStatus
                      id={t.id}
                      source={t.source}
                      state={t.state}
                      colors={settings?.statusColors}
                      onChange={() => run("refresh-state", async () => {})}
                    />
                  </td>
                  <td>
                    <TicketMetadata
                      ticket={t}
                      context={context}
                      field="priority"
                      onChange={() => run("refresh-priority", async () => {})}
                    />
                  </td>
                  <td>
                    <TicketMetadata
                      ticket={t}
                      context={context}
                      field="tags"
                      onChange={() => run("refresh-tags", async () => {})}
                    />
                  </td>
                  <td>{t.assigned || "Не назначен"}</td>
                  <td>
                    <LocalDeveloper
                      ticket={t}
                      context={context}
                      onChange={() => run("refresh-local", async () => {})}
                    />
                  </td>
                  <td className="muted">{date(t.synced_at)}</td>
                </TicketTableRow>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          icon={Ticket}
          title={tickets.length ? "Ничего не найдено" : "Трекер пока пуст"}
          description={
            tickets.length
              ? "Измените фильтры или поисковый запрос, либо нажмите «Сбросить фильтры»."
              : "Добавьте тикет по номеру, импортируйте назначенные вам задачи или выберите упоминание во Входящих."
          }
        />
      )}
    </>
  );
}
function Memory({ memories, context, run, busy }: any) {
  const [scope, setScope] = useState("general"),
    [body, setBody] = useState("");
  const labels: any = {
    general: "Общая",
    client: "Заказчик",
    project: "Проект",
  };
  return (
    <>
      <PageHeading
        title="Важное остаётся с вами"
        subtitle="Память доступна ассистенту с учётом выбранного заказчика и проекта."
      />
      <div className="memory-scopes">
        {[
          {
            id: "general",
            icon: Globe,
            title: "Общая",
            description: "Ваши предпочтения и важные тезисы",
          },
          {
            id: "client",
            icon: Users,
            title: "Заказчик",
            description: context.client || "Выберите заказчика сверху",
          },
          {
            id: "project",
            icon: FolderOpen,
            title: "Проект",
            description: context.project || "Выберите проект сверху",
          },
        ].map((s) => (
          <button
            className={scope === s.id ? "selected" : ""}
            key={s.id}
            onClick={() => setScope(s.id)}
          >
            <s.icon size={21} />
            <b>{s.title}</b>
            <small>{s.description}</small>
          </button>
        ))}
      </div>
      <form
        className="panel memory-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            "memory",
            async () => {
              await api("/memories", "POST", { scope, body, context });
              setBody("");
            },
            "Сохранено в память",
          );
        }}
      >
        <Field label={`Запомнить · ${labels[scope]}`}>
          <textarea
            placeholder="Например: по этому проекту договорились отправлять статус каждую пятницу…"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            maxLength={8000}
          />
        </Field>
        <button
          className="primary"
          disabled={
            !!busy ||
            (scope !== "general" && !context.client) ||
            (scope === "project" && !context.project)
          }
        >
          <Plus size={16} />
          Сохранить
        </button>
      </form>
      <div className="memory-grid">
        {memories.map((m: any) => (
          <article className="panel memory-note" key={m.id}>
            <div className="section-heading">
              <Badge
                tone={
                  m.scope === "general"
                    ? "green"
                    : m.scope === "client"
                      ? "violet"
                      : "amber"
                }
              >
                {labels[m.scope]}
                {m.project
                  ? ` · ${m.project}`
                  : m.client
                    ? ` · ${m.client}`
                    : ""}
              </Badge>
              <button
                className="icon-button"
                title="Удалить запись"
                aria-label="Удалить запись"
                disabled={!!busy}
                onClick={() =>
                  run(
                    m.id,
                    () => api(`/memories/${m.id}`, "DELETE"),
                    "Запись удалена",
                  )
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
            <p>{m.body}</p>
            {(typeof m.cards === "string"
              ? JSON.parse(m.cards)
              : m.cards || []
            ).map((ref: string) => (
              <TicketCard key={ref} reference={ref} />
            ))}
            <small>{date(m.created_at)}</small>
          </article>
        ))}
      </div>
      {!memories.length && (
        <Empty
          icon={BookOpen}
          title="Начните с одной важной детали"
          description="Добавьте запись здесь или скажите ассистенту: «Запомни для этого проекта…»."
        />
      )}
    </>
  );
}
function Teams({ chats, run, busy }: any) {
  const [chatId, setChatId] = useState(""),
    [body, setBody] = useState(""),
    [messages, setMessages] = useState<any[]>([]);
  useEffect(() => {
    setMessages([]);
    if (chatId)
      api(`/chats/${encodeURIComponent(chatId)}/messages`)
        .then(setMessages)
        .catch(() => {});
  }, [chatId, chats]);
  return (
    <>
      <PageHeading
        title="На связи, без лишнего шума"
        subtitle="Отметьте чаты для наблюдения. При первом подключении загрузятся последние 50 сообщений."
      >
        <button
          className="secondary"
          disabled={!!busy}
          onClick={() =>
            run(
              "chats",
              () => api("/chats/refresh", "POST", {}),
              "Список чатов обновлён",
            )
          }
        >
          <RefreshCw size={16} />
          Загрузить чаты
        </button>
      </PageHeading>
      {!chats.length ? (
        <Empty
          icon={MessageSquare}
          title="Подключите Microsoft Teams"
          description="После входа в настройках нажмите «Загрузить чаты» и выберите нужные. Поддерживаются личные и групповые чаты."
        />
      ) : (
        <>
          <div className="panel chat-list">
            {chats.map((c: any) => (
              <div className="chat-row" key={c.id}>
                <button
                  className={`toggle ${c.watched ? "on" : ""}`}
                  aria-label={`Наблюдать: ${c.name}`}
                  aria-pressed={!!c.watched}
                  disabled={!!busy}
                  onClick={() =>
                    run(c.id, () =>
                      api(`/chats/${encodeURIComponent(c.id)}`, "PUT", {
                        watched: !c.watched,
                      }),
                    )
                  }
                >
                  <span />
                </button>
                <button className="chat-select" onClick={() => setChatId(c.id)}>
                  <b>{c.name}</b>
                  <small>
                    {c.watched
                      ? `Наблюдаем · ${date(c.synced_at)}`
                      : "Наблюдение выключено"}
                  </small>
                </button>
                <ChevronRight size={16} />
              </div>
            ))}
          </div>
          <div className="panel compose-panel">
            <h2>Подготовить сообщение</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  "draft",
                  async () => {
                    await api("/approvals", "POST", { chatId, body });
                    setBody("");
                  },
                  "Черновик создан. Откройте «Подтверждения».",
                );
              }}
            >
              <Field label="Получатель">
                <select
                  required
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                >
                  <option value="">Выберите чат</option>
                  {chats.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Текст сообщения">
                <textarea
                  required
                  rows={4}
                  maxLength={12000}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Сообщение сначала попадёт на подтверждение…"
                />
              </Field>
              <button className="primary" disabled={!!busy}>
                <ShieldCheck size={16} />
                Создать черновик на проверку
              </button>
            </form>
          </div>
          {chatId && (
            <section className="panel">
              <div className="section-heading">
                <h2>Последние сообщения</h2>
                <Badge>Локальная копия</Badge>
              </div>
              {messages.length ? (
                <div className="message-list">
                  {messages.map((m) => (
                    <article key={m.id}>
                      <div>
                        <b>{m.sender}</b>
                        <time>{date(m.created_at)}</time>
                      </div>
                      <p>
                        {m.body || "Сообщение удалено или не содержит текста"}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty
                  title="Сообщений пока нет"
                  description="Включите наблюдение за чатом и запустите синхронизацию из Обзора."
                />
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
function Settings({ settings, context, run, busy }: any) {
  const [form, setForm] = useState<any>({ ...settings, azurePat: "" }),
    [githubFlow, setGithubFlow] = useState<any>(null),
    [msFlow, setMsFlow] = useState<any>(null),
    [models, setModels] = useState<any[]>([]),
    [modelsLoading, setModelsLoading] = useState(false),
    [connectionError, setConnectionError] = useState("");
  useEffect(() => {
    if (!settings.githubConnected && githubFlow?.status !== "connected") return;
    let active = true;
    setModelsLoading(true);
    api("/copilot/models")
      .then((value) => {
        if (active) {
          setModels(value);
          setConnectionError("");
        }
      })
      .catch((e) => {
        if (active) setConnectionError(e.message);
      })
      .finally(() => {
        if (active) setModelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [settings.githubConnected, githubFlow?.status]);
  const set = (key: string, value: any) =>
    setForm((f: any) => ({ ...f, [key]: value }));
  async function save() {
    const { githubConnected, microsoftConnected, azurePatSet, ...values } =
      form;
    await api("/settings", "PUT", {
      ...values,
      client: context.client,
      project: context.project,
    });
    set("azurePat", "");
  }
  useEffect(() => {
    if (githubFlow?.status !== "pending") return;
    const t = setInterval(() => {
      api("/connect/github/poll", "POST", {})
        .then(setGithubFlow)
        .catch((e) => setConnectionError(e.message));
    }, 6000);
    return () => clearInterval(t);
  }, [githubFlow?.status]);
  useEffect(() => {
    if (msFlow?.status !== "pending") return;
    const t = setInterval(() => {
      api("/connect/microsoft")
        .then(setMsFlow)
        .catch((e) => setConnectionError(e.message));
    }, 3000);
    return () => clearInterval(t);
  }, [msFlow?.status]);
  useEffect(() => {
    if (githubFlow?.status === "connected" || msFlow?.status === "connected")
      run("connected", () => Promise.resolve(), "Подключение сохранено");
  }, [githubFlow?.status, msFlow?.status]);
  return (
    <>
      <PageHeading
        title="Настройте Orbit под себя"
        subtitle="Подключения, предпочтения и правила вашего рабочего пространства."
      />
      <div className="settings-stack">
        <section className="panel settings-card">
          <div className="section-heading">
            <h2>
              <Github size={22} />
              GitHub Copilot
            </h2>
            <Badge tone={settings.githubConnected ? "green" : "muted"}>
              {settings.githubConnected ? "Вход выполнен" : "Не подключён"}
            </Badge>
          </div>
          <p>
            Модель работает через официальный Copilot SDK с вашей подпиской.
            Доступ зависит от политики вашей организации.
          </p>
          <p>
            Нажмите «Войти через GitHub», откройте ссылку и введите одноразовый
            код. На странице GitHub подтвердите вход GitHub CLI. Создавать OAuth
            App не нужно.
          </p>
          <details>
            <summary>
              <LockKeyhole size={17} aria-hidden="true" />
              Дополнительно: собственное OAuth-приложение
            </summary>
            <Field
              label="Client ID (необязательно)"
              hint="Оставьте пустым для входа через GitHub CLI. Для собственного приложения включите Device Flow."
            >
              <input
                value={form.githubClientId}
                onChange={(e) => set("githubClientId", e.target.value)}
                autoComplete="off"
              />
            </Field>
          </details>
          <div className="card-actions">
            <button
              className="secondary"
              disabled={!!busy || githubFlow?.status === "pending"}
              onClick={() =>
                run("github", async () => {
                  await save();
                  setGithubFlow(await api("/connect/github", "POST", {}));
                })
              }
            >
              <Github size={16} />
              Войти через GitHub
            </button>
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() =>
                run(
                  "models",
                  async () => {
                    await save();
                    setModels(await api("/copilot/models"));
                    setConnectionError("");
                  },
                  "Copilot доступен; список моделей получен",
                )
              }
            >
              Проверить и загрузить модели
            </button>
          </div>
          <LoginCode flow={githubFlow} />
          {modelsLoading && <p role="status">Загружаем доступные модели…</p>}
          <Field
            label="Лимит ручных PR-ревью за 24 часа"
            hint="Общий лимит для всех проектов. По умолчанию 20; оставшиеся PR ждут в очереди. Токены учитываются в разделе использования LLM."
          >
            <input
              type="number"
              min={1}
              max={100}
              value={form.prDailyLimit}
              onChange={(e) => set("prDailyLimit", Number(e.target.value))}
            />
          </Field>
          {(["model", "reviewModel"] as const).map((key) => (
            <Field
              key={key}
              label={key === "model" ? "Модель чата" : "Модель PR-ревью"}
              hint="Выберите доступную модель и сохраните настройки. Список загружается после входа; его можно обновить кнопкой выше."
            >
              <select
                value={form[key] || ""}
                onChange={(e) => set(key, e.target.value)}
                aria-label={key === "model" ? "Модель чата" : "Модель PR-ревью"}
                disabled={modelsLoading}
              >
                <option value="">
                  {key === "model"
                    ? "По умолчанию в Copilot"
                    : "Та же, что для чата"}
                </option>
                {form[key] && !models.some((m) => m.id === form[key]) && (
                  <option value={form[key]} disabled>
                    {form[key]} — сохранена, доступность не подтверждена
                  </option>
                )}
                {models.map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </section>
        <section className="panel settings-card">
          <div className="section-heading">
            <h2>
              <MessageSquare size={22} />
              Microsoft Teams
            </h2>
            <Badge tone={settings.microsoftConnected ? "green" : "muted"}>
              {settings.microsoftConnected ? "Вход выполнен" : "Не подключён"}
            </Badge>
          </div>
          <p>
            Зарегистрируйте приложение в Microsoft Entra ID и включите public
            client flows. Делегированные разрешения: <code>Chat.Read</code>,{" "}
            <code>ChatMessage.Send</code>, <code>User.Read</code>. Компания
            может требовать согласие администратора.
          </p>
          <div className="form-grid">
            <Field label="Tenant ID">
              <input
                value={form.microsoftTenantId}
                onChange={(e) => set("microsoftTenantId", e.target.value)}
                placeholder="ID корпоративного каталога"
              />
            </Field>
            <Field label="Application (Client) ID">
              <input
                value={form.microsoftClientId}
                onChange={(e) => set("microsoftClientId", e.target.value)}
                placeholder="ID приложения Microsoft Entra"
              />
            </Field>
          </div>
          <button
            className="secondary"
            disabled={!!busy || msFlow?.status === "pending"}
            onClick={() =>
              run("microsoft", async () => {
                await save();
                setMsFlow(await api("/connect/microsoft", "POST", {}));
              })
            }
          >
            <MessageSquare size={16} />
            Войти через Microsoft
          </button>
          <label className="check-option">
            <input
              type="checkbox"
              checked={form.teamsEnabled}
              onChange={(e) => set("teamsEnabled", e.target.checked)}
            />{" "}
            Читать Teams в фоне (по умолчанию выключено)
          </label>
          <p className="muted">
            Teams необязателен: задачи и PR работают напрямую с Azure DevOps.
          </p>
          <LoginCode flow={msFlow} />
          <div className="inline-note">
            <ShieldCheck size={17} />
            Разрешение API не отменяет подтверждение каждого сообщения в Orbit.
          </div>
        </section>
        <section className="panel settings-card">
          <div className="section-heading">
            <h2>
              <Ticket size={22} />
              Azure DevOps
            </h2>
            <Badge tone={settings.azurePatSet ? "green" : "muted"}>
              {settings.azurePatSet ? "PAT сохранён" : "Не настроен"}
            </Badge>
          </div>
          <Field
            label="URL организации или коллекции"
            hint="Services: https://dev.azure.com/организация. Server: HTTPS-адрес до коллекции, без проекта. Адрес браузерного прокси *.mcas.ms может возвращать страницу входа вместо API."
          >
            <input
              type="url"
              value={form.azureUrl}
              onChange={(e) => set("azureUrl", e.target.value)}
              placeholder="https://devops.company.com/DefaultCollection"
            />
          </Field>
          <div className="form-grid">
            <Field
              label="Название проекта в Azure DevOps"
              hint="Именно Project, содержащий Boards и Repos, а не название Git-репозитория. В одном проекте может быть несколько репозиториев."
            >
              <input
                value={form.azureProject}
                onChange={(e) => set("azureProject", e.target.value)}
                placeholder="Точное имя проекта"
              />
            </Field>
            <Field label="Версия REST API">
              <input
                value={form.azureVersion}
                onChange={(e) => set("azureVersion", e.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Personal Access Token"
            hint="Для чтения задач — Work Items (Read), для смены статусов — Work Items (Read & write). Для PR также Code (Read). Пустое поле сохраняет текущий ключ. Токен не возвращается в браузер."
          >
            <input
              type="password"
              autoComplete="new-password"
              value={form.azurePat}
              onChange={(e) => set("azurePat", e.target.value)}
              placeholder={
                settings.azurePatSet
                  ? "Ключ сохранён · введите новый для замены"
                  : "Вставьте PAT"
              }
            />
          </Field>
          <TicketImportSettings form={form} set={set} save={save} />
        </section>
        <section className="panel settings-card">
          <h2>
            <Sparkles size={22} />
            Как вам помогать
          </h2>
          <Field
            label="Инструкции ассистенту"
            hint="Предпочтения дополняют системные правила. Отключить обязательное подтверждение отправки здесь нельзя."
          >
            <textarea
              rows={5}
              value={form.instructions}
              maxLength={12000}
              onChange={(e) => set("instructions", e.target.value)}
            />
          </Field>
          <div className="form-grid">
            <Field
              label="Лимит времени ответа, секунд"
              hint="От 15 до 600 секунд. При превышении приложение отменяет запрос и завершает runtime."
            >
              <input
                type="number"
                min="15"
                max="600"
                value={form.llmTimeoutSeconds}
                onChange={(e) =>
                  set("llmTimeoutSeconds", Number(e.target.value))
                }
              />
            </Field>
            <Field
              label="Максимум вызовов инструментов на запрос"
              hint="Прерывает повторяющиеся циклы чтения данных или создания черновиков."
            >
              <input
                type="number"
                min="1"
                max="100"
                value={form.llmMaxToolCalls}
                onChange={(e) => set("llmMaxToolCalls", Number(e.target.value))}
              />
            </Field>
          </div>
          <Field
            label="Порог входных + выходных токенов на запрос"
            hint="От 1 000 до 1 000 000. Проверяется после получения отчёта SDK; возможен перерасход за уже выполненный вызов. Это не жёсткий платёжный лимит."
          >
            <input
              type="number"
              min="1000"
              max="1000000"
              value={form.llmMaxTokens}
              onChange={(e) => set("llmMaxTokens", Number(e.target.value))}
            />
          </Field>
          <Field
            label="Обновлять Teams, тикеты и PR каждые, минут"
            hint="По умолчанию — 10 минут. Можно выбрать от 1 до 60 минут, например 5 или 10. Отсчёт начинается после завершения предыдущего прохода. Новый интервал применяется при следующем планировании; перезапуск не нужен."
          >
            <input
              type="number"
              min="1"
              max="60"
              step="any"
              list="sync-intervals"
              value={form.syncSeconds / 60}
              onChange={(e) =>
                set("syncSeconds", Math.round(Number(e.target.value) * 60))
              }
            />
            <datalist id="sync-intervals">
              <option value="5" />
              <option value="10" />
              <option value="15" />
              <option value="30" />
              <option value="60" />
            </datalist>
          </Field>
          <div className="inline-note">
            <AudioLines size={18} />
            <span>
              Голос распознаётся локально контейнером Whisper. Первая запись
              запускает загрузку модели. Распознанный текст можно
              отредактировать перед отправкой.
            </span>
          </div>
        </section>
        {connectionError && <div className="error">{connectionError}</div>}
        <div className="save-bar">
          <span>
            <LockKeyhole size={16} /> Ключи зашифрованы на сервере
          </span>
          <button
            className="primary"
            disabled={!!busy}
            onClick={() => run("save", save, "Настройки сохранены")}
          >
            <Check size={17} />
            Сохранить настройки
          </button>
        </div>
      </div>
    </>
  );
}
function LoginCode({ flow }: any) {
  if (!flow) return null;
  if (flow.status === "pending" && !flow.userCode)
    return <p role="status">Запрашиваем код входа…</p>;
  if (flow.status === "pending")
    return (
      <div className="device-code">
        <p>Откройте страницу авторизации и введите код:</p>
        <strong>{flow.userCode}</strong>
        <a
          href={
            flow.verificationUri?.startsWith("https://")
              ? flow.verificationUri
              : undefined
          }
          target="_blank"
          rel="noreferrer"
        >
          Открыть авторизацию <ExternalLink size={15} />
        </a>
        <small>
          <LoaderCircle className="spin" size={13} />
          Ожидаем завершения входа…
        </small>
      </div>
    );
  return (
    <div className={flow.status === "connected" ? "success-note" : "error"}>
      {flow.status === "connected"
        ? "Вход выполнен."
        : flow.error || "Код истёк. Запустите вход заново."}
    </div>
  );
}
function Assistant({
  open,
  onCollapse,
  context,
  connected,
  onChange,
  onSettings,
  onApprovals,
  pending,
}: any) {
  const resize = useAssistantResize();
  const [history, setHistory] = useState<any[]>([]),
    [prompt, setPrompt] = useState(""),
    [working, setWorking] = useState(false),
    [clearing, setClearing] = useState(false),
    [error, setError] = useState(""),
    [recording, setRecording] = useState(false),
    [transcribing, setTranscribing] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    bottom = useRef<HTMLDivElement>(null),
    historyGeneration = useRef(0),
    contextKey = useRef(""),
    mounted = useRef(true);
  const key = JSON.stringify(context);
  contextKey.current = key;
  useEffect(() => {
    let active = true;
    const generation = ++historyGeneration.current;
    setHistory([]);
    setError("");
    api(`/conversation?${new URLSearchParams(context)}`)
      .then((h) => {
        if (active && generation === historyGeneration.current) setHistory(h);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, [key]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [history, working]);
  useEffect(
    () => () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  async function clearHistory() {
    if (working || clearing || recording || transcribing) return;
    if (
      !window.confirm(
        "Очистить историю чата текущего заказчика и проекта? Сохранённая память и тикеты останутся.",
      )
    )
      return;
    const captured = key;
    setClearing(true);
    setError("");
    try {
      await api("/conversation", "DELETE", context);
      if (contextKey.current === captured) {
        historyGeneration.current++;
        setHistory([]);
      }
    } catch (e: any) {
      if (contextKey.current === captured) setError(e.message);
    } finally {
      setClearing(false);
    }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || working || clearing) return;
    const text = prompt;
    const captured = key;
    setWorking(true);
    setError("");
    setPrompt("");
    setHistory((h) => [...h, { role: "user", body: text, id: Date.now() }]);
    try {
      const r = await api("/conversation", "POST", { prompt: text, context });
      if (contextKey.current === captured)
        setHistory((h) => [
          ...h,
          {
            role: "assistant",
            body: r.body,
            id: Date.now(),
            cards: r.cards || [],
          },
        ]);
      onChange();
    } catch (e: any) {
      setError(e.message);
      if (contextKey.current === captured) setPrompt(text);
      onChange();
    } finally {
      setWorking(false);
    }
  }
  async function microphone() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    try {
      setError("");
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          "Микрофон требует localhost или HTTPS и браузер с MediaRecorder.",
        );
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const chunks: Blob[] = [];
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(media, mime ? { mimeType: mime } : {});
      recorder.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = async () => {
        if (timer.current) clearTimeout(timer.current);
        media.getTracks().forEach((t) => t.stop());
        if (!mounted.current) return;
        setRecording(false);
        setTranscribing(true);
        try {
          const form = new FormData();
          form.append(
            "audio",
            new Blob(chunks, { type: rec.mimeType }),
            "voice",
          );
          const r = await api("/voice/transcribe", "POST", form);
          if (!r.text?.trim())
            throw new Error("Речь не распознана. Попробуйте ещё раз.");
          setPrompt((p) => `${p}${p ? " " : ""}${r.text}`);
        } catch (e: any) {
          setError(e.message);
        } finally {
          setTranscribing(false);
        }
      };
      rec.start();
      setRecording(true);
      timer.current = setTimeout(() => {
        if (rec.state === "recording") rec.stop();
      }, 120000);
    } catch (e: any) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setError(e.message);
    }
  }
  return (
    <aside
      id="assistant-panel"
      className="assistant-panel"
      hidden={!open}
      style={{ "--chat-width": `${resize.width}px` } as React.CSSProperties}
    >
      {resize.handle}
      <div className="assistant-heading">
        <div className="assistant-symbol">
          <Sparkles size={20} />
        </div>
        <div>
          <b>Ваш ассистент</b>
          <small>
            <span className={`dot ${connected ? "" : "offline"}`} />
            {connected ? "GitHub Copilot" : "Ожидает подключения"}
          </small>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Очистить историю чата"
          title="Очистить историю текущего чата"
          disabled={
            working || clearing || recording || transcribing || !history.length
          }
          onClick={() => void clearHistory()}
        >
          <Trash2 size={17} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Свернуть панель чата"
          title="Свернуть чат"
          onClick={onCollapse}
        >
          <PanelRightClose size={18} />
        </button>
      </div>
      <div className="assistant-context">
        <FolderOpen size={13} />
        <div>
          {[context.client, context.project].filter(Boolean).join(" / ") ||
            "Общий контекст"}
          <small>
            Память: общая{context.client ? " + заказчика" : ""}
            {context.project ? " + проекта" : ""}. История — текущего контекста.
          </small>
        </div>
      </div>
      <div className="conversation">
        {!history.length && (
          <div className="assistant-welcome">
            <div className="welcome-symbol">
              <Sparkles size={27} />
            </div>
            <h2>
              Давайте освободим
              <br />
              немного внимания.
            </h2>
            <p>
              Я помогу собрать контекст, запомнить важное и подготовить ответ.
            </p>
            <div className="prompt-suggestions">
              {[
                "Какие тикеты требуют моего внимания?",
                "Покажи, что ты помнишь о текущем проекте",
                "Покажи тикет по номеру",
              ].map((p, i) => (
                <button key={p} onClick={() => setPrompt(p)}>
                  {i === 0 ? (
                    <Ticket size={16} />
                  ) : i === 1 ? (
                    <BookOpen size={16} />
                  ) : (
                    <MessageSquare size={16} />
                  )}
                  <span>{p}</span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
            {!connected && (
              <button className="connect-link" onClick={onSettings}>
                Подключить GitHub Copilot <ArrowUpRight size={15} />
              </button>
            )}
          </div>
        )}
        {history.map((m: any, i: number) => (
          <div className={`bubble ${m.role}`} key={m.id || i}>
            {m.role === "assistant" && (
              <span className="bubble-author">
                <Sparkles size={13} /> Orbit
              </span>
            )}
            {m.role === "error" ? (
              <p>{m.body}</p>
            ) : (
              <ChatMarkdown text={m.body} />
            )}
            {(typeof m.cards === "string"
              ? JSON.parse(m.cards)
              : m.cards || []
            ).map((ref: string) => (
              <TicketCard key={ref} reference={ref} />
            ))}
          </div>
        ))}
        {working && (
          <div className="thinking">
            <LoaderCircle size={14} className="spin" />
            Собираю контекст и готовлю ответ…
          </div>
        )}
        <div ref={bottom} />
      </div>
      {pending > 0 && (
        <button className="pending-bar" onClick={onApprovals}>
          <ShieldCheck size={16} />
          {pending} сообщ. ждут подтверждения
          <ChevronRight size={15} />
        </button>
      )}
      {working && (
        <button
          className="pending-bar"
          onClick={() =>
            api("/conversation/stop", "POST", {}).catch((e) =>
              setError(e.message),
            )
          }
        >
          <Square size={15} />
          Остановить ответ
        </button>
      )}
      <div className="composer-wrap">
        {error && (
          <div className="error" role="alert">
            {error}
            <button className="text-button" onClick={() => setError("")}>
              Закрыть
            </button>
          </div>
        )}
        <form className="composer" onSubmit={send}>
          <textarea
            aria-label="Сообщение ассистенту"
            placeholder={
              recording
                ? "Слушаю… нажмите стоп, когда закончите"
                : "Спросите или попросите запомнить…"
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={16000}
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (connected && !recording && !transcribing) send(e);
              }
            }}
          />
          <div className="composer-bottom">
            <button
              type="button"
              className={`mic-button ${recording ? "recording" : ""}`}
              onClick={microphone}
              disabled={transcribing || working}
              title={recording ? "Остановить запись" : "Голосовой ввод"}
              aria-label={recording ? "Остановить запись" : "Голосовой ввод"}
            >
              {transcribing ? (
                <LoaderCircle size={18} className="spin" />
              ) : recording ? (
                <Square size={16} />
              ) : (
                <Mic size={18} />
              )}
            </button>
            <small>
              {recording
                ? "Идёт запись · до 2 минут"
                : transcribing
                  ? "Распознаю локально…"
                  : "Enter ↵"}
            </small>
            <button
              className="send-button"
              disabled={
                !prompt.trim() ||
                working ||
                recording ||
                transcribing ||
                !connected
              }
              aria-label="Отправить ассистенту"
            >
              <ArrowUp size={19} />
            </button>
          </div>
        </form>
        <p className="composer-note">
          <ShieldCheck size={12} /> Отправка в Teams — только с вашего апрува
        </p>
      </div>
    </aside>
  );
}
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
