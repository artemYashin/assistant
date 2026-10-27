import { Cloud } from "lucide-react";
import { TicketTrash } from "../../pages/tickets/index.js";
import { Link } from "react-router-dom";
import { Ticket, Trash2 } from "lucide-react";
import { TicketViewSwitch, useTicketView, Tickets } from "../../pages/tickets/index.js";
import type { WorkspaceState } from "../model/useWorkspace.js";

type Props = Pick<
  WorkspaceState,
  | "settings"
  | "page"
  | "context"
  | "setRefresh"
  | "busy"
  | "run"
  | "tickets"
  | "overview"
  | "location"
>;

export function TicketsBlock({
  settings,
  page,
  context,
  setRefresh,
  busy,
  run,
  tickets,
  overview,
  location,
}: Props) {
  const [view, setView] = useTicketView();
  return (
    <>
      {page === "tickets" && (
        <div className="ticket-page-navigation">
          <nav className="pr-page-tabs" aria-label="Разделы тикетов">
            <Link
              to="/tickets"
              aria-current={
                !["trash", "azure"].includes(new URLSearchParams(location.search).get("tab") || "")
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
                new URLSearchParams(location.search).get("tab") === "azure" ? "page" : undefined
              }
            >
              <Cloud size={16} />
              Azure тикеты
            </Link>
            <Link
              to="/tickets?tab=trash"
              aria-current={
                new URLSearchParams(location.search).get("tab") === "trash" ? "page" : undefined
              }
            >
              <Trash2 size={16} />
              Корзина
            </Link>
          </nav>
          <TicketViewSwitch view={view} onChange={setView} />
        </div>
      )}
      {page === "tickets" && new URLSearchParams(location.search).get("tab") === "trash" && (
        <TicketTrash
          view={view}
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
      {page === "tickets" && new URLSearchParams(location.search).get("tab") !== "trash" && (
        <Tickets
          view={view}
          azureMode={new URLSearchParams(location.search).get("tab") === "azure"}
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
    </>
  );
}
