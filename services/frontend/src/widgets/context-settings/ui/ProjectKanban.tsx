import { StatusBadge } from "../../../entities/ticket/index.js";
import { useStatusSort } from "../model/useStatusSort.js";
import { useEffect, useId, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { ContextSaveButton } from "../../../shared/ui/save-button/index.js";

export function ProjectKanban({
  context,
  onSaved,
}: {
  context: { client: string; project: string };
  onSaved: () => void;
}) {
  const checkboxId = useId();
  const [order, setOrder] = useState<string[] | null>(null);
  const [hiddenStates, setHiddenStates] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [colors, setColors] = useState<Record<string, string>>({});
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({
      client: context.client,
      project: context.project,
    }).toString();
    Promise.all([
      api(`/context/kanban?${query}`, "GET", undefined, controller.signal),
      api(`/tickets/filter-options?${query}`, "GET", undefined, controller.signal),
    ])
      .then(([saved, catalog]) => {
        if (!controller.signal.aborted) {
          setOrder([
            ...new Set<string>([
              ...saved.order,
              ...(saved.hiddenStates || []),
              ...catalog.states.filter(Boolean),
            ]),
          ]);
          setColors(saved.statusColors || {});
          setHiddenStates(saved.hiddenStates || []);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [context.client, context.project]);
  function move(from: number, to: number) {
    setOrder((previous) => {
      if (!previous || from < 0 || to < 0 || to >= previous.length) return previous;
      const next = [...previous];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
    setMessage("");
  }
  const sort = useStatusSort(move);
  if (!context.client || !context.project)
    return <p className="muted">Выберите заказчика и проект для настройки канбана.</p>;
  return (
    <form
      className="project-import-panel"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!order || busy || sort.dragging) return;
        setBusy(true);
        setError("");
        setMessage("");
        try {
          await api("/context/kanban", "PUT", { context, order, hiddenStates });
          setMessage("Настройки канбана сохранены.");
          onSaved();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Не удалось сохранить настройки.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Канбан · статусы</h3>
      <p className="muted">
        Сверху вниз — порядок столбцов слева направо. Перетащите статус или используйте стрелки.
        Нажмите на строку или снимите галочку, чтобы скрыть статус из канбана. Фильтр «Статус»
        дополнительно сужает список включённых столбцов. Новые статусы добавляются справа, пока вы
        не настроите их порядок.
      </p>
      <div className="project-kanban-order" ref={sort.list}>
        {order?.map((state, index) => (
          <label
            key={state}
            htmlFor={`${checkboxId}-${index}`}
            className={`project-kanban-order-row${sort.isActive(index) ? " is-dragging" : ""}${hiddenStates.includes(state) ? " is-hidden" : ""}`}
            style={sort.style(index)}
          >
            <button
              type="button"
              className="icon-button project-kanban-drag-handle"
              aria-label={`Перетащить: ${state}`}
              title="Перетащите для изменения порядка. Escape — отмена"
              disabled={busy}
              {...sort.handlers(index)}
            >
              <GripVertical size={15} />
            </button>
            <input
              id={`${checkboxId}-${index}`}
              type="checkbox"
              aria-label={`Показывать в канбане: ${state}`}
              checked={!hiddenStates.includes(state)}
              disabled={busy || sort.dragging}
              onChange={(event) => {
                setHiddenStates((previous) =>
                  event.target.checked
                    ? previous.filter((item) => item !== state)
                    : [...previous, state],
                );
                setMessage("");
              }}
            />
            <span className="project-kanban-status">
              <StatusBadge state={state} colors={colors} />
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label={`Выше: ${state}`}
              disabled={busy || sort.dragging || index === 0}
              onClick={() => move(index, index - 1)}
            >
              <ArrowUp size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Ниже: ${state}`}
              disabled={busy || sort.dragging || index === order.length - 1}
              onClick={() => move(index, index + 1)}
            >
              <ArrowDown size={16} />
            </button>
          </label>
        ))}
      </div>
      {order?.length === 0 && (
        <p className="muted">
          Статусы пока не загружены. Подключите Azure и загрузите справочник типов и статусов.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <ContextSaveButton type="submit" busy={busy} disabled={!order || sort.dragging} />
    </form>
  );
}
