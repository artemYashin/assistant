import { TicketCard } from "../../widgets/ticket/index.js";
import { WorkModeContext } from "../../entities/work-mode/index.js";
import { workMode } from "../../../../backend/src/work-mode.js";
import { Assistant } from "../../widgets/assistant/index.js";
import { useWorkspace } from "../model/useWorkspace.js";
import { WorkspaceSidebar } from "./WorkspaceSidebar.js";
import { WorkspaceHeader } from "./WorkspaceHeader.js";
import { WorkspacePages } from "./WorkspacePages.js";

export function Workspace() {
  const {
    settings,
    assistantOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
    page,
    memoryProposals,
    unreadRelease,
    heading,
    context,
    setContext,
    setRefresh,
    setAssistantOpen,
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
  } = useWorkspace();
  return (
    <WorkModeContext.Provider value={workMode(settings)}>
      <div className={`workspace ${assistantOpen ? "with-assistant" : ""}`}>
        <WorkspaceSidebar
          settings={settings}
          sidebarCollapsed={sidebarCollapsed}
          setSidebarCollapsed={setSidebarCollapsed}
          page={page}
          memoryProposals={memoryProposals}
          unreadRelease={unreadRelease}
        />
        <div className="main-shell">
          <WorkspaceHeader
            settings={settings}
            assistantOpen={assistantOpen}
            memoryProposals={memoryProposals}
            heading={heading}
            context={context}
            setContext={setContext}
            setRefresh={setRefresh}
            setAssistantOpen={setAssistantOpen}
          />
          <div className="work-area">
            <WorkspacePages
              settings={settings}
              page={page}
              memoryProposals={memoryProposals}
              context={context}
              setRefresh={setRefresh}
              error={error}
              setError={setError}
              notice={notice}
              refresh={refresh}
              connected={connected}
              setPage={setPage}
              busy={busy}
              run={run}
              tickets={tickets}
              overview={overview}
              memories={memories}
              inboxTab={inboxTab}
              completedTab={completedTab}
              reviewQuestions={reviewQuestions}
              location={location}
            />
            <Assistant
              ticketCard={TicketCard}
              open={assistantOpen}
              onExpand={() => setAssistantOpen(true)}
              onCollapse={() => {
                setAssistantOpen(false);
                document.getElementById("assistant-toggle")?.focus();
              }}
              context={context}
              voiceCurrentPress={settings?.voiceCurrentPress}
              voiceNewPress={settings?.voiceNewPress}
              voiceCurrentKey={settings?.voiceCurrentKey}
              voiceNewKey={settings?.voiceNewKey}
              connected={settings?.githubConnected}
              azureSource={
                settings?.azureUrl
                  ? `${settings.azureUrl.replace(/\/$/, "")}|${settings.azureProject}`
                  : undefined
              }
              onChange={() => setRefresh((n) => n + 1)}
              onSettings={() => setPage("settings")}
              onApprovals={() => setPage("approvals")}
              pending={memoryProposals.filter((p) => p.status === "pending").length}
            />
          </div>
        </div>
      </div>
    </WorkModeContext.Provider>
  );
}
