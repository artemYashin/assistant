import { useId, useState, type ReactNode } from "react";
import { Bookmark, ChevronDown, ChevronUp } from "lucide-react";
import { TicketFilterPresets } from "./TicketFilterPresets.js";
import type { Filters } from "./useTicketFilters.js";

export function TicketFilterPanel({
  storageKey,
  filters,
  onApply,
  disabled = false,
  children,
}: {
  storageKey: string;
  filters: Filters;
  onApply: (filters: Filters) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(storageKey + ".expanded") !== "false";
    } catch {
      return true;
    }
  });
  const id = useId();
  return (
    <section
      className={`ticket-filter-panel${expanded ? "" : " is-collapsed"}`}
      aria-label="Наборы и фильтры тикетов"
    >
      <div className="ticket-filter-panel-heading">
        <strong>
          <Bookmark size={15} />
          Наборы фильтров
        </strong>
        <button
          type="button"
          className="text-button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            try {
              localStorage.setItem(storageKey + ".expanded", String(next));
            } catch {
              /* Optional storage. */
            }
          }}
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {expanded ? "Свернуть" : "Развернуть"}
        </button>
      </div>
      <div id={id}>
        <TicketFilterPresets
          storageKey={storageKey + ".presets"}
          filters={filters}
          onApply={onApply}
          disabled={disabled}
          compact={!expanded}
        />
        {expanded && children}
      </div>
    </section>
  );
}
