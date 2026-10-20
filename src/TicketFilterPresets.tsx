import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark, Save, X } from "lucide-react";
import { parseTicketFilters, type Filters } from "./useTicketFilters.js";

type Preset = { id: string; name: string; filters: Filters };
export function TicketFilterPresets({
  storageKey,
  filters,
  onApply,
  disabled,
}: {
  storageKey: string;
  filters: Filters;
  onApply: (filters: Filters) => void;
  disabled: boolean;
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
  const [pendingDelete, setPendingDelete] = useState<Preset | null>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (pendingDelete) confirmDialog.current?.showModal();
  }, [pendingDelete]);
  const [name, setName] = useState("");
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
      <div className="ticket-preset-heading">
        <strong>
          <Bookmark size={15} /> Наборы фильтров
        </strong>
        <form
          className="ticket-preset-save"
          onSubmit={(event) => {
            event.preventDefault();
            const title = name.trim();
            if (!title || disabled) return;
            if (
              presets.some(
                (p) => p.name.toLocaleLowerCase() === title.toLocaleLowerCase(),
              )
            ) {
              setError(
                "Набор с таким названием уже есть. Выберите другое название или удалите старый набор.",
              );
              return;
            }
            if (
              save([
                ...presets,
                {
                  id: crypto.randomUUID(),
                  name: title,
                  filters: parseTicketFilters(filters),
                },
              ])
            )
              setName("");
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
      {presets.length > 0 && (
        <div className="ticket-preset-list">
          {presets.map((preset) => {
            const active =
              JSON.stringify(preset.filters) === JSON.stringify(filters);
            return (
              <div
                className={`ticket-preset${active ? " is-active" : ""}`}
                key={preset.id}
              >
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  title={`Применить набор: ${preset.name}`}
                  onClick={() => onApply(preset.filters)}
                >
                  {preset.name}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Удалить набор ${preset.name}`}
                  title="Удалить сохранённый набор"
                  aria-haspopup="dialog"
                  onClick={() => {
                    setError("");
                    setPendingDelete(preset);
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {pendingDelete &&
        createPortal(
          <dialog
            ref={confirmDialog}
            className="developer-dialog preset-delete-dialog"
            aria-label="Удалить набор фильтров"
            onCancel={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setPendingDelete(null);
            }}
          >
            <div className="developer-dialog-heading">
              <strong>Удалить набор фильтров?</strong>
              <button
                type="button"
                className="icon-button"
                aria-label="Закрыть"
                onClick={() => setPendingDelete(null)}
              >
                <X size={18} />
              </button>
            </div>
            <p>
              Вы действительно хотите удалить набор{" "}
              <strong className="preset-delete-name">
                «{pendingDelete.name}»
              </strong>
              ?
            </p>
            <p className="muted">
              Текущие фильтры и тикеты останутся без изменений.
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
                onClick={() => setPendingDelete(null)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  if (save(presets.filter((p) => p.id !== pendingDelete.id)))
                    setPendingDelete(null);
                }}
              >
                Удалить набор
              </button>
            </div>
          </dialog>,
          document.body,
        )}
      {error && !pendingDelete && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
