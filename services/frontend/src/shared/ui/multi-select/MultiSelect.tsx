import {
  type ReactNode,
  type CSSProperties,
  useLayoutEffect,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { InitialsAvatar } from "../initials-avatar/index.js";
import { Check, ChevronDown, Info, Search } from "lucide-react";

type Option = {
  value: string;
  label: string;
  group?: string;
  avatarName?: string;
};
type SearchResult = { options: Option[]; warning?: string };
export function MultiSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled = false,
  searchOptions,
  allowCustom = false,
  renderOption,
  renderSelected,
  floating = false,
}: {
  label: string;
  placeholder: string;
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  searchOptions?: (query: string) => Promise<SearchResult>;
  allowCustom?: boolean;
  renderOption?: (option: Option) => ReactNode;
  renderSelected?: (option: Option) => ReactNode;
  floating?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<SearchResult>({ options: [] });
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  useEffect(() => {
    let live = true;
    setRemote({ options: [] });
    setSearchError("");
    setSearching(false);
    if (!open || disabled || !searchOptions || query.trim().length < 2) return;
    setSearching(true);
    const timer = setTimeout(() => {
      searchOptions(query.trim())
        .then((result) => {
          if (live) setRemote(result);
        })
        .catch((error) => {
          if (live) setSearchError(error.message);
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, disabled, query, searchOptions]);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ position: "fixed", top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!open || !floating) return;
    const element = panel.current;
    if (!element) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upwards = below < 260 && above > below;
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 24);
      setPosition({
        position: "fixed",
        margin: 0,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        right: "auto",
        top: upwards ? "auto" : rect.bottom + 4,
        bottom: upwards ? window.innerHeight - rect.top + 4 : "auto",
        width,
        maxHeight: Math.max(80, Math.min(420, upwards ? above : below)),
        overflowY: "auto",
      });
    };
    // The native top layer escapes the dialog's scrolling/clipping area while
    // keeping the dropdown inside its DOM tree for focus and outside-click handling.
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
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
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
  const localVisible: Option[] = [
    ...options,
    ...(allowCustom
      ? value
          .filter((v) => !options.some((o) => o.value === v))
          .map((v) => ({ value: v, label: v, group: undefined }))
      : []),
  ].filter((o) =>
    `${o.label} ${o.group || ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const visible = [
    ...localVisible,
    ...remote.options.filter(
      (option) => !localVisible.some((known) => known.value === option.value),
    ),
  ];
  const selectedLabel =
    value.length === 1
      ? options.find((o) => o.value === value[0])?.label || value[0] || "Выбрано: 1"
      : `Выбрано: ${value.length}`;
  return (
    <div
      className="multi-select"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
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
        <span
          id={`${id}-value`}
          className={renderSelected && value.length ? "multi-select-selected-badges" : undefined}
          title={
            renderSelected && value.length
              ? value
                  .map((item) => options.find((option) => option.value === item)?.label || item)
                  .join(", ")
              : undefined
          }
        >
          {value.length
            ? renderSelected
              ? value.map((item) => {
                  const option = options.find((option) => option.value === item) || {
                    value: item,
                    label: item,
                  };
                  return <span key={item}>{renderSelected(option)}</span>;
                })
              : selectedLabel
            : placeholder}
        </span>
        {value.length > 0 && !renderSelected && (
          <span className="multi-select-count" aria-hidden="true">
            {value.length}
          </span>
        )}
        <ChevronDown size={16} className={open ? "is-open" : ""} />
      </button>
      {open && (
        <div
          ref={panel}
          popover={floating ? "manual" : undefined}
          style={floating ? position : undefined}
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
              placeholder={searchOptions ? "Имя или e-mail · от 2 символов" : "Найти…"}
              maxLength={searchOptions ? 100 : undefined}
            />
          </div>
          <div className="multi-select-options">
            {allowCustom &&
              query.trim() &&
              !options.some((o) => o.value === query.trim()) &&
              !value.includes(query.trim()) && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    onChange([...value, query.trim()]);
                    setQuery("");
                  }}
                >
                  Добавить фильтр «{query.trim()}»
                </button>
              )}
            {visible.map((option, index) => (
              <div key={option.value}>
                {option.group && option.group !== visible[index - 1]?.group && (
                  <div className="multi-select-group">{option.group}</div>
                )}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={value.includes(option.value)}
                  disabled={disabled}
                  className={`multi-select-option${value.includes(option.value) ? " is-selected" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    onChange(
                      value.includes(option.value)
                        ? value.filter((item) => item !== option.value)
                        : [...value, option.value],
                    )
                  }
                >
                  <span className="multi-select-check" aria-hidden="true">
                    {value.includes(option.value) && <Check size={13} />}
                  </span>
                  {option.avatarName && <InitialsAvatar name={option.avatarName} />}
                  <span className="multi-select-option-text">
                    {renderOption ? renderOption(option) : option.label}
                  </span>
                </button>
              </div>
            ))}
            {!visible.length && !searching && !searchError && (
              <p className="multi-select-empty">Ничего не найдено</p>
            )}
            {searching && (
              <p className="multi-select-empty" role="status">
                Поиск в Azure…
              </p>
            )}
            {(remote.warning || searchError) && (
              <details className="multi-select-search-notice">
                <summary>
                  <Info size={13} aria-hidden="true" />
                  {searchError ? "Ошибка поиска" : "Поиск ограничен"}
                </summary>
                <p>{searchError || remote.warning}</p>
              </details>
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
