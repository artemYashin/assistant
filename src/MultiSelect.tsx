import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

type Option = { value: string; label: string; group?: string };
export function MultiSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  placeholder: string;
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const visible = options.filter((o) =>
    `${o.label} ${o.group || ""}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const selectedLabel =
    value.length === 1
      ? options.find((o) => o.value === value[0])?.label || "Выбрано: 1"
      : `Выбрано: ${value.length}`;
  return (
    <div
      className="multi-select"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <span id={`${id}-label`} className="multi-select-label">
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className={`multi-select-trigger${value.length ? " has-selection" : ""}`}
        disabled={disabled}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => {
          setQuery("");
          setOpen(!open);
        }}
      >
        <span id={`${id}-value`}>
          {value.length ? selectedLabel : placeholder}
        </span>
        {value.length > 0 && (
          <span className="multi-select-count" aria-hidden="true">
            {value.length}
          </span>
        )}
        <ChevronDown size={16} className={open ? "is-open" : ""} />
      </button>
      {open && (
        <div
          id={`${id}-panel`}
          className="multi-select-panel"
          role="group"
          aria-labelledby={`${id}-label`}
        >
          <div className="multi-select-search">
            <Search size={15} />
            <input
              ref={search}
              aria-label={`Поиск: ${label}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти…"
            />
          </div>
          <div className="multi-select-options">
            {visible.map((option, index) => (
              <div key={option.value}>
                {option.group && option.group !== visible[index - 1]?.group && (
                  <div className="multi-select-group">{option.group}</div>
                )}
                <label
                  className={`multi-select-option${value.includes(option.value) ? " is-selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={value.includes(option.value)}
                    onChange={(e) =>
                      onChange(
                        e.target.checked
                          ? [...value, option.value]
                          : value.filter((v) => v !== option.value),
                      )
                    }
                  />
                  <span className="multi-select-check" aria-hidden="true">
                    {value.includes(option.value) && <Check size={13} />}
                  </span>
                  <span>{option.label}</span>
                </label>
              </div>
            ))}
            {!visible.length && (
              <p className="multi-select-empty">Ничего не найдено</p>
            )}
          </div>
          <div className="multi-select-footer">
            <button
              type="button"
              className="text-button"
              disabled={!value.length}
              onClick={() => onChange([])}
            >
              Сбросить
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              Готово
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
