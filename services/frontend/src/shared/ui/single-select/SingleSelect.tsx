import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { Check, ChevronDown, Search, LoaderCircle } from "lucide-react";

export function SingleSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  onSearch,
  searchable = true,
  active = false,
  loading = false,
  loadingLabel = "Загрузка…",
  onOpen,
  renderOption,
  floating = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  searchable?: boolean;
  active?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  renderOption?: (option: { value: string; label: string }) => ReactNode;
  floating?: boolean;
  onOpen?: () => void;
  onSearch?: (query: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    search = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({
    position: "fixed",
    top: 0,
    left: 0,
  });
  const id = useId();
  useLayoutEffect(() => {
    if (!open || !floating) return;
    const element = panel.current;
    if (!element) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upwards = below < 240 && above > below;
      const height = Math.max(80, Math.min(360, upwards ? above : below));
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 24);
      setPosition({
        position: "fixed",
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        right: "auto",
        top: upwards ? "auto" : rect.bottom + 4,
        bottom: upwards ? window.innerHeight - rect.top + 4 : "auto",
        width,
        minWidth: 0,
        maxHeight: height,
        overflowY: "auto",
        margin: 0,
        zIndex: 1000,
      });
    };
    // Keep focus inside the owning dialog while escaping its scroll area.
    element.showPopover();
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      if (element.matches(":popover-open")) element.hidePopover();
    };
  }, [open, floating]);
  useEffect(() => {
    if (!open) return;
    search.current?.focus({ preventScroll: true });
    const outside = (e: Event) => {
      if (!root.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node))
        setOpen(false);
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
  const dropdown = open ? (
    <div
      ref={panel}
      popover={floating ? "manual" : undefined}
      style={floating ? position : undefined}
      className="multi-select-panel"
      id={`${id}-panel`}
      role="dialog"
      aria-labelledby={`${id}-label`}
    >
      {searchable && (
        <div className="multi-select-search">
          <Search size={15} />
          <input
            ref={search}
            aria-label={`Поиск: ${label}`}
            placeholder="Найти…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              onSearch?.(e.target.value);
            }}
          />
        </div>
      )}
      <div className="multi-select-options" aria-busy={loading}>
        {loading && (
          <p className="multi-select-empty" role="status">
            <LoaderCircle size={15} className="spin" aria-hidden="true" /> {loadingLabel}
          </p>
        )}
        {visible.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`single-select-option${value === o.value ? " is-selected" : ""}`}
            aria-pressed={value === o.value}
            onClick={() => {
              setOpen(false);
              trigger.current?.focus({ preventScroll: true });
              onChange(o.value);
            }}
          >
            <span>{renderOption ? renderOption(o) : o.label}</span>
            {value === o.value && <Check size={16} aria-hidden="true" />}
          </button>
        ))}
        {!loading && !visible.length && <p className="multi-select-empty">Ничего не найдено</p>}
      </div>
    </div>
  ) : null;
  return (
    <div
      className="single-select"
      ref={root}
      onKeyDown={(e) => {
        if (!open) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus({ preventScroll: true });
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const buttons = Array.from(
            panel.current?.querySelectorAll<HTMLButtonElement>(".single-select-option") || [],
          );
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            current < 0
              ? e.key === "ArrowDown"
                ? 0
                : buttons.length - 1
              : (current + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
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
        className={`multi-select-trigger${active ? " has-selection" : ""}`}
        disabled={disabled}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={`${id}-panel`}
        onClick={() => {
          setQuery("");
          onSearch?.("");
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        <span id={`${id}-value`}>
          {renderOption
            ? renderOption(
                options.find((o) => o.value === value) || { value, label: value || "Выберите…" },
              )
            : options.find((o) => o.value === value)?.label || value || "Выберите…"}
        </span>
        {loading ? (
          <LoaderCircle size={16} className="spin" aria-label={loadingLabel} />
        ) : (
          <ChevronDown size={16} className={open ? "is-open" : ""} />
        )}
      </button>
      {dropdown}
    </div>
  );
}
