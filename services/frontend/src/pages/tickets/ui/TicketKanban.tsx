import { useKanbanScroll } from "./useKanbanScroll.js";
import { InitialsAvatar } from "../../../shared/ui/initials-avatar/index.js";
import { SingleSelect } from "../../../shared/ui/single-select/index.js";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Folder, GripVertical, LoaderCircle, Ticket, X } from "lucide-react";
import { StatusBadge, TicketDate } from "../../../entities/ticket/index.js";
import { api } from "../../../shared/api/http/index.js";
import {
  ticketStateColumns,
  groupedTicketColumns,
  type KanbanGroup,
  type KanbanTicket,
} from "../model/kanban.js";
import "./ticket-kanban.css";

type Move = {
  ticket: KanbanTicket;
  from: string;
  to: string;
  choices?: string[];
  groupName?: string;
};
export function TicketKanban({
  tickets,
  states,
  selectedStates = [],
  settings,
  source,
  disabled = false,
  onChange,
}: {
  tickets: KanbanTicket[];
  states: string[];
  selectedStates?: string[];
  source: string;
  settings?: {
    kanbanStateOrder?: string[];
    kanbanGroups?: KanbanGroup[];
    kanbanHiddenStates?: string[];
    kanbanFilterColumnsByStatus?: boolean;
    kanbanHideEmptyColumns?: boolean;
    typeColors?: Record<string, string>;
    statusColors?: Record<string, string>;
  };
  disabled?: boolean;
  onChange: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { viewport, track, scrollbar: scroll, spacer } = useKanbanScroll();
  const dragging = useRef<KanbanTicket | null>(null);
  const lock = useRef(false);
  const live = useRef(true);
  const [move, setMove] = useState<Move | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [over, setOver] = useState<string | null>(null);
  const velocity = useRef(0);
  const verticalVelocity = useRef(0);
  useEffect(() => {
    live.current = true;
    const timer = window.setInterval(() => {
      if (dragging.current && scroll.current) {
        scroll.current.scrollLeft += velocity.current;
        window.scrollBy(0, verticalVelocity.current);
      }
    }, 16);
    return () => {
      live.current = false;
      clearInterval(timer);
    };
  }, [scroll]);
  function stopDrag() {
    dragging.current = null;
    velocity.current = 0;
    verticalVelocity.current = 0;
    setOver(null);
  }
  function close() {
    if (!lock.current) {
      dialog.current?.close();
      setMove(null);
    }
  }
  async function prepare(ticket: KanbanTicket, to: string, choices?: string[], groupName?: string) {
    if (choices?.includes(ticket.state || "")) return;
    if (lock.current || disabled || ticket.source !== source || !to || to === ticket.state) return;
    lock.current = true;
    setMove({ ticket, from: ticket.state || "Не указан", to, choices, groupName });
    setBusy(true);
    setReady(false);
    setError("");
    setNotice("");
    dialog.current?.showModal();
    try {
      const data = await api(`/tickets/${ticket.id}/states`);
      if (!live.current) return;
      if (data.source !== source) throw new Error("Подключение изменилось. Откройте доску заново.");
      const allowed = (choices || [to]).filter(
        (state) => Array.isArray(data.states) && data.states.includes(state),
      );
      if (!allowed.length)
        throw new Error("В этой колонке нет доступных статусов для типа тикета. Azure не изменён.");
      if (choices?.includes(data.state) || (!choices && data.state === to))
        throw new Error("Тикет уже в этой колонке. Обновите список.");
      setMove({
        ticket,
        from: data.state || "Не указан",
        to: allowed.includes(to) ? to : allowed[0],
        choices: choices ? allowed : undefined,
        groupName,
      });
      setReady(true);
    } catch (e) {
      if (live.current) setError(e instanceof Error ? e.message : "Не удалось проверить статусы.");
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function save() {
    if (lock.current || !move || !ready) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      // This endpoint PATCHes Azure, reads the work item again and updates local caches.
      const result = await api(`/tickets/${move.ticket.id}/state`, "PUT", {
        source,
        state: move.to,
      });
      if (!result.success || result.state !== move.to)
        throw new Error("Azure не подтвердил новый статус. Проверьте тикет перед повтором.");
      window.dispatchEvent(
        new CustomEvent("orbit:ticket-state", {
          detail: { id: move.ticket.id, source, state: result.state },
        }),
      );
      if (live.current) {
        setNotice(`Тикет #${move.ticket.id}: Azure подтвердил статус «${result.state}».`);
        dialog.current?.close();
        setMove(null);
      }
    } catch (e) {
      if (live.current) {
        setError(e instanceof Error ? e.message : "Не удалось изменить статус.");
        // Never offer an automatic retry of a write with an uncertain outcome.
        setReady(false);
      }
    } finally {
      lock.current = false;
      if (live.current) {
        setBusy(false);
        onChange();
      }
    }
  }
  const columns = groupedTicketColumns(
    tickets,
    states,
    settings?.kanbanStateOrder,
    selectedStates,
    settings?.kanbanHiddenStates,
    settings?.kanbanFilterColumnsByStatus,
    settings?.kanbanHideEmptyColumns,
    settings?.kanbanGroups,
  );
  const stateOptions = ticketStateColumns(
    tickets,
    [...states, ...(settings?.kanbanGroups || []).flatMap((group) => group.states)],
    settings?.kanbanStateOrder,
    selectedStates,
    settings?.kanbanHiddenStates,
    settings?.kanbanFilterColumnsByStatus,
  )
    .filter(({ state }) => !!state)
    .map(({ state }) => ({ value: state, label: state }));
  const visibleCount = columns.reduce((total, column) => total + column.tickets.length, 0);
  return (
    <section className="ticket-kanban" aria-label="Канбан тикетов">
      {notice && (
        <p role="status" className="ticket-kanban-notice">
          {notice}
        </p>
      )}
      {!visibleCount && (
        <p role="status" className="muted">
          Нет тикетов для показа. Проверьте фильтры и настройки видимости статусов или выполните
          поиск.
        </p>
      )}
      <div
        ref={viewport}
        className="ticket-kanban-scroll"
        aria-label="Столбцы статусов Azure"
        onDragOver={(event) => {
          if (!dragging.current) return;
          const rect = event.currentTarget.getBoundingClientRect();
          velocity.current =
            event.clientX < rect.left + 60 ? -12 : event.clientX > rect.right - 60 ? 12 : 0;
          verticalVelocity.current =
            event.clientY < 130 ? -12 : event.clientY > window.innerHeight - 60 ? 12 : 0;
        }}
        onDragLeave={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          ) {
            velocity.current = 0;
            verticalVelocity.current = 0;
          }
        }}
      >
        <div ref={track} className="ticket-kanban-track">
          <div className="ticket-kanban-headers">
            {columns.map((column) => (
              <header
                key={column.state}
                className="ticket-kanban-heading"
                onDragOver={(event) => {
                  if (
                    dragging.current &&
                    column.state &&
                    !busy &&
                    !disabled &&
                    !column.states.includes(dragging.current.state || "")
                  ) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setOver(column.state);
                  }
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  const ticket = dragging.current;
                  stopDrag();
                  if (ticket) void prepare(ticket, column.defaultState, column.states, column.name);
                }}
              >
                <StatusBadge
                  state={column.name || "Не указан"}
                  icon={
                    settings?.kanbanGroups?.some((group) => group.id === column.state) ? (
                      <Folder size={14} aria-hidden="true" />
                    ) : undefined
                  }
                  colors={column.color ? { [column.name]: column.color } : settings?.statusColors}
                />
                <span className="ticket-view-count">{column.tickets.length}</span>
              </header>
            ))}
          </div>
          <div className="ticket-kanban-columns">
            {columns.map((column) => (
              <section
                key={column.state}
                className={`ticket-kanban-column${over === column.state ? " is-drop-target" : ""}`}
                aria-label={`Столбец: ${column.name || "Не указан"}`}
                onDragOver={(event) => {
                  if (
                    dragging.current &&
                    column.state &&
                    !busy &&
                    !disabled &&
                    !column.states.includes(dragging.current.state || "")
                  ) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setOver(column.state);
                  }
                }}
                onDragLeave={(event) => {
                  if (
                    !(event.relatedTarget instanceof Node) ||
                    !event.currentTarget.contains(event.relatedTarget)
                  )
                    setOver(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const ticket = dragging.current;
                  stopDrag();
                  if (ticket) void prepare(ticket, column.defaultState, column.states, column.name);
                }}
              >
                <div className="ticket-kanban-cards">
                  {column.tickets.map((ticket) => (
                    <article
                      key={`${ticket.source}:${ticket.id}`}
                      className={`ticket-kanban-card${ticket.inTrash ? " ticket-tone-trash" : ticket.imported === false ? " ticket-tone-new" : ""}`}
                      draggable={!busy && !disabled && ticket.source === source}
                      onDragStart={(event) => {
                        dragging.current = ticket;
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", String(ticket.id));
                      }}
                      onDragEnd={stopDrag}
                    >
                      <div className="ticket-kanban-card-heading">
                        <Ticket size={15} />
                        <strong>#{ticket.id}</strong>
                        <GripVertical size={15} className="muted" />
                      </div>
                      <button
                        type="button"
                        className="ticket-kanban-title"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("orbit-show-ticket-details", {
                              detail: { source: ticket.source, tickets: [ticket] },
                            }),
                          )
                        }
                      >
                        {ticket.title || `Тикет #${ticket.id}`}
                      </button>
                      <StatusBadge
                        kind="type"
                        state={ticket.type || "Тип не указан"}
                        colors={settings?.typeColors}
                      />
                      {ticket.assigned && (
                        <div className="ticket-kanban-assignee">
                          <InitialsAvatar name={ticket.assigned} />
                          <span>{ticket.assigned}</span>
                        </div>
                      )}
                      {ticket.localDeadline && (
                        <div
                          className={
                            Date.parse(ticket.localDeadline) < Date.now()
                              ? "ticket-kanban-overdue"
                              : "muted"
                          }
                        >
                          Дедлайн: <TicketDate value={ticket.localDeadline} />
                        </div>
                      )}
                      <div
                        className="ticket-kanban-state"
                        onDragStart={(event) => event.stopPropagation()}
                      >
                        <SingleSelect
                          label="Статус в Azure"
                          value={ticket.state || ""}
                          disabled={busy || disabled || ticket.source !== source}
                          onChange={(state) => void prepare(ticket, state)}
                          options={stateOptions}
                          floating
                          renderOption={(option) => (
                            <StatusBadge state={option.label} colors={settings?.statusColors} />
                          )}
                        />
                      </div>
                    </article>
                  ))}
                  {!column.tickets.length && (
                    <p className="muted ticket-kanban-empty">Нет тикетов</p>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
      <div
        ref={scroll}
        className="ticket-kanban-scrollbar"
        tabIndex={0}
        role="region"
        aria-label="Горизонтальная прокрутка канбана"
      >
        <div ref={spacer} />
      </div>
      <dialog
        ref={dialog}
        className="developer-dialog ticket-kanban-confirm"
        aria-label="Изменение статуса в Azure"
        onCancel={(event) => {
          event.stopPropagation();
          if (lock.current) event.preventDefault();
          else setMove(null);
        }}
      >
        <div className="developer-dialog-heading">
          <strong>Изменить статус в Azure?</strong>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть подтверждение"
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        {move && (
          <>
            <p>
              #{move.ticket.id} · {move.ticket.title}
            </p>
            {move.choices && move.choices.length > 1 && (
              <SingleSelect
                label={`Статус Azure · ${move.groupName}`}
                value={move.to}
                disabled={busy || !ready}
                options={move.choices.map((state) => ({ value: state, label: state }))}
                renderOption={(option) => (
                  <StatusBadge state={option.value} colors={settings?.statusColors} />
                )}
                onChange={(to) => setMove({ ...move, to })}
              />
            )}
            <div className="ticket-kanban-transition">
              <StatusBadge state={move.from} colors={settings?.statusColors} />
              <ArrowRight size={18} />
              <StatusBadge state={move.to} colors={settings?.statusColors} />
            </div>
            <p>
              Статус тикета будет изменён в Azure DevOps. После записи Orbit повторно запросит тикет
              и проверит результат.
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {busy && (
          <p role="status">
            <LoaderCircle size={15} className="spin" /> Проверяем данные Azure…
          </p>
        )}
        <footer>
          <button type="button" className="secondary" disabled={busy} onClick={close}>
            Отмена
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !ready}
            onClick={() => void save()}
          >
            Изменить статус в Azure
          </button>
        </footer>
      </dialog>
    </section>
  );
}
