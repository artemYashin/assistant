import { type ReactNode, useEffect, useId, useRef, useState } from "react";
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
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
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
        <span id={`${id}-value`}>{value.length ? selectedLabel : placeholder}</span>
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
