import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical, Save, X } from "lucide-react";
import { parseTicketFilters, type Filters } from "./useTicketFilters.js";

function sameFilters(left: Filters, right: Filters) {
  const canonical = (value: Filters) =>
    JSON.stringify(
      Object.entries(parseTicketFilters(value)).map(([key, entry]) => [
        key,
        Array.isArray(entry) ? [...new Set(entry)].sort() : entry,
      ]),
    );
  return canonical(left) === canonical(right);
}
type Preset = { id: string; name: string; filters: Filters };
export function TicketFilterPresets({
  storageKey,
  filters,
  onApply,
  disabled,
  compact = false,
}: {
  storageKey: string;
  filters: Filters;
  onApply: (filters: Filters) => void;
  disabled: boolean;
  compact?: boolean;
}) {
  const [presets, setPresets] = useState<Preset[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(raw)
        ? raw
            .filter(
              (p) =>
                p &&
                typeof p.id === "string" &&
                typeof p.name === "string" &&
                p.name.trim(),
            )
            .map((p) => ({
              id: p.id,
              name: p.name,
              filters: parseTicketFilters(p.filters),
            }))
        : [];
    } catch {
      return [];
    }
  });
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(storageKey + ".selected");
      if (saved && presets.some((p) => p.id === saved)) return saved;
    } catch {
      /* Optional browser storage. */
    }
    return presets.find((p) => sameFilters(p.filters, filters))?.id || null;
  });
  function select(preset: Preset | null) {
    setSelectedId(preset?.id || null);
    setName(preset?.name || "");
    try {
      if (preset) localStorage.setItem(storageKey + ".selected", preset.id);
      else localStorage.removeItem(storageKey + ".selected");
    } catch {
      /* Selection remains usable in this tab. */
    }
  }
  const dragged = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    after: boolean;
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  function finishDrag() {
    dragged.current = null;
    setDragging(null);
    setDropTarget(null);
  }
  function movePreset(id: string, targetId: string, after: boolean) {
    if (id === targetId) return;
    const moving = presets.find((p) => p.id === id);
    const next = presets.filter((p) => p.id !== id);
    const targetIndex = next.findIndex((p) => p.id === targetId);
    if (!moving || targetIndex < 0) return;
    const index = targetIndex + (after ? 1 : 0);
    next.splice(index, 0, moving);
    if (save(next))
      setAnnouncement(
        `Набор «${moving.name}»: позиция ${index + 1} из ${next.length}`,
      );
  }
  const [confirmation, setConfirmation] = useState<{
    kind: "delete" | "overwrite";
    preset: Preset;
    replacement?: Preset;
  } | null>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (confirmation) confirmDialog.current?.showModal();
  }, [confirmation]);
  const [name, setName] = useState(
    () => presets.find((p) => p.id === selectedId)?.name || "",
  );
  const [error, setError] = useState("");
  function save(next: Preset[]) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setPresets(next);
      setError("");
      return true;
    } catch {
      setError(
        "Не удалось сохранить пресеты в браузере. Проверьте доступность локального хранилища.",
      );
      return false;
    }
  }
  return (
    <div className="ticket-filter-presets">
      {!compact && (
        <div className="ticket-preset-heading">
          <form
            className="ticket-preset-save"
            onSubmit={(event) => {
              event.preventDefault();
              const title = name.trim();
              if (!title || disabled) return;
              const existing = presets.find(
                (p) => p.name.toLocaleLowerCase() === title.toLocaleLowerCase(),
              );
              const next = {
                id: existing?.id || crypto.randomUUID(),
                name: title,
                filters: parseTicketFilters(filters),
              };
              setError("");
              if (existing) {
                setConfirmation({
                  kind: "overwrite",
                  preset: existing,
                  replacement: next,
                });
                return;
              }
              if (save([...presets, next])) select(next);
            }}
          >
            <input
              aria-label="Название набора фильтров"
              placeholder="Название набора"
              maxLength={80}
              value={name}
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
            />
            <button
              type="submit"
              className="secondary"
              disabled={disabled || !name.trim()}
              title="Сохранить текущие фильтры, поиск и сортировку"
            >
              <Save size={15} /> Сохранить набор
            </button>
          </form>
        </div>
      )}
      {compact && !presets.length && (
        <p className="muted">
          Наборов пока нет. Разверните блок, чтобы сохранить первый.
        </p>
      )}
      {presets.length > 0 && (
        <div className="ticket-preset-list">
          {presets.map((preset) => {
            const selected = preset.id === selectedId;
            const modified = selected && !sameFilters(preset.filters, filters);
            const active = selected && !modified;
            return (
              <div
                className={`ticket-preset${active ? " is-active" : modified ? " is-modified" : ""}${dragging === preset.id ? " is-dragging" : ""}${dropTarget?.id === preset.id ? (dropTarget.after ? " drop-after" : " drop-before") : ""}`}
                key={preset.id}
                onDragOver={(event) => {
                  if (!dragged.current || dragged.current === preset.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setDropTarget({
                    id: preset.id,
                    after: event.clientX > bounds.left + bounds.width / 2,
                  });
                }}
                onDragLeave={(event) => {
                  if (
                    !event.currentTarget.contains(
                      event.relatedTarget as Node | null,
                    )
                  )
                    setDropTarget(null);
                }}
                onDrop={(event) => {
                  if (!dragged.current) return;
                  event.preventDefault();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  movePreset(
                    dragged.current,
                    preset.id,
                    event.clientX > bounds.left + bounds.width / 2,
                  );
                  finishDrag();
                }}
              >
                {!compact && (
                  <button
                    type="button"
                    className="ticket-preset-drag"
                    draggable={presets.length > 1}
                    disabled={presets.length < 2}
                    title="Перетащить набор"
                    aria-label={`Изменить порядок набора ${preset.name}`}
                    onDragStart={(event) => {
                      dragged.current = preset.id;
                      setDragging(preset.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", preset.id);
                      event.dataTransfer.setDragImage(
                        event.currentTarget.parentElement!,
                        12,
                        12,
                      );
                    }}
                    onDragEnd={finishDrag}
                  >
                    <GripVertical size={14} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="ticket-preset-apply"
                  disabled={disabled}
                  aria-pressed={selected}
                  title={`${preset.name}${modified ? " · изменён — нажмите, чтобы вернуть сохранённые настройки" : active ? " · сохранённые настройки применены" : " · применить набор"}`}
                  onClick={() => {
                    select(preset);
                    onApply(preset.filters);
                  }}
                >
                  {preset.name}
                </button>
                {!compact && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Удалить набор ${preset.name}`}
                    title="Удалить сохранённый набор"
                    aria-haspopup="dialog"
                    onClick={() => {
                      setError("");
                      setConfirmation({ kind: "delete", preset });
                    }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <span className="sr-only" role="status">
        {announcement}
      </span>
      {confirmation &&
        createPortal(
          <dialog
            ref={confirmDialog}
            className="developer-dialog preset-delete-dialog"
            aria-label={
              confirmation.kind === "delete"
                ? "Удалить набор фильтров"
                : "Перезаписать набор фильтров"
            }
            onCancel={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setConfirmation(null);
            }}
          >
            <div className="developer-dialog-heading">
              <strong>
                {confirmation.kind === "delete"
                  ? "Удалить набор фильтров?"
                  : "Перезаписать набор фильтров?"}
              </strong>
              <button
                type="button"
                className="icon-button"
                aria-label="Закрыть"
                onClick={() => setConfirmation(null)}
              >
                <X size={18} />
              </button>
            </div>
            <p>
              {confirmation.kind === "delete"
                ? "Вы действительно хотите удалить набор"
                : "Заменить сохранённые фильтры, поиск и сортировку в наборе"}{" "}
              <strong className="preset-delete-name">
                «{confirmation.preset.name}»
              </strong>
              ?
            </p>
            <p className="muted">
              {confirmation.kind === "delete"
                ? "Текущие фильтры и тикеты останутся без изменений."
                : "Прежние настройки набора будут заменены текущими."}
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="card-actions">
              <button
                type="button"
                className="secondary"
                autoFocus
                onClick={() => setConfirmation(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  if (confirmation.kind === "delete") {
                    if (
                      save(
                        presets.filter((p) => p.id !== confirmation.preset.id),
                      )
                    ) {
                      if (selectedId === confirmation.preset.id) select(null);
                      setConfirmation(null);
                    }
                  } else if (confirmation.replacement) {
                    const replacement = confirmation.replacement;
                    if (
                      save(
                        presets.map((p) =>
                          p.id === replacement.id ? replacement : p,
                        ),
                      )
                    ) {
                      select(replacement);
                      setConfirmation(null);
                    }
                  }
                }}
              >
                {confirmation.kind === "delete"
                  ? "Удалить набор"
                  : "Перезаписать"}
              </button>
            </div>
          </dialog>,
          document.body,
        )}
      {error && !confirmation && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
