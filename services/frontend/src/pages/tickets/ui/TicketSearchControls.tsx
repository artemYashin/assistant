import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import "./ticket-search-controls.css";

const visibilityKey = "orbit.ticket-search-controls.expanded";

export function TicketSearchControls({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(visibilityKey) !== "false";
    } catch {
      return true;
    }
  });
  const id = useId();
  return (
    <div className="ticket-search-controls">
      <button
        type="button"
        className="secondary ticket-search-controls-toggle"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          try {
            localStorage.setItem(visibilityKey, String(next));
          } catch {
            // Keep the toggle usable when browser storage is unavailable.
          }
        }}
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
