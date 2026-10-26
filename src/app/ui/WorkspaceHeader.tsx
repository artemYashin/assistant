import { CalendarNotifications } from "../../widgets/calendar-notifications/index.js";
import { ChevronRight, PanelRightClose, PanelRightOpen } from "lucide-react";
import { ContextPicker } from "../../widgets/context-settings/index.js";
import { TicketLookupDialog } from "./TicketLookupDialog.js";
import type { WorkspaceState } from "../model/useWorkspace.js";

type Props = Pick<WorkspaceState,
  "settings"
  | "assistantOpen"
  | "memoryProposals"
  | "heading"
  | "context"
  | "setContext"
  | "setRefresh"
  | "setAssistantOpen"
>;

export function WorkspaceHeader({
  settings,
  assistantOpen,
  memoryProposals,
  heading,
  context,
  setContext,
  setRefresh,
  setAssistantOpen,
}: Props) {
  return (<header className="topbar">
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
            <TicketLookupDialog shortcutKey={settings?.ticketOpenKey ?? "KeyT"} shortcutPress={settings?.ticketOpenPress ?? "single"}
              key={`${settings?.azureUrl}:${settings?.azureProject}`}
            />
            <CalendarNotifications settings={settings} pending={memoryProposals.filter(p => p.status === "pending").length} />
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
        </header>);
}
