import { useId, useState } from "react";
import { LoaderCircle, Search, Ticket, Plus } from "lucide-react";
import "./ticket-autocomplete.css";

export type RelatedTicket = {
  id: number;
  source: string;
  title: string;
  type: string;
  state: string;
  inTrash?: boolean;
};

export function TicketAutocomplete({
  value,
  onChange,
  tickets,
  disabled,
  loading,
  onFocus,
  label = "Номер тикета",
}: {
  value: string;
  onChange: (value: string) => void;
  tickets: RelatedTicket[];
  disabled: boolean;
  loading: boolean;
  onFocus?: () => void;
  label?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const query = value.trim().replace(/^#/, "").toLocaleLowerCase();
  const results = query
    ? tickets
        .filter((t) => String(t.id).includes(query) || t.title.toLocaleLowerCase().includes(query))
        .slice(0, 20)
    : [];
  const choose = (ticket: RelatedTicket) => {
    onChange(String(ticket.id));
    setOpen(false);
    setActive(-1);
  };
  return (
    <div
      className="ticket-autocomplete"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="export-ticket-search">
        <Search size={16} />
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && !disabled}
          aria-controls={id + "-results"}
          aria-activedescendant={
            open && active >= 0 && results[active] ? id + "-option-" + active : undefined
          }
          value={value}
          disabled={disabled}
          placeholder="Номер или название тикета"
          onFocus={() => {
            setOpen(true);
            onFocus?.();
          }}
          onChange={(e) => {
            onChange(e.target.value.replace(/^#/, ""));
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
            if ((e.key === "ArrowDown" || e.key === "ArrowUp") && results.length) {
              e.preventDefault();
              setActive(
                (old) =>
                  (old + (e.key === "ArrowDown" ? 1 : results.length - 1) + results.length) %
                  results.length,
              );
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (active >= 0 && results[active]) choose(results[active]);
            }
          }}
        />
      </div>
      {open && !disabled && (query || loading) && (
        <div
          className="export-ticket-results"
          id={id + "-results"}
          role="listbox"
          aria-label="Найденные тикеты"
        >
          {loading && (
            <span role="status">
              <LoaderCircle size={14} className="spin" /> Загрузка…
            </span>
          )}
          {results.map((ticket, index) => (
            <button
              type="button"
              role="option"
              id={id + "-option-" + index}
              key={ticket.id}
              aria-selected={index === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(ticket)}
            >
              <Ticket size={15} />
              <span>
                <strong>#{ticket.id}</strong> {ticket.title}
                <small>
                  {ticket.type} · {ticket.state}
                  {ticket.inTrash ? " · В корзине" : ""}
                </small>
              </span>
              <Plus size={15} />
            </button>
          ))}
          {!loading && !results.length && (
            <span className="muted">
              {query
                ? "Нет подсказок. Можно указать номер вручную."
                : "Введите номер или название тикета."}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
