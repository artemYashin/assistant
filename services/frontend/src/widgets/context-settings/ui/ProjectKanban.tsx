import { StatusBadge } from "../../../entities/ticket/index.js";
import { useStatusSort } from "../model/useStatusSort.js";
import { useEffect, useState } from "react";
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
  const [order, setOrder] = useState<string[] | null>(null);
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
          setOrder([...new Set<string>([...saved.order, ...catalog.states.filter(Boolean)])]);
          setColors(saved.statusColors || {});
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
          await api("/context/kanban", "PUT", { context, order });
          setMessage("Порядок статусов канбана сохранён.");
          onSaved();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Не удалось сохранить порядок.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Канбан · порядок статусов</h3>
      <p className="muted">
        Сверху вниз — порядок столбцов слева направо. Перетащите статус или используйте стрелки.
        Видимые столбцы выбираются фильтром «Статус» на странице тикетов. Новые статусы добавляются
        справа, пока вы не настроите их порядок.
      </p>
      <div className="project-kanban-order" ref={sort.list}>
        {order?.map((state, index) => (
          <div
            key={state}
            className={`project-kanban-order-row${sort.isActive(index) ? " is-dragging" : ""}`}
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
          </div>
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
