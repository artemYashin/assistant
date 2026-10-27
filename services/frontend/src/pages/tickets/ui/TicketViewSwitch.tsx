import { useState } from "react";
import { Columns3, Table2 } from "lucide-react";
import { parseTicketView, TICKET_VIEW_KEY, type TicketView } from "../model/kanban.js";
import "./ticket-kanban.css";

export function useTicketView() {
  const [view, setView] = useState<TicketView>(() => {
    try {
      return parseTicketView(localStorage.getItem(TICKET_VIEW_KEY));
    } catch {
      return "table";
    }
  });
  return [
    view,
    (next: TicketView) => {
      setView(next);
      try {
        localStorage.setItem(TICKET_VIEW_KEY, next);
      } catch {
        /* Browser storage is optional. */
      }
    },
  ] as const;
}
export function TicketViewSwitch({
  view,
  onChange,
}: {
  view: TicketView;
  onChange: (view: TicketView) => void;
}) {
  return (
    <div className="ticket-view-switch" role="group" aria-label="Вид тикетов">
      <button type="button" aria-pressed={view === "table"} onClick={() => onChange("table")}>
        <Table2 size={16} />
        Таблица
      </button>
      <button type="button" aria-pressed={view === "kanban"} onClick={() => onChange("kanban")}>
        <Columns3 size={16} />
        Канбан
      </button>
    </div>
  );
}
