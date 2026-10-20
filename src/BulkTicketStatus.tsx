import { useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { api } from "./api.js";
import { SingleSelect } from "./SingleSelect.js";
import { ticketKey, type SelectableTicket } from "./TicketSelection.js";

type Row = SelectableTicket & {
  states: string[];
  state: string;
  result?: string;
  error?: string;
};
export function BulkTicketStatus({
  tickets,
  onChange,
}: {
  tickets: SelectableTicket[];
  onChange: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [state, setState] = useState("");
  const common = rows.length
    ? rows[0].states.filter((value) =>
        rows.every((row) => row.states.includes(value)),
      )
    : [];
  async function open() {
    if (lock.current || !tickets.length) return;
    lock.current = true;
    setBusy(true);
    setReady(false);
    setDone(false);
    setState("");
    setError("");
    const snapshot = tickets.map((ticket) => ({
      ...ticket,
      states: [] as string[],
      state: "",
    }));
    setRows(snapshot);
    dialog.current?.showModal();
    const loaded: Row[] = [];
    try {
      for (let i = 0; i < snapshot.length; i += 25) {
        const chunk = snapshot.slice(i, i + 25);
        const source = chunk[0].source;
        if (chunk.some((ticket) => ticket.source !== source))
          throw new Error("Выберите тикеты одного подключения.");
        const data = await api("/tickets/states/batch", "POST", {
          ids: chunk.map((ticket) => ticket.id),
          source,
        });
        if (data.source !== source)
          throw new Error("Подключение изменилось. Обновите список тикетов.");
        for (const ticket of chunk) {
          const row = data.results.find(
            (result: any) => result.id === ticket.id,
          );
          if (!row) throw new Error(`Azure не вернул тикет #${ticket.id}`);
          loaded.push({ ...ticket, states: row.states, state: row.state });
        }
      }
      setRows(loaded);
      setReady(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  async function save() {
    if (lock.current || !ready || done || !common.includes(state)) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const results = [...rows];
    try {
      for (let i = 0; i < results.length; i += 25) {
        const chunk = results.slice(i, i + 25);
        try {
          const response = await api("/tickets/state/batch", "PUT", {
            ids: chunk.map((row) => row.id),
            source: chunk[0].source,
            state,
          });
          for (const [offset, row] of chunk.entries()) {
            const result = response.results.find(
              (entry: any) => entry.id === row.id,
            );
            if (result?.success && result.state === state) {
              results[i + offset] = {
                ...row,
                result: `Подтверждено: ${result.state}`,
              };
              window.dispatchEvent(
                new CustomEvent("orbit:ticket-state", {
                  detail: {
                    id: row.id,
                    source: row.source,
                    state: result.state,
                  },
                }),
              );
            } else
              results[i + offset] = {
                ...row,
                error:
                  result?.error ||
                  "Новый статус не подтверждён. Проверьте результат перед повтором.",
              };
          }
        } catch (e: any) {
          // Do not retry writes or continue sending chunks after an unknown outcome.
          for (let j = i; j < results.length; j++)
            results[j] = {
              ...results[j],
              error:
                j < i + chunk.length
                  ? e.message
                  : "Пакет не отправлен из-за ошибки предыдущего запроса",
            };
          setRows([...results]);
          break;
        }
        setRows([...results]);
      }
      setDone(true);
    } finally {
      setBusy(false);
      lock.current = false;
      onChange();
    }
  }
  return (
    <>
      <button
        className="secondary"
        type="button"
        disabled={!tickets.length || busy}
        onClick={() => void open()}
      >
        <Pencil size={16} />
        Изменить статус ({tickets.length})
      </button>
      <dialog
        ref={dialog}
        className="developer-dialog bulk-status-dialog"
        aria-label="Массовое изменение статусов"
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <div className="developer-dialog-heading">
          <strong>Изменить статус · {rows.length} тикетов</strong>
          <button
            className="icon-button"
            type="button"
            aria-label="Закрыть"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <p className="muted">
          Статус изменится в Azure DevOps. Для каждого тикета результат
          проверяется повторным чтением. Операции выполняются по очереди;
          успешные изменения не отменяются при ошибке другого тикета.
        </p>
        {!done && (
          <SingleSelect
            label="Новый статус для выбранных тикетов"
            value={state}
            onChange={setState}
            disabled={busy || !ready}
            options={common.map((value) => ({ value, label: value }))}
          />
        )}
        {ready && !common.length && (
          <p role="alert">
            У выбранных типов задач нет общего статуса. Выберите тикеты одного
            типа.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <ul className="bulk-status-list" aria-live="polite">
          {rows.map((row) => (
            <li key={ticketKey(row)}>
              <strong>#{row.id}</strong>
              <span>{row.title}</span>
              <small className={row.error ? "error" : "muted"}>
                {row.error || row.result || row.state || "Загрузка статусов…"}
              </small>
            </li>
          ))}
        </ul>
        {done ? (
          <p role="status">
            Подтверждено: {rows.filter((row) => row.result).length} из{" "}
            {rows.length}.{" "}
            {rows.some((row) => row.error)
              ? "Ошибки указаны в списке. Повторите операцию только для нужных тикетов после проверки."
              : "Все статусы обновлены."}
          </p>
        ) : (
          <button
            className="primary"
            type="button"
            disabled={busy || !ready || !common.includes(state)}
            onClick={() => void save()}
          >
            {busy ? "Обработка…" : "Применить в Azure DevOps"}
          </button>
        )}
      </dialog>
    </>
  );
}
