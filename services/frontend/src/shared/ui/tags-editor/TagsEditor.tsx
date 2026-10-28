import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { X, Plus, ChevronDown } from "lucide-react";

export function TagsEditor({
  value,
  onChange,
  disabled,
  label = "Теги",
  known = [],
  loading = false,
  error = "",
  maxTags = 30,
  maxLength = 60,
  forbidSemicolon = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  label?: string;
  known?: string[];
  loading?: boolean;
  error?: string;
  maxTags?: number;
  maxLength?: number;
  forbidSemicolon?: boolean;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [validation, setValidation] = useState("");
  const [placement, setPlacement] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 240,
    transform: "none",
  });
  const input = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const tags = [
    ...new Set(
      value
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  const options = known.filter(
    (tag) =>
      !tags.includes(tag) && tag.toLocaleLowerCase().includes(draft.trim().toLocaleLowerCase()),
  );
  useLayoutEffect(() => {
    if (editing !== null) input.current?.focus();
  }, [editing]);
  useLayoutEffect(() => {
    if (!open || editing === null || disabled) return;
    const element = menu.current;
    if (!element) return;
    element.showPopover();
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const height = Math.min(240, Math.max(60, below >= 160 || below >= above ? below : above));
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 24);
      const upward = below < 160 && above > below;
      setPlacement({
        top: upward ? rect.top - 4 : rect.bottom + 4,
        transform: upward ? "translateY(-100%)" : "none",
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        width,
        maxHeight: height,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (anchor.current) observer.observe(anchor.current);
    window.addEventListener("resize", place);
    const scroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) place();
    };
    window.addEventListener("scroll", scroll, true);
    return () => {
      if (element.matches(":popover-open")) element.hidePopover();
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open, editing, disabled]);
  useEffect(() => {
    if (active >= 0)
      menu.current
        ?.querySelector<HTMLElement>(`[data-option="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  function begin(index: number) {
    setEditing(index);
    setDraft(tags[index] || "");
    setValidation("");
    setActive(-1);
    setOpen(true);
  }
  function close() {
    input.current?.setCustomValidity("");
    setEditing(null);
    setDraft("");
    setOpen(false);
    setValidation("");
  }
  function commit(text = draft) {
    const additions = text
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);
    const next = [...tags];
    if (editing !== null && editing < next.length) next.splice(editing, 1, ...additions);
    else next.push(...additions);
    const unique = [...new Set(next)];
    if (
      unique.length > maxTags ||
      unique.some((tag) => tag.length > maxLength || (forbidSemicolon && tag.includes(";")))
    ) {
      const message = `Не больше ${maxTags} тегов, до ${maxLength} символов в каждом.${forbidSemicolon ? " Точка с запятой внутри тега недопустима." : ""}`;
      input.current?.setCustomValidity(message);
      setValidation(message);
      setOpen(false);
      return;
    }
    onChange(unique.join("\n"));
    close();
  }
  return (
    <div className="local-tags-editor">
      <span className="local-tags-editor-label">{label}</span>
      <div className="local-tags-editor-field" role="group" aria-label={label}>
        {tags.map((tag, index) =>
          editing === index ? null : (
            <span className="local-tags-editor-chip" key={tag}>
              <button
                type="button"
                disabled={disabled}
                title="Редактировать тег"
                onClick={() => begin(index)}
              >
                {tag}
              </button>
              <button
                type="button"
                className="local-tags-editor-remove"
                disabled={disabled}
                aria-label={`Удалить тег ${tag}`}
                onClick={() => {
                  onChange(tags.filter((_, i) => i !== index).join("\n"));
                  close();
                }}
              >
                <X size={12} />
              </button>
            </span>
          ),
        )}
        {editing !== null ? (
          <div className="local-tags-editor-entry" ref={anchor}>
            <div className="local-tags-editor-input-wrap">
              <input
                ref={input}
                aria-label="Новый или существующий тег"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
                placeholder="Введите или выберите тег…"
                maxLength={maxLength}
                disabled={disabled}
                value={draft}
                onChange={(e) => {
                  e.target.setCustomValidity("");
                  setDraft(e.target.value);
                  setActive(-1);
                  setOpen(true);
                  setValidation("");
                }}
                onFocus={() => setOpen(true)}
                onBlur={(e) => {
                  if (
                    anchor.current?.contains(e.relatedTarget as Node) ||
                    menu.current?.contains(e.relatedTarget as Node)
                  )
                    return;
                  commit();
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    commit(open && active >= 0 ? options[active] || draft : draft);
                  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setOpen(true);
                    setActive((n) =>
                      options.length
                        ? (n + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length
                        : -1,
                    );
                  }
                }}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text");
                  if (/[\r\n]/.test(text)) {
                    e.preventDefault();
                    commit(text);
                  }
                }}
              />
              <button
                type="button"
                className="local-tags-editor-toggle"
                disabled={disabled}
                tabIndex={-1}
                aria-label="Показать существующие теги"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen((v) => !v)}
              >
                <ChevronDown size={15} />
              </button>
            </div>
            <button
              type="button"
              className="local-tags-editor-cancel"
              disabled={disabled}
              aria-label="Отменить ввод тега"
              onMouseDown={(e) => e.preventDefault()}
              onClick={close}
            >
              <X size={15} />
            </button>
          </div>
        ) : (
          tags.length < maxTags && (
            <button
              type="button"
              className="text-button local-tags-editor-add"
              disabled={disabled}
              onClick={() => begin(tags.length)}
            >
              <Plus size={14} />
              Добавить тег
            </button>
          )
        )}
      </div>
      {open && editing !== null && !disabled && (
        <div
          ref={menu}
          popover="manual"
          id={id}
          className="local-tags-suggestions"
          role="listbox"
          aria-label={`Существующие теги: ${label}`}
          style={{ ...placement, right: "auto", bottom: "auto" }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {loading ? (
            <p>Загружаю теги…</p>
          ) : options.length ? (
            options.map((tag, index) => (
              <button
                type="button"
                role="option"
                aria-selected={active === index}
                tabIndex={-1}
                id={`${id}-${index}`}
                data-option={index}
                key={tag}
                onClick={() => commit(tag)}
              >
                {tag}
              </button>
            ))
          ) : (
            <p>
              {draft.trim()
                ? "Enter — добавить свой тег"
                : "Существующих тегов нет — введите новый"}
            </p>
          )}
          {error && <p>Подсказки недоступны. Можно ввести тег вручную.</p>}
        </div>
      )}
      {validation && (
        <p className="error" role="alert">
          {validation}
        </p>
      )}
      <span className="muted">
        {tags.length} / {maxTags} · Enter — добавить, Esc — отменить
      </span>
    </div>
  );
}
