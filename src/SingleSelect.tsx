import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export function SingleSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    search = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const visible = options.filter((o) =>
    o.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div
      className="single-select"
      ref={root}
      onKeyDown={(e) => {
        if (!open) return;
        if (e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const buttons = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>(
              ".single-select-option",
            ) || [],
          );
          const current = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            current < 0
              ? e.key === "ArrowDown"
                ? 0
                : buttons.length - 1
              : (current + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                buttons.length;
          buttons[next]?.focus();
        }
      }}
    >
      <span id={`${id}-label`} className="multi-select-label">
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className="multi-select-trigger"
        disabled={disabled}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={`${id}-panel`}
        onClick={() => {
          setQuery("");
          setOpen(!open);
        }}
      >
        <span id={`${id}-value`}>
          {options.find((o) => o.value === value)?.label ||
            value ||
            "Выберите…"}
        </span>
        <ChevronDown size={16} className={open ? "is-open" : ""} />
      </button>
      {open && (
        <div
          className="multi-select-panel"
          id={`${id}-panel`}
          role="dialog"
          aria-labelledby={`${id}-label`}
        >
          <div className="multi-select-search">
            <Search size={15} />
            <input
              ref={search}
              aria-label={`Поиск: ${label}`}
              placeholder="Найти…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="multi-select-options">
            {visible.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`single-select-option${value === o.value ? " is-selected" : ""}`}
                aria-pressed={value === o.value}
                onClick={() => {
                  setOpen(false);
                  trigger.current?.focus();
                  onChange(o.value);
                }}
              >
                <span>{o.label}</span>
                {value === o.value && <Check size={16} aria-hidden="true" />}
              </button>
            ))}
            {!visible.length && (
              <p className="multi-select-empty">Ничего не найдено</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
