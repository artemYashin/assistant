import { CodeBrowserPage } from "./CodeBrowserPage.js";
import { SyncScheduleSettings } from "./SyncScheduleSettings.js";
import { ModelOverride } from "./ModelOverride.js";
import { installDialogBackdropDismiss } from "./dialog-backdrop.js";
import { TicketColorLegend } from "./TicketColorLegend.js";
import { paginationItems } from "./pagination.js";
import { TicketDataRow } from "./TicketDataRow.js";
import { Cloud } from "lucide-react";
import { useAzureTicketBrowser } from "./useAzureTicketBrowser.js";
import { ImportAzureTickets } from "./ImportAzureTickets.js";
import { useTicketFilterOptions } from "./useTicketFilterOptions.js";
import { TicketFilterPanel } from "./TicketFilterPanel.js";
import { useTicketFilters } from "./useTicketFilters.js";
import { MemoryBody } from "./MemoryBody.js";
import {
  analyzeTicketEvent,
  analysisChatReadyEvent,
  type AnalyzeTicketRequest,
} from "./chat-ticket-analysis.js";
import { ChatHistory } from "./ChatHistory.js";
import { OverviewUsage } from "./OverviewUsage.js";
import { OverviewActivity } from "./OverviewActivity.js";
import { RotateCcw } from "lucide-react";
import { ChatTools } from "./ChatTools.js";
import { OrderedTicketCells, useTicketColumns } from "./TicketColumns.js";
import { DevelopersPage } from "./DevelopersPage.js";
import { LocalAssigneeNames } from "./LocalAssigneeNames.js";
import { useSelectedChatTickets } from "./TicketSelection.js";
import { BulkTicketStatus } from "./BulkTicketStatus.js";
import { SelectAllTickets, useTicketSelection } from "./TicketSelection.js";
import { ExportTickets } from "./ExportTickets.js";
import { CompletedPullRequests } from "./CompletedPullRequests.js";
import { LastSync } from "./LastSync.js";
import { TicketTrash } from "./TicketTrash.js";
import { MemoryProposalList } from "./MemoryProposals.js";
import { ReviewQuestionInbox } from "./ReviewQuestions.js";
import { MultiSelect } from "./MultiSelect.js";
import { AzureAssigneeFilter } from "./AzureAssigneeFilter.js";
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
  Code2,
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
import { VoiceShortcut } from "./VoiceShortcut.js";
import { ChatStream, ChatToolHistory, useChatStream, formatChatDuration } from "./ChatStream.js";
import type { ChatProgress } from "../server/chat-stream.js";
import { api, apiProgress, setCsrf } from "./api.js";
import "./style.css";
import { ContextPicker } from "./ContextPicker.js";
import { PullRequestsPage } from "./PullRequestsPage.js";
import { TicketLookupDialog } from "./TicketLookupDialog.js";
import { TicketCard } from "./TicketCard.js";
import { TicketImportSettings } from "./TicketImportSettings.js";
import { Usage } from "./Usage.js";

type Context = { client: string; project: string };
const navigation = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard },
  { id: "inbox", label: "Входящие", icon: Inbox },
  { id: "tickets", label: "Тикеты", icon: Ticket },
  { id: "developers", label: "Разработчики", icon: Users },
  { id: "pullrequests", label: "Pull requests", icon: GitPullRequest },
  { id: "code", label: "Код репозитория", icon: Code2 },
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
  useEffect(() => installDialogBackdropDismiss(document), []);
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
    window.addEventListener("orbit:ticket-assignee", changed);
    window.addEventListener("orbit:ticket-metadata", changed);
    window.addEventListener("orbit:ticket-developers", changed);
    window.addEventListener("orbit:ticket-removed", changed);
    window.addEventListener("orbit:ticket-tracked", changed);
    return () => {
      window.removeEventListener("orbit:ticket-state", changed);
      window.removeEventListener("orbit:ticket-assignee", changed);
      window.removeEventListener("orbit:ticket-metadata", changed);
      window.removeEventListener("orbit:ticket-developers", changed);
      window.removeEventListener("orbit:ticket-removed", changed);
      window.removeEventListener("orbit:ticket-tracked", changed);
    };
  }, []);
  const initialized = useRef(false);
  const loadGeneration = useRef(0);
  async function reload() {
    const generation = ++loadGeneration.current;
    const [o, i, t, a, m, c, rq, mp] = await Promise.all([
      api(`/overview?${new URLSearchParams(context)}`),
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
    let live = true;
    api("/settings")
      .then((s) => {
        if (!live) return;
        setSettings(s);
        if (!initialized.current) {
          setContext({ client: s.client, project: s.project });
          initialized.current = true;
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [refresh, context.client, context.project]);
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
    page === "code" ? "Код репозитория" : page === "settings"
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
                <n.icon
                  size={19}
                  className={`sidebar-icon sidebar-icon-${n.id}`}
                />
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
          <Link
            to={pagePaths.settings}
            title="Настройки"
            aria-label="Настройки"
            aria-current={page === "settings" ? "page" : undefined}
            className={page === "settings" ? "active" : ""}
          >
            <Settings2
              size={19}
              className="sidebar-icon sidebar-icon-settings"
            />
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
            <LogOut size={18} className="sidebar-icon sidebar-icon-logout" />
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
          <ContextPicker
            context={context}
            onChange={setContext}
            onSettingsChange={() => setRefresh((value) => value + 1)}
          />
          <div className="topbar-actions">
            <TicketLookupDialog
              key={`${settings?.azureUrl}:${settings?.azureProject}`}
            />
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
            {page === "code" && <CodeBrowserPage key={JSON.stringify([context, refresh, settings?.azureUrl, settings?.azureProject])} context={context} />}
            {page === "overview" && (
              <>
                <div className="page-heading">
                  <div>
                    <h1>Обзор</h1>
                    <p>
                      Тикеты, pull requests и знания вашего рабочего
                      пространства.
                    </p>
                  </div>
                  <div className="overview-toolbar">
                    <div
                      className="overview-connections"
                      aria-label="Подключения"
                    >
                      {[
                        { name: "Copilot", icon: Github },
                        { name: "Teams", icon: MessageSquare },
                        { name: "DevOps", icon: Ticket },
                      ].map((item, index) => (
                        <button
                          type="button"
                          key={item.name}
                          className={`overview-connection${connected[index] ? " is-connected" : ""}`}
                          onClick={() => setPage("settings")}
                          title={`${item.name}: ${connected[index] ? (index === 2 ? "подключение настроено" : "подключено") : "не подключено"}`}
                          aria-label={`${item.name}: ${connected[index] ? "подключение настроено" : "не подключено"}. Открыть настройки`}
                        >
                          <item.icon size={15} /> {item.name}{" "}
                          {connected[index] ? (
                            <Check size={14} />
                          ) : (
                            <ArrowUpRight size={14} />
                          )}
                        </button>
                      ))}
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
                </div>
                <div className="stats-grid overview-stats">
                  {[
                    {
                      label: "Тикеты",
                      value: tickets.length,
                      icon: Ticket,
                      target: "tickets",
                      note: "в локальном трекере, без корзины",
                    },
                    {
                      label: "Pull requests",
                      value: overview.pullRequests ?? 0,
                      icon: GitPullRequest,
                      target: "pullrequests",
                      note: "активные в выбранном контексте",
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
                <OverviewUsage usage={overview.usage} />
                <section className="panel activity-panel">
                  <div className="section-heading">
                    <h2>Последняя активность</h2>

                  </div>
                  <OverviewActivity
                    context={context}
                    audit={overview.activity || []}
                    requests={overview.usage?.recent || []}
                    tickets={tickets}
                  />
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
                    !["trash", "azure"].includes(
                      new URLSearchParams(location.search).get("tab") || "",
                    )
                      ? "page"
                      : undefined
                  }
                >
                  <Ticket size={16} />
                  Тикеты
                </Link>
                <Link
                  to="/tickets?tab=azure"
                  aria-current={
                    new URLSearchParams(location.search).get("tab") === "azure"
                      ? "page"
                      : undefined
                  }
                >
                  <Cloud size={16} />
                  Azure тикеты
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
                  context={context}
                  settings={settings}
                  key={JSON.stringify([
                    settings?.azureUrl,
                    settings?.azureProject,
                    context.client,
                    context.project,
                    location.search,
                  ])}
                  onChange={() => setRefresh((n) => n + 1)}
                />
              )}
            {page === "tickets" &&
              new URLSearchParams(location.search).get("tab") !== "trash" && (
                <Tickets
                  azureMode={
                    new URLSearchParams(location.search).get("tab") === "azure"
                  }
                  context={context}
                  settings={settings}
                  key={JSON.stringify([
                    settings?.azureUrl,
                    settings?.azureProject,
                    context.client,
                    context.project,
                    location.search,
                  ])}
                  tickets={tickets}
                  lastSync={overview?.ticketsLastSync}
                  run={run}
                  busy={busy}
                />
              )}
            {page === "developers" && (
              <DevelopersPage
                key={JSON.stringify([
                  context,
                  settings?.azureUrl,
                  settings?.azureProject,
                ])}
                context={context}
                tickets={tickets}
                settings={settings}
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
                key={JSON.stringify([
                  context,
                  settings.azureUrl,
                  settings.azureProject,
                ])}
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
            onExpand={() => setAssistantOpen(true)}
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
  tickets: localTickets,
  lastSync,
  run: parentRun,
  busy,
  settings,
  context,
  azureMode = false,
}: any) {
  const currentSource = `${(settings?.azureUrl || "").replace(/\/$/, "")}|${settings?.azureProject || ""}`;
  const browser = useAzureTicketBrowser(
    azureMode,
    currentSource,
    JSON.stringify([currentSource, context.client, context.project]),
  );
  useEffect(() => {
    if (!azureMode) return;
    const refresh = () => browser.refresh();
    const events = [
      "orbit:ticket-state",
      "orbit:ticket-assignee",
      "orbit:ticket-metadata",
      "orbit:ticket-developers",
      "orbit:ticket-tracked",
      "orbit:ticket-removed",
    ];
    events.forEach((name) => window.addEventListener(name, refresh));
    return () =>
      events.forEach((name) => window.removeEventListener(name, refresh));
  }, [azureMode, browser.refresh]);
  const run = async (...args: any[]) => {
    await parentRun(...args);
    if (azureMode) browser.refresh();
  };
  const tickets = azureMode
    ? browser.rows.map((t: any) => {
        const local = localTickets.find(
          (item: any) => item.source === t.source && item.id === t.id,
        );
        return local
          ? {
              ...t,
              ...local,
              title: t.title,
              state: t.state,
              type: t.type,
              assigned: t.assigned,
              azureTags: t.azureTags,
              created_at: t.created_at,
              changed_at: t.changed_at,
              imported: true,
              inTrash: false,
            }
          : { ...t, imported: false };
      })
    : localTickets;
  const filterTickets = azureMode ? [...localTickets, ...tickets] : tickets;
  const columns = useTicketColumns(false, azureMode ? "azure" : "active");
  const localFilterOptions = useTicketFilterOptions(
    context,
    settings,
    localTickets,
  );
  const filterOptions = azureMode
    ? { ...localFilterOptions, ...browser.catalog }
    : localFilterOptions;
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const rawTarget = azureMode ? null : params.get("id");
  const targetId =
    rawTarget &&
    /^[1-9][0-9]*$/.test(rawTarget) &&
    Number.isSafeInteger(Number(rawTarget))
      ? Number(rawTarget)
      : null;
  const targetSource = params.get("source");

  const sourceMismatch =
    !!targetSource && !!settings && targetSource !== currentSource;
  const [id, setId] = useState(targetId ? String(targetId) : "");
  const filterStorageKey =
    `orbit.ticket-filters.${azureMode ? "azure" : "active"}:` +
    JSON.stringify([currentSource, context.client, context.project]);
  const {
    filters,
    set: setFilter,
    apply: applyFilters,
  } = useTicketFilters(filterStorageKey);
  const {
    query,
    sort,
    priorityFilter,
    tagFilter,
    azureTagFilter,
    typeFilter,
    stateFilter,
    assigneeFilter,
    localFilter,
  } = filters;
  const previousSort = useRef(sort);
  useEffect(() => {
    if (previousSort.current === sort) return;
    previousSort.current = sort;
    if (azureMode) void browser.search(filters);
  }, [sort, azureMode, filters, browser.search]);
  const setQuery = (value: string) => setFilter("query", value);
  const setSort = (value: string) => setFilter("sort", value);
  const setPriorityFilter = (value: string[]) =>
    setFilter("priorityFilter", value);
  const setTagFilter = (value: string[]) => setFilter("tagFilter", value);
  const setAzureTagFilter = (value: string[]) =>
    setFilter("azureTagFilter", value);
  const setTypeFilter = (value: string[]) => setFilter("typeFilter", value);
  const setStateFilter = (value: string[]) => setFilter("stateFilter", value);
  const setAssigneeFilter = (value: string[]) =>
    setFilter("assigneeFilter", value);
  const setLocalFilter = (value: string[]) => setFilter("localFilter", value);
  const values = (key: string) =>
    [...new Set<string>(filterTickets.map((t: any) => t[key] || ""))].sort(
      (a, b) => a.localeCompare(b, "ru"),
    );
  const localDevelopers = [
    ...new Map<string, string>(
      filterTickets.flatMap((t: any) =>
        (t.developers || []).map((d: any) => [d.id, d.name]),
      ),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  const filteredTickets = tickets.filter((t: any) => {
    if (azureMode) return true;
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
      "azureTags",
    ].some((key) =>
      String(t[key] || "")
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    );
    return (
      matchesQuery &&
      (!priorityFilter.length ||
        priorityFilter.includes(String(t.priority ?? 1))) &&
      (!tagFilter.length ||
        tagFilter.some((tag) =>
          tag === "" ? !t.tags?.length : t.tags?.includes(tag),
        )) &&
      (!azureTagFilter.length ||
        azureTagFilter.some((tag) =>
          tag === "" ? !t.azureTags?.length : t.azureTags?.includes(tag),
        )) &&
      (!typeFilter.length || typeFilter.includes(t.type || "")) &&
      (!stateFilter.length || stateFilter.includes(t.state || "")) &&
      (!assigneeFilter.length || assigneeFilter.includes(t.assigned || "")) &&
      (!localFilter.length ||
        localFilter.some((id) =>
          id === ""
            ? !t.developers?.length
            : t.developers?.some((d: any) => d.id === id),
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
  const sorted = azureMode
    ? filteredTickets
    : [...filteredTickets].sort((a, b) => {
        const [key, direction] = sort.split("-");
        const cmp =
          key === "id"
            ? a.id - b.id
            : ["created_at", "changed_at"].includes(key)
              ? (Date.parse(a[key]) || 0) - (Date.parse(b[key]) || 0)
              : String(a[key] || "").localeCompare(String(b[key] || ""), "ru", {
                  numeric: true,
                });
        return (direction === "desc" ? -cmp : cmp) || a.id - b.id;
      });
  const selection = useTicketSelection<any>(
    sorted,
    JSON.stringify([currentSource, context]),
  );
  return (
    <>
      <div className="ticket-page-intro">
        <PageHeading
          title={azureMode ? "Azure тикеты" : "Ваши тикеты"}
          subtitle={
            azureMode
              ? `${settings?.azureProject || "Проект не настроен"} · поиск по кнопке или Enter, по 50 задач на страницу.`
              : "Актуальный статус из Azure DevOps. Данные обновляются в фоне."
          }
        />
        {!azureMode && <LastSync at={lastSync} />}
      </div>
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
      <div className="ticket-management-toolbar">
        <form
          className="ticket-search-block"
          onSubmit={(event) => {
            event.preventDefault();
            if (azureMode) void browser.search(filters);
          }}
        >
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Поиск тикетов"
              maxLength={azureMode ? 200 : undefined}
              placeholder={
                azureMode
                  ? "Номер, название или Azure тег…"
                  : "Номер, название, исполнитель…"
              }
              disabled={!!rawTarget}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {azureMode && (
            <button
              type="submit"
              className="primary"
              disabled={browser.loading}
            >
              <Search size={16} />
              {browser.loading ? "Поиск…" : "Найти"}
            </button>
          )}
        </form>
        {!azureMode && (
          <div className="ticket-add-block">
            <form
              className="ticket-add-form"
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
                aria-label="Номер тикета для добавления"
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
            <button
              type="button"
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
        )}
      </div>
      <TicketFilterPanel
        storageKey={filterStorageKey}
        filters={filters}
        onApply={applyFilters}
        disabled={!!rawTarget}
      >
        {filterOptions.error && (
          <p className="error" role="alert">
            Не удалось загрузить справочник фильтров: {filterOptions.error}
          </p>
        )}
        <div className="ticket-filters">
          <button
            className="secondary ticket-filter-reset"
            title="Сбросить все фильтры и поиск"
            disabled={
              !rawTarget &&
              !priorityFilter.length &&
              !tagFilter.length &&
              !typeFilter.length &&
              !stateFilter.length &&
              !assigneeFilter.length &&
              !localFilter.length &&
              !azureTagFilter.length &&
              !query
            }
            onClick={() => {
              if (rawTarget) navigate("/tickets");
              setPriorityFilter([]);
              setTagFilter([]);
              setAzureTagFilter([]);
              setTypeFilter([]);
              setStateFilter([]);
              setAssigneeFilter([]);
              setLocalFilter([]);
              setQuery("");
            }}
          >
            <RotateCcw size={15} /> Сбросить
          </button>
          <MultiSelect
            label="Приоритет"
            placeholder="Все приоритеты"
            value={priorityFilter}
            onChange={setPriorityFilter}
            disabled={!!rawTarget}
            options={filterOptions.priorities.map((v) => ({
              value: String(v),
              label: "P" + v,
            }))}
          />
          <MultiSelect
            label="Теги"
            placeholder="Все теги"
            value={tagFilter}
            onChange={setTagFilter}
            disabled={!!rawTarget}
            options={[
              { value: "", label: "Без тегов" },
              ...[
                ...new Set<string>(
                  filterTickets.flatMap((t: any) => t.tags || []),
                ),
              ]
                .sort()
                .map((v) => ({ value: v, label: v })),
            ]}
          />
          <MultiSelect
            label="Azure теги"
            allowCustom={azureMode}
            placeholder="Все Azure теги"
            value={azureTagFilter}
            onChange={setAzureTagFilter}
            disabled={!!rawTarget}
            options={[
              { value: "", label: "Без Azure тегов" },
              ...[
                ...new Set<string>(
                  filterTickets.flatMap((t: any) => t.azureTags || []),
                ),
              ]
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
            options={filterOptions.types.map((value) => ({
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
            options={filterOptions.states.map((value) => ({
              value,
              label: value || "Статус не указан",
            }))}
          />
          <AzureAssigneeFilter
            disabled={!!rawTarget}
            value={assigneeFilter}
            onChange={setAssigneeFilter}
            names={values("assigned")}
          />
          <MultiSelect
            label="Локальное поручение"
            placeholder="Все разработчики"
            disabled={!!rawTarget}
            value={localFilter}
            onChange={setLocalFilter}
            options={[
              { value: "", label: "Нет поручения" },
              ...localDevelopers.map(([id, name]) => ({
                value: id,
                label: name,
                avatarName: name,
              })),
            ]}
          />
        </div>
      </TicketFilterPanel>
      <div className="ticket-export-bar ticket-actions-panel">
        <div className="ticket-display-summary">
          {columns.control}
          {azureMode && (
            <ImportAzureTickets
              tickets={selection.selected}
              source={currentSource}
              onImported={() => {
                selection.clear();
                void run("refresh-azure-import", async () => {});
              }}
            />
          )}
          <p className="muted" role="status">
            {azureMode
              ? `На странице: ${sorted.length}`
              : `Показано ${sorted.length} из ${tickets.length}`}
          </p>
          {azureMode && <TicketColorLegend />}
        </div>
        <div className="ticket-bulk-actions">
          <span role="status">Выбрано: {selection.selected.length}</span>
          {!!selection.selected.length && (
            <button
              type="button"
              className="text-button"
              onClick={selection.clear}
            >
              Снять выбор
            </button>
          )}
          {!azureMode && (
            <BulkTicketStatus
              tickets={selection.selected}
              onChange={() => run("refresh-bulk-state", async () => {})}
            />
          )}
          <ExportTickets
            tickets={selection.selected.length ? selection.selected : sorted}
          />
        </div>
      </div>
      {azureMode && (
        <>
          {browser.error && (
            <p className="error" role="alert">
              {browser.error}
            </p>
          )}
          {browser.pending(filters) && (
            <p className="muted">
              Условия изменены. Нажмите «Найти», чтобы применить их.
            </p>
          )}
          <nav
            className="azure-ticket-pagination"
            aria-label="Страницы Azure тикетов"
          >
            <button
              type="button"
              className="secondary"
              disabled={browser.loading || browser.page === 1}
              onClick={browser.previous}
            >
              Назад
            </button>
            {paginationItems(browser.page, browser.totalPages).map((item) =>
              typeof item === "number" ? (
                <button
                  key={item}
                  type="button"
                  className="secondary azure-page-number"
                  aria-label={`Страница ${item}`}
                  aria-current={item === browser.page ? "page" : undefined}
                  disabled={browser.loading}
                  onClick={() => browser.goTo(item)}
                >
                  {item}
                </button>
              ) : (
                <span key={item} aria-hidden="true">
                  …
                </span>
              ),
            )}
            <button
              type="button"
              className="secondary"
              disabled={browser.loading || !browser.hasNext}
              onClick={browser.next}
            >
              Далее
            </button>
            <span>
              Страница {browser.page} из {browser.totalPages} · {browser.total}{" "}
              тикетов · по 50
            </span>
          </nav>
          {browser.limited && (
            <p className="muted">
              Показаны первые 20 000 результатов. Уточните фильтры, чтобы
              увидеть остальные.
            </p>
          )}
          <p className="muted">
            Сортировка — по всему результату поиска. Экспорт — текущая страница.
          </p>
        </>
      )}
      {!azureMode && (
        <p className="muted">
          Удаление и локальное поручение не изменяют Azure. Удалённый тикет
          можно вернуть кнопкой «Добавить по номеру».
        </p>
      )}
      <div
        className={`panel ticket-table-fit ticket-active-table${sorted.length ? "" : " is-empty"}${columns.resize.manual ? " has-manual-widths" : ""}`}
      >
        <table ref={columns.resize.tableRef}>
          {columns.resize.colgroup}
          <thead>
            <tr>
              <OrderedTicketCells
                order={columns.order}
                headerResize={columns.resize.handle}
              >
                <th className="ticket-selection-column">
                  <SelectAllTickets
                    count={selection.selected.length}
                    total={sorted.length}
                    onChange={selection.toggleAll}
                  />
                </th>
                <th
                  className="ticket-identity-column"
                  aria-sort={columnSort(["id", "type"])}
                >
                  <div className="ticket-heading-sorts ticket-identity-heading">
                    {sortButton("id", "ID")}
                    {sortButton("type", "Тип")}
                  </div>
                </th>
                <th
                  className="ticket-title-column"
                  aria-sort={columnSort(["title"])}
                >
                  {sortButton("title", "Тикет")}
                </th>
                {(
                  [
                    ["state", "Статус"],
                    ["priority", "Приоритет"],
                    ["tags", "Теги"],
                    ["azureTags", "Azure теги"],
                    ["assigned", "Исполнитель в Azure"],
                    ["developer_name", "Локальное поручение"],
                    ["created_at", "Дата создания"],
                    ["changed_at", "Дата изменения"],
                    ["added_at", "Добавлено в систему"],
                    ["synced_at", "Синхронизация"],
                  ] as const
                ).map(([key, label]) => (
                  <th
                    key={key}
                    data-column={key}
                    hidden={columns.hidden(key)}
                    aria-sort={columnSort([key])}
                  >
                    {sortButton(key, label)}
                  </th>
                ))}
                <th data-column="actions" hidden={columns.hidden("actions")}>
                  Просмотр
                </th>
              </OrderedTicketCells>
            </tr>
          </thead>
          <tbody>
            {!sorted.length && (
              <tr className="ticket-empty-row">
                <td colSpan={columns.count}>
                  <Empty
                    icon={Ticket}
                    title={
                      azureMode
                        ? browser.loading
                          ? "Поиск в Azure…"
                          : browser.searched
                            ? "Ничего не найдено"
                            : "Найдите тикеты в Azure"
                        : tickets.length
                          ? "Ничего не найдено"
                          : "Трекер пока пуст"
                    }
                    description={
                      azureMode
                        ? "Задайте условия и нажмите «Найти» или Enter. Без условий будут показаны все задачи проекта, по 50 на страницу."
                        : tickets.length
                          ? "Измените фильтры или поисковый запрос, либо нажмите «Сбросить»."
                          : "Добавьте тикет по номеру, импортируйте назначенные вам задачи или выберите упоминание во Входящих."
                    }
                  />
                </td>
              </tr>
            )}
            {sorted.map((t: any) => (
              <TicketDataRow
                key={`${t.source}:${t.id}`}
                ticket={t}
                columns={columns}
                settings={settings}
                context={context}
                checked={selection.checked(t)}
                onToggle={() => selection.toggle(t)}
                onChange={() => run("refresh-ticket", async () => {})}
                highlighted={targetId === t.id && !sourceMismatch}
                restoring={busy === "restore"}
                onRestore={
                  azureMode && t.inTrash
                    ? () =>
                        run(
                          "restore",
                          async () => {
                            await api(`/tickets/${t.id}/restore`, "POST", {
                              source: t.source,
                            });
                            window.dispatchEvent(
                              new CustomEvent("orbit:ticket-tracked", {
                                detail: { id: t.id, source: t.source },
                              }),
                            );
                          },
                          "Тикет восстановлен",
                        )
                    : undefined
                }
                onRemove={
                  azureMode && !t.imported
                    ? undefined
                    : () =>
                        run(
                          "remove",
                          () =>
                            api(`/tickets/${t.id}`, "DELETE", {
                              source: t.source,
                            }),
                          "Тикет перемещён в корзину на 30 дней",
                        )
                }
              />
            ))}
          </tbody>
        </table>
      </div>
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
            <MemoryBody
              key={`${m.id}:${m.body}`}
              id={m.id}
              body={m.body}
              disabled={!!busy}
              onSaved={() => run("refresh-memory", async () => {})}
            />
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
              value={context.client ? settings.azureUrl : form.azureUrl}
              disabled={!!context.client}
              onChange={(e) => set("azureUrl", e.target.value)}
              placeholder="https://devops.company.com/DefaultCollection"
            />
          </Field>
          <div className="form-grid">
            <Field
              label="Название проекта в Azure DevOps"
              hint="Для выбранного проекта задаётся в меню «Заказчики и проекты» → «Подключение Azure»."
            >
              <input
                value={
                  context.client ? settings.azureProject : form.azureProject
                }
                disabled={!!context.client}
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
          <SyncScheduleSettings value={form.syncSchedule} onChange={(value) => set("syncSchedule", value)} />
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
  onExpand,
  onCollapse,
  context,
  connected,
  onChange,
  onSettings,
  onApprovals,
  pending,
}: any) {
  const [chatUsage, setChatUsage] = useState({ inputTokens: 0, outputTokens: 0, reports: 0, partial: false });
  const [shortcutBusy, setShortcutBusy] = useState(false);
  const resize = useAssistantResize();
  const chatStream = useChatStream();
  const conversationView = useRef<HTMLDivElement>(null);
  const followStream = useRef(true);
  const chatConnection = useRef<AbortController | null>(null);
  useEffect(() => {
    const element = conversationView.current;
    if (element && followStream.current) element.scrollTop = element.scrollHeight;
  }, [chatStream.live]);
  useEffect(() => () => chatConnection.current?.abort(), []);
  const selectedTickets = useSelectedChatTickets();
  const [sessionId, setSessionId] = useState("");
  const [chatModel, setChatModel] = useState("");
  const [attachment, setAttachment] = useState<any>(null);
  const analysisPending = useRef(false);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("Новый чат");
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
    setChatUsage({ inputTokens: 0, outputTokens: 0, reports: 0, partial: false });
    chatStream.reset();
    setSessionId("");
    setAttachment(null);
    setHasOlder(false);
    setPrompt("");
    setError("");
    api(`/conversation/sessions?${new URLSearchParams(context)}`)
      .then(async (result) => {
        const page = await api(
          `/conversation?${new URLSearchParams({ ...context, sessionId: result.activeId, page: "true" })}`,
        );
        if (active && generation === historyGeneration.current) {
          setSessionId(result.activeId);
          setSessionTitle(
            result.sessions.find((s: any) => s.id === result.activeId)?.title ||
              "Новый чат",
          );
          setHistory(page.messages);
          setAttachment(page.attachment);
          setHasOlder(page.hasMore);
          setChatUsage(page.usage || { inputTokens: 0, outputTokens: 0, reports: 0, partial: false });
        }
      })
      .catch((e) => {
        if (active && generation === historyGeneration.current)
          setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [key]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [history.at(-1)?.id, working]);
  useEffect(
    () => () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => {
    const handle = (event: Event) => {
      const task = (event as CustomEvent<AnalyzeTicketRequest>).detail;
      if (
        working ||
        clearing ||
        recording ||
        shortcutBusy ||
        transcribing ||
        analysisPending.current
      ) {
        task.reject(
          new Error(
            "Дождитесь завершения текущего ответа или записи голоса, затем начните анализ.",
          ),
        );
        return;
      }
      analysisPending.current = true;
      const captured = key;
      const generation = ++historyGeneration.current;
      setClearing(true);
      void (async () => {
        try {
          const session = await api("/conversation/sessions", "POST", {
            ...context,
            ticketCardRef: task.reference,
          });
          const page = await api(
            `/conversation?${new URLSearchParams({ ...context, sessionId: session.id, page: "true" })}`,
          );
          if (
            contextKey.current !== captured ||
            generation !== historyGeneration.current
          )
            throw new Error(
              "Контекст проекта изменился. Чат сохранён в истории исходного проекта.",
            );
          setSessionId(session.id);
          setSessionTitle(session.title);
          setHistory(page.messages);
          setAttachment(page.attachment);
          setHasOlder(false);
          setChatUsage(page.usage || { inputTokens: 0, outputTokens: 0, reports: 0, partial: false });
          setPrompt(
            `Проанализируй тикет #${page.attachment.id}: объясни требования, найди неоднозначности и риски, предложи проверки.`,
          );
          setError("");
          onExpand();
          window.dispatchEvent(new Event(analysisChatReadyEvent));
          requestAnimationFrame(() => promptInput.current?.focus());
          task.resolve();
        } catch (e: any) {
          task.reject(e);
        } finally {
          analysisPending.current = false;
          setClearing(false);
        }
      })();
    };
    window.addEventListener(analyzeTicketEvent, handle);
    return () => window.removeEventListener(analyzeTicketEvent, handle);
  }, [key, working, clearing, shortcutBusy, recording, transcribing, onExpand]);
  async function chooseChat(id?: string) {
    if (working || clearing || shortcutBusy || recording || transcribing) return;
    const captured = key;
    const generation = ++historyGeneration.current;
    setClearing(true);
    try {
      const session = id
        ? await api(`/conversation/sessions/${id}/active`, "PUT", context)
        : await api("/conversation/sessions", "POST", context);
      const page = await api(
        `/conversation?${new URLSearchParams({ ...context, sessionId: session.id, page: "true" })}`,
      );
      if (
        contextKey.current === captured &&
        generation === historyGeneration.current
      ) {
        setSessionId(session.id);
        setSessionTitle(session.title);
        setHistory(page.messages);
        setAttachment(page.attachment);
        setHasOlder(page.hasMore);
          setChatUsage(page.usage || { inputTokens: 0, outputTokens: 0, reports: 0, partial: false });
        setPrompt("");
        setError("");
      }
    } finally {
      setClearing(false);
    }
  }
  async function loadOlder() {
    if (loadingOlder || !hasOlder || !history[0]?.sequence) return;
    const generation = historyGeneration.current;
    const container = bottom.current?.parentElement;
    const height = container?.scrollHeight || 0;
    const top = container?.scrollTop || 0;
    setLoadingOlder(true);
    try {
      const page = await api(
        `/conversation?${new URLSearchParams({ ...context, sessionId, page: "true", before: String(history[0].sequence) })}`,
      );
      if (generation === historyGeneration.current) {
        setHistory((h) => [...page.messages, ...h]);
        setHasOlder(page.hasMore);
          setChatUsage(page.usage || { inputTokens: 0, outputTokens: 0, reports: 0, partial: false });
        requestAnimationFrame(() => {
          if (container && generation === historyGeneration.current)
            container.scrollTop = top + container.scrollHeight - height;
        });
      }
    } catch (e: any) {
      if (generation === historyGeneration.current) setError(e.message);
    } finally {
      setLoadingOlder(false);
    }
  }
  async function detachAnalysis() {
    if (
      working ||
      clearing ||
      recording ||
      transcribing ||
      !sessionId ||
      !attachment
    )
      return;
    const captured = key;
    const generation = historyGeneration.current;
    const defaultPrompt = `Проанализируй тикет #${attachment.id}: объясни требования, найди неоднозначности и риски, предложи проверки.`;
    setClearing(true);
    setError("");
    try {
      await api(
        `/conversation/sessions/${sessionId}/attachment`,
        "DELETE",
        context,
      );
      if (
        contextKey.current === captured &&
        generation === historyGeneration.current
      ) {
        setAttachment(null);
        setPrompt((current) => (current === defaultPrompt ? "" : current));
      }
    } catch (e: any) {
      if (
        contextKey.current === captured &&
        generation === historyGeneration.current
      )
        setError(e.message);
    } finally {
      setClearing(false);
    }
  }
  async function clearHistory() {
    if (working || clearing || shortcutBusy || recording || transcribing) return;
    if (
      !window.confirm(
        "Очистить сообщения выбранного чата? Другие чаты, память и тикеты останутся.",
      )
    )
      return;
    const captured = key;
    const generation = historyGeneration.current;
    setClearing(true);
    setError("");
    try {
      await api("/conversation", "DELETE", { ...context, sessionId });
      if (
        contextKey.current === captured &&
        generation === historyGeneration.current
      ) {
        historyGeneration.current++;
        setHistory([]);
        setHasOlder(false);
        setSessionTitle("Новый чат");
        setChatUsage({ inputTokens: 0, outputTokens: 0, reports: 0, partial: false });
        chatStream.reset();
        setAttachment(null);
      }
    } catch (e: any) {
      if (
        contextKey.current === captured &&
        generation === historyGeneration.current
      )
        setError(e.message);
    } finally {
      setClearing(false);
    }
  }
  async function send(e?: React.FormEvent, voiceText?: string) {
    e?.preventDefault();
    const text = voiceText ?? prompt;
    if (!text.trim() || working || clearing || !sessionId || (!voiceText && shortcutBusy)) return;
    const captured = key;
    const generation = historyGeneration.current;
    setWorking(true);
    chatStream.reset();
    followStream.current = true;
    chatConnection.current = new AbortController();
    setError("");
    if (!voiceText) setPrompt("");
    if (!history.length)
      setSessionTitle(text.replace(/\s+/g, " ").trim().slice(0, 80));
    setHistory((h) => [...h, { role: "user", body: text, id: Date.now() }]);
    try {
      const r = await apiProgress<ChatProgress>("/conversation", {
        prompt: text,
        model: chatModel,
        context,
        sessionId,
        selectedTickets: selectedTickets.map(({ id, source }) => ({
          id,
          source,
        })),
      }, event => {
        if (contextKey.current === captured && generation === historyGeneration.current) {
          if (event.stage === "show_tickets") window.dispatchEvent(new CustomEvent("orbit-show-ticket-details", { detail: event }));
          else if (event.stage === "usage") setChatUsage(event);
          else chatStream.receive(event);
        }
      }, chatConnection.current!.signal);
      const toolSnapshot = chatStream.tools();
      if (
        contextKey.current === captured &&
        generation === historyGeneration.current
      )
        setHistory((h) => [
          ...h,
          {
            role: "assistant",
            body: r.body,
            id: Date.now(),
            cards: r.cards || [],
            duration_ms: r.durationMs ?? chatStream.elapsed(),
            tools: toolSnapshot,
          },
        ]);
      chatStream.reset();
      onChange();
    } catch (e: any) {
      if (
        contextKey.current === captured &&
        generation === historyGeneration.current
      ) {
        const partial = chatStream.partial();
        const toolSnapshot = chatStream.tools().map(tool => ({ ...tool, status: tool.status === "running" ? "interrupted" : tool.status }));
        if (partial) setHistory(h => [...h, { role: "assistant", body: partial + "\n\n_Ответ прерван._", id: Date.now(), duration_ms: chatStream.elapsed(), tools: toolSnapshot }]);
        setError(e.message);
        setPrompt(current => voiceText ? [current, text].filter(Boolean).join("\n") : text);
      }
      chatStream.reset();
      onChange();
    } finally {
      try {
        const page = await api(`/conversation?${new URLSearchParams({ ...context, sessionId, page: "true" })}`);
        if (contextKey.current === captured && generation === historyGeneration.current) {
          setHistory(existing => [...existing.filter(message => message.sequence && message.sequence < (page.messages[0]?.sequence || 0)), ...page.messages]);
          setChatUsage(page.usage || { inputTokens: 0, outputTokens: 0, reports: 0, partial: false });
          setHasOlder(page.hasMore);
        }
      } catch { /* Keep the received response if history refresh fails. */ }
      chatStream.reset();
      setWorking(false);
    }
  }
  async function microphone() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    const voiceGeneration = historyGeneration.current;
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
          if (voiceGeneration === historyGeneration.current)
            setPrompt((p) => `${p}${p ? " " : ""}${r.text}`);
        } catch (e: any) {
          if (voiceGeneration === historyGeneration.current)
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
      <VoiceShortcut key={key + ":" + sessionId} enabled={!!connected && !!sessionId && !working && !clearing && !recording && !transcribing}
        title={sessionTitle} onBusy={setShortcutBusy} onText={text => { onExpand(); void send(undefined, text); }} />
      {resize.handle}
      <div className="assistant-heading">
        <div className="assistant-symbol">
          <Sparkles size={20} />
        </div>
        <div className="assistant-heading-text">
          <b title={[context.client, context.project].filter(Boolean).join(" / ")}>{[context.client, context.project].filter(Boolean).join(" / ") || "Общий контекст"}</b>
          <small className="assistant-chat-title" title={sessionTitle}><span className={`dot ${connected ? "" : "offline"}`} title={connected ? "Copilot подключён" : "Нет подключения"} />{sessionTitle}</small>
        </div>
        <ChatTools context={context} />
        <ChatHistory
          context={context}
          activeId={sessionId}
          disabled={
            working || clearing || shortcutBusy || recording || transcribing || !sessionId
          }
          onSelect={chooseChat}
        />
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
      <div className="assistant-token-usage" title={`Токены текущего чата по отчётам SDK. ${chatUsage.partial ? "Для старых сообщений до обновления расход не привязан к чату." : "Включая контекст и инструменты."}`}>
        <span>Токены{chatUsage.partial ? " (частично)" : ""}</span>
        <span>Вход <b>{!clearing && chatUsage.reports ? chatUsage.inputTokens.toLocaleString() : "—"}</b></span>
        <span>Выход <b>{!clearing && chatUsage.reports ? chatUsage.outputTokens.toLocaleString() : "—"}</b></span>
      </div>
      <div className="conversation" aria-busy={clearing} ref={conversationView} onScroll={event => {
        const element = event.currentTarget;
        followStream.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
      }}>
        {hasOlder && (
          <button
            type="button"
            className="text-button chat-load-older"
            disabled={loadingOlder || clearing}
            onClick={() => void loadOlder()}
          >
            {loadingOlder ? "Загрузка…" : "Показать более ранние сообщения"}
          </button>
        )}
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
            <ChatToolHistory tools={m.tools} />
            {m.role === "error" ? (
              <p>{m.body}</p>
            ) : (
              <ChatMarkdown text={m.body} />
            )}
            {typeof m.duration_ms === "number" && <div className="chat-elapsed">Время работы: <time>{formatChatDuration(m.duration_ms)}</time></div>}
            {(typeof m.cards === "string"
              ? JSON.parse(m.cards)
              : m.cards || []
            ).map((ref: string) => (
              <TicketCard key={ref} reference={ref} />
            ))}
          </div>
        ))}
        {working && <ChatStream live={chatStream.live} />}
        {working && (
          <div className="thinking">
            <LoaderCircle size={14} className="spin" />
            {chatStream.live.text ? "Формирую ответ…" : chatStream.live.tools.some(tool => tool.status === "running") ? "Выполняю инструменты…" : "Собираю контекст и готовлю ответ…"}
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
      <div className="composer-wrap">
        {error && (
          <div className="error" role="alert">
            {error}
            <button className="text-button" onClick={() => setError("")}>
              Закрыть
            </button>
          </div>
        )}
        {attachment && (
          <div className="chat-analysis-attachment">
            <div className="chat-analysis-heading">
              <span className="chat-analysis-badge">
                <Sparkles size={14} /> Анализ тикета #{attachment.id}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="Убрать анализ тикета из контекста"
                title="Убрать прикреплённый тикет. Переписка сохранится."
                disabled={
                  working || clearing || shortcutBusy || recording || transcribing || !sessionId
                }
                onClick={() => void detachAnalysis()}
              >
                <X size={16} />
              </button>
            </div>
            <strong>{attachment.title}</strong>
            <small>
              Описание, критерии, шаги воспроизведения и комментарии (
              {attachment.comments}). Снимок от{" "}
              {new Date(attachment.loadedAt).toLocaleString("ru-RU")}.
            </small>
            <small>
              Полный текст · {attachment.characters.toLocaleString("ru-RU")}{" "}
              символов. Отправка может потребовать много токенов. Дополните
              запрос и нажмите «Отправить».
            </small>
            {!!attachment.warnings?.length && (
              <small className="error">{attachment.warnings.join(" ")}</small>
            )}
          </div>
        )}
        {!!selectedTickets.length && (
          <div className="chat-ticket-context">
            <small>
              Номера тикетов в контексте следующего сообщения ·{" "}
              {selectedTickets.length}
            </small>
            <div className="chat-ticket-badges">
              {selectedTickets.map((ticket) => (
                <span
                  className="badge"
                  key={`${ticket.source}:${ticket.id}`}
                  title={ticket.title}
                >
                  #{ticket.id}
                </span>
              ))}
            </div>
          </div>
        )}
        <form className="composer" onSubmit={send}>
          <textarea
            ref={promptInput}
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
              className="icon-button"
              aria-label="Очистить историю чата"
              title="Очистить историю текущего чата"
              disabled={
                working ||
                clearing ||
                recording ||
                transcribing ||
                !history.length
              }
              onClick={() => void clearHistory()}
            >
              <Trash2 size={17} />
            </button>

            <div className="composer-model">
              <ModelOverride value={chatModel} onChange={setChatModel} disabled={working || clearing || !connected || shortcutBusy} />
            </div>
            {working ? <button type="button" className="chat-stop-button" title="Остановить ответ" onClick={() => api("/conversation/stop", "POST", {}).catch(e => setError(e.message))}>
              <Square size={15} /><span>Стоп</span>
            </button> : <>
            <button
              type="button"
              className={`mic-button ${recording ? "recording" : ""}`}
              onClick={microphone}
              disabled={transcribing || working || shortcutBusy}
              title={recording ? "Остановить запись" : "Голосовой ввод · M M — запись с отправкой, даже из поля ввода"}
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

            <button
              className="send-button"
              disabled={
                !prompt.trim() ||
                working ||
                recording ||
                transcribing ||
                !connected ||
                clearing ||
                !sessionId
              }
              aria-label="Отправить ассистенту"
            >
              <ArrowUp size={19} />
            </button>
            </>}
          </div>
        </form>

      </div>
    </aside>
  );
}
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
