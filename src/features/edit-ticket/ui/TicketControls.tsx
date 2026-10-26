import { StatusBadge } from "../../../entities/ticket/index.js";
import { LocalAssigneeNames } from "../../../entities/developer/index.js";
import { InitialsAvatar } from "../../../shared/ui/initials-avatar/index.js";
import { SingleSelect } from "../../../shared/ui/single-select/index.js";
import { useEffect, useRef, useState } from "react";
import { developerOnVacation, developerVacationStatus, nextVacationDay } from "../../../entities/developer/index.js";
import { Pencil, Palmtree, CalendarClock, X } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
export function LocalDeveloper({ ticket, context, onChange }: any) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [people, setPeople] = useState<any[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const assigned = ticket.developers || [];
  const now = new Date().toISOString();
  async function open() {
    setSelected(assigned.map((d: any) => d.id));
    setQuery("");
    setError("");
    setBusy(true);
    dialog.current?.showModal();
    try {
      const available = await api(
        `/local-developers?${new URLSearchParams(context)}`,
      );
      setPeople([
        ...new Map(
          available.map((d: any) => [d.id, d]).concat(
            assigned.filter((d: any) => !available.some((person: any) => person.id === d.id)).map((d: any) => [d.id, d]),
          ),
        ).values(),
      ]);
    } catch (e: any) {
      setError(e.message);
      setPeople(assigned);
    } finally {
      setBusy(false);
    }
  }
  async function save(ids: string[]) {
    setBusy(true);
    setError("");
    try {
      const result = await api(`/tickets/${ticket.id}/developers`, "PUT", {
        developerIds: ids,
        context,
        source: ticket.source,
      });
      window.dispatchEvent(
        new CustomEvent("orbit:ticket-developers", {
          detail: {
            id: ticket.id,
            source: ticket.source,
            developers: result.developers,
          },
        }),
      );
      dialog.current?.close();
      onChange?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="local-developer">
      <span className="local-developer-name">
        <LocalAssigneeNames names={assigned.map((d: any) => d.name)} />
      </span>
      <button
        type="button"
        className="text-button ticket-cell-button ticket-field-edit-trigger"
        disabled={busy}
        aria-label={`Редактировать локальное поручение #${ticket.id}`}
        title="Редактировать локальное поручение"
        onClick={() => void open()}
      >
        <Pencil size={15} />
      </button>
      <dialog
        ref={dialog}
        className="developer-dialog local-assignment-dialog"
        aria-label={`Локальные исполнители тикета #${ticket.id}`}
        onCancel={(event) => {
          event.stopPropagation();
          if (busy) event.preventDefault();
        }}
      >
        <div className="developer-dialog-heading">
          <strong>Локальное поручение · #{ticket.id}</strong>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть выбор разработчиков"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <p className="muted">
          Выберите одного или нескольких. Список настраивается в «Заказчики и
          проекты → Разработчики». Azure не изменяется.
        </p>
        <input
          aria-label="Поиск локального разработчика"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по имени"
        />
        <div className="multi-select-options">
          {people
            .filter((p) =>
              p.name
                .toLocaleLowerCase()
                .includes(query.trim().toLocaleLowerCase()),
            )
            .map((p) => (
              <label className="local-developer-option" key={p.id}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={selected.includes(p.id)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked
                        ? [...old, p.id]
                        : old.filter((id) => id !== p.id),
                    )
                  }
                />
                <InitialsAvatar name={p.name} />
                <span className="local-developer-option-name">
                  {p.name}
                  {developerOnVacation(p, now) && (
                    <small className="local-developer-vacation">
                      <Palmtree size={13} aria-hidden="true" />
                      В отпуске · Возвращение {nextVacationDay(p.vacationEnd).split("-").reverse().join(".")}
                    </small>
                  )}
                  {developerVacationStatus(p, now) === "upcoming" && p.vacationWarningStart && Date.parse(now) >= Date.parse(p.vacationWarningStart) && (
                    <small className="local-developer-vacation">
                      <CalendarClock size={13} aria-hidden="true" />
                      Скоро в отпуск · Уход {p.vacationStart.split("-").reverse().join(".")} · Возвращение {nextVacationDay(p.vacationEnd).split("-").reverse().join(".")}
                    </small>
                  )}
                  {p.active === 0 && <small>Убран из справочника</small>}
                </span>
              </label>
            ))}
          {!people.length && !busy && (
            <p>Добавьте разработчиков в меню заказчиков и проектов.</p>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void save(selected)}
        >
          {busy ? "Загрузка…" : "Сохранить поручение"}
        </button>
      </dialog>
      {error && !dialog.current?.open && (
        <small role="alert" className="error">
          {error}
        </small>
      )}
    </div>
  );
}

export function TicketStatus({
  id,
  source,
  state,
  colors,
  onChange,
}: {
  id: number;
  source: string;
  state: string;
  colors?: Record<string, string>;
  onChange?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState<string[]>([]),
    [selected, setSelected] = useState(state),
    [shown, setShown] = useState(state);
  const [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  useEffect(() => setShown(state), [state]);
  useEffect(() => {
    const changed = (event: Event) => {
      const d = (event as CustomEvent).detail;
      if (d.id === id && d.source === source) setShown(d.state);
    };
    window.addEventListener("orbit:ticket-state", changed);
    return () => window.removeEventListener("orbit:ticket-state", changed);
  }, [id, source]);
  async function open() {
    setBusy(true);
    setLoaded(false);
    setError("");
    dialog.current?.showModal();
    try {
      const data = await api(`/tickets/${id}/states`);
      if (data.source !== source)
        throw new Error("Подключение изменилось. Обновите карточку.");
      setOptions(data.states);
      setSelected(data.state);
      setShown(data.state);
      setLoaded(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await api(`/tickets/${id}/state`, "PUT", {
        source,
        state: selected,
      });
      if (!result.success) throw new Error("Статус не подтверждён");
      setShown(result.state);
      window.dispatchEvent(
        new CustomEvent("orbit:ticket-state", {
          detail: { id, source, state: result.state },
        }),
      );
      dialog.current?.close();
      onChange?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ticket-status-control">
      <StatusBadge state={shown || "Не указан"} colors={colors} />
      <button
        type="button"
        className="text-button ticket-cell-button ticket-field-edit-trigger"
        aria-label={`Изменить статус тикета #${id}`}
        title="Изменить статус в Azure DevOps"
        disabled={busy}
        onClick={() => void open()}
      >
        <Pencil size={15} />
      </button>
      <dialog
        ref={dialog}
        className="developer-dialog ticket-status-dialog"
        aria-label={`Изменить статус тикета #${id}`}
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <div className="developer-dialog-heading">
          <strong>Статус тикета #{id}</strong>
          <button
            type="button"
            className="icon-button"
            disabled={busy}
            aria-label="Закрыть выбор статуса"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <p className="muted">
          Статус изменится в Azure DevOps. Успех будет подтверждён повторным
          чтением тикета.
        </p>
        <SingleSelect
          label="Новый статус"
          value={selected}
          onChange={setSelected}
          disabled={busy || !loaded}
          options={options.map((value) => ({ value, label: value }))}
        />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button
          type="button"
          className="primary"
          disabled={busy || !loaded || !selected}
          onClick={() => void save()}
        >
          {busy ? "Загрузка…" : "Изменить статус"}
        </button>
      </dialog>
    </div>
  );
}
