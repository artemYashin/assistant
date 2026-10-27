import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import "./ticket-search-controls.css";

export function TicketSearchControls({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const id = useId();
  return (
    <div className="ticket-search-controls">
      <button
        type="button"
        className="secondary ticket-search-controls-toggle"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        {expanded ? "Спрятать фильтры" : "Показать фильтры"}
      </button>
      <div id={id} className="ticket-search-controls-content" hidden={!expanded}>
        {children}
      </div>
    </div>
  );
}
