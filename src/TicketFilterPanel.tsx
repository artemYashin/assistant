import {
  customerPresetKey,
  migrateCustomerPresets,
} from "./ticket-preset-storage.js";
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
  const [presetStorageKey] = useState(() => {
    try {
      return migrateCustomerPresets(localStorage, storageKey);
    } catch {
      return customerPresetKey(storageKey);
    }
  });
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(storageKey + ".expanded") !== "false";
    } catch {
      return true;
    }
  });
  const id = useId();
  const [resetVersion, setResetVersion] = useState(0);
  return (
    <section
      className={`ticket-filter-panel${expanded ? "" : " is-collapsed"}`}
      aria-label="Наборы и фильтры тикетов"
      onClickCapture={event => { if (event.target instanceof Element && event.target.closest(".ticket-filter-reset")) setResetVersion(value => value + 1); }}
    >
      <button
        type="button"
        className="ticket-filter-panel-heading"
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
        <span className="ticket-filter-panel-title">
          <Bookmark size={15} aria-hidden="true" />
          Наборы фильтров
        </span>
        <span className="ticket-filter-panel-toggle">
          {expanded ? (
            <ChevronUp size={16} aria-hidden="true" />
          ) : (
            <ChevronDown size={16} aria-hidden="true" />
          )}
          {expanded ? "Свернуть" : "Развернуть"}
        </span>
      </button>
      <div id={id}>
        <TicketFilterPresets
          storageKey={presetStorageKey}
          filters={filters}
          onApply={onApply}
          disabled={disabled}
          compact={!expanded}
          resetVersion={resetVersion}
        />
        {expanded && children}
      </div>
    </section>
  );
}
