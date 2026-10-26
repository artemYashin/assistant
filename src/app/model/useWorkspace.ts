import { hasLocalManagement } from "../../../server/work-mode.js";
import { useUnreadRelease } from "../../features/read-updates/index.js";
import { useCallback } from "react";
import { useChatToggleShortcut } from "../../features/voice-input/index.js";
import { useLocation, useNavigate } from "react-router-dom";
import { pagePaths, pageForPath, type Page } from "../../shared/config/routes/index.js";
import { readChatPreference, saveChatPreference } from "../../widgets/assistant/index.js";
import { useEffect, useRef, useState } from "react";
import { api } from "../../shared/api/http/index.js";
import { navigation } from "../config/navigation.js";

type Context = { client: string; project: string };
export function useWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const page = pageForPath(location.pathname);
  const unreadRelease = useUnreadRelease(page === "updates");
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
    [reviewQuestions, setReviewQuestions] = useState<any[]>([]),
    [memoryProposals, setMemoryProposals] = useState<any[]>([]),
    [tickets, setTickets] = useState<any[]>([]),
    [memories, setMemories] = useState<any[]>([]),
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
  const toggleAssistant = useCallback(() => setAssistantOpen(value => !value), []);
  useChatToggleShortcut(settings?.chatToggleKey ?? "KeyC", settings?.chatTogglePress ?? "single", toggleAssistant);
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
    window.addEventListener("orbit:data-synced", changed);
    window.addEventListener("orbit:ticket-state", changed);
    window.addEventListener("orbit:ticket-assignee", changed);
    window.addEventListener("orbit:ticket-metadata", changed);
    window.addEventListener("orbit:ticket-developers", changed);
    window.addEventListener("orbit:ticket-removed", changed);
    window.addEventListener("orbit:ticket-tracked", changed);
    return () => {
      window.removeEventListener("orbit:data-synced", changed);
      window.removeEventListener("orbit:ticket-state", changed);
      window.removeEventListener("orbit:ticket-assignee", changed);
      window.removeEventListener("orbit:ticket-metadata", changed);
      window.removeEventListener("orbit:ticket-developers", changed);
      window.removeEventListener("orbit:ticket-removed", changed);
      window.removeEventListener("orbit:ticket-tracked", changed);
    };
  }, []);
  useEffect(()=>{if(settings && !hasLocalManagement(settings) && page==="developers") navigate("/tickets",{replace:true});},[settings?.workMode,page,navigate]);
  const initialized = useRef(false);
  const loadGeneration = useRef(0);
  async function reload() {
    const generation = ++loadGeneration.current;
    const [o, t, m, rq, mp] = await Promise.all([
      api(`/overview?${new URLSearchParams(context)}`),
      api("/tickets"),
      api(`/memories?${new URLSearchParams(context)}`),
      api("/review-questions"),
      api("/memory-proposals"),
    ]);
    if (generation !== loadGeneration.current) return;
    setOverview(o);
    setTickets(t);
    setMemories(m);
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
  const connected = [
    !!settings?.githubConnected,
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
    page === "updates" ? "Что нового" : page === "code" ? "Код репозитория" : page === "settings"
      ? "Настройки"
      : navigation.find((n) => n.id === page)?.label || "Страница не найдена";
  return { settings, assistantOpen, sidebarCollapsed, setSidebarCollapsed, page, memoryProposals, unreadRelease, heading, context, setContext, setRefresh, setAssistantOpen, error, setError, notice, refresh, connected, setPage, busy, run, tickets, overview, memories, inboxTab, completedTab, reviewQuestions, location };
}


export type WorkspaceState = ReturnType<typeof useWorkspace>;
