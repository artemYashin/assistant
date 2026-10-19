import { SingleSelect } from "./SingleSelect.js";
import { useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { api } from "./api.js";
export function StatusBadge({
  state,
  colors = {},
  kind = "state",
}: {
  kind?: "state" | "type";
  state: string;
  colors?: Record<string, string>;
}) {
  const color = colors[state];
  return (
    <span
      className={`ticket-${kind}-badge`}
      style={
        color
          ? { color, background: color + "18", borderColor: color }
          : undefined
      }
    >
      {state}
    </span>
  );
}
export function LocalDeveloper({ ticket, context, onChange }: any) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [people, setPeople] = useState<any[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const assigned = ticket.developers || [];
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
          [...available, ...assigned].map((d: any) => [d.id, d]),
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
      await api(`/tickets/${ticket.id}/developers`, "PUT", {
        developerIds: ids,
        context,
        source: ticket.source,
      });
      dialog.current?.close();
      onChange();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const names = assigned.map((d: any) => d.name).join(", ");
  return (
    <div className="local-developer">
      <span className="local-developer-name" title={names || "Не поручено"}>
        {names || "N/A"}
      </span>
      <button
        type="button"
        className="text-button"
        disabled={busy}
        aria-label={`Редактировать локальное поручение #${ticket.id}`}
        title="Редактировать локальное поручение"
        onClick={() => void open()}
      >
        <Pencil size={15} />
      </button>
      <button
        type="button"
        className="text-button"
        disabled={busy || !assigned.length}
        aria-label={`Снять локальное поручение #${ticket.id}`}
        title="Снять все локальные поручения"
        onClick={() => void save([])}
      >
        <X size={15} />
      </button>
      <dialog
        ref={dialog}
        className="developer-dialog"
        aria-label={`Локальные исполнители тикета #${ticket.id}`}
      >
        <div className="developer-dialog-heading">
          <strong>Локальное поручение · #{ticket.id}</strong>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть выбор разработчиков"
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
                {p.name}
                {p.active === 0 ? " (убран из справочника)" : ""}
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
        className="text-button"
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
