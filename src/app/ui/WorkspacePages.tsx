import { hasLocalManagement } from "../../../server/work-mode.js";
import { NotesPage } from "../../pages/notes/index.js";
import { UpdatesPage } from "../../pages/updates/index.js";
import { CalendarPage } from "../../pages/calendar/index.js";
import { FieldDictation } from "../../features/voice-input/index.js";
import { CodeBrowserPage } from "../../pages/code-repository/index.js";
import { DevelopersPage } from "../../pages/developers/index.js";
import { TicketExportDialog } from "../../features/export-tickets/ui/index.js";
import { Link } from "react-router-dom";
import { Check, LockKeyhole, X } from "lucide-react";
import { Usage } from "../../pages/usage/index.js";
import { Memory } from "../../pages/memory/index.js";
import { Settings } from "../../pages/settings/index.js";
import { OverviewBlock } from "./OverviewBlock.js";
import { PullRequestsBlock } from "./PullRequestsBlock.js";
import { TicketsBlock } from "./TicketsBlock.js";
import { ApprovalsBlock } from "./ApprovalsBlock.js";
import type { WorkspaceState } from "../model/useWorkspace.js";

type Props = Pick<WorkspaceState,
  "settings"
  | "page"
  | "memoryProposals"
  | "context"
  | "setRefresh"
  | "error"
  | "setError"
  | "notice"
  | "refresh"
  | "connected"
  | "setPage"
  | "busy"
  | "run"
  | "tickets"
  | "overview"
  | "memories"
  | "inboxTab"
  | "completedTab"
  | "reviewQuestions"
  | "location"
>;

export function WorkspacePages({
  settings,
  page,
  memoryProposals,
  context,
  setRefresh,
  error,
  setError,
  notice,
  refresh,
  connected,
  setPage,
  busy,
  run,
  tickets,
  overview,
  memories,
  inboxTab,
  completedTab,
  reviewQuestions,
  location,
}: Props) {
  return (<main>
            <TicketExportDialog settings={settings} key={JSON.stringify([context, settings?.azureUrl, settings?.azureProject])} />
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
            {page === "notes" && <NotesPage />}
            {page === "updates" && <UpdatesPage />}
            {page === "calendar" && settings && <CalendarPage settings={settings} context={context} />}
            {page === "code" && <CodeBrowserPage key={JSON.stringify([context, refresh, settings?.azureUrl, settings?.azureProject])} context={context} />}
            <OverviewBlock
        page={page}
        context={context}
        connected={connected}
        setPage={setPage}
        busy={busy}
        run={run}
        tickets={tickets}
        overview={overview}
        memories={memories}
      />
            <PullRequestsBlock
        settings={settings}
        page={page}
        context={context}
        setRefresh={setRefresh}
        inboxTab={inboxTab}
        completedTab={completedTab}
        reviewQuestions={reviewQuestions}
      />



            <TicketsBlock
        settings={settings}
        page={page}
        context={context}
        setRefresh={setRefresh}
        busy={busy}
        run={run}
        tickets={tickets}
        overview={overview}
        location={location}
      />


            {page === "developers" && !settings && <p role="status">Загружаем настройки разработчиков…</p>}
            {page === "developers" && settings && hasLocalManagement(settings) && (
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
            <ApprovalsBlock
        page={page}
        memoryProposals={memoryProposals}
        context={context}
        setRefresh={setRefresh}
        busy={busy}
      />
            {page === "memory" && (
              <Memory
                memories={memories}
                context={context}
                run={run}
                busy={busy}
              />
            )}
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
            <FieldDictation binding={settings?.voiceInputKey ?? "Ctrl+KeyI"} press={settings?.voiceInputPress ?? "single"} />
            <footer className="main-footer">
              <span>
                orbit <span className="footer-dot">·</span> пространство для
                ясности
              </span>
              <span>
                <LockKeyhole size={12} /> На вашем устройстве
              </span>
            </footer>
          </main>);
}
