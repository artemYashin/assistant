import { useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";

export function ImportAzureTickets({
  tickets,
  source,
  onImported,
}: {
  tickets: any[];
  source: string;
  onImported: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [snapshot, setSnapshot] = useState<any[]>([]);
  const [existing, setExisting] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  return (
    <>
      <button
        type="button"
        className="primary"
        disabled={!tickets.length}
        onClick={() => {
          setSnapshot(tickets.filter((t) => !t.imported));
          setExisting(tickets.filter((t) => t.imported).length);
          setError("");
          setNotice("");
          dialog.current?.showModal();
        }}
      >
        <Download size={16} />
        Импортировать выбранное
      </button>
      {notice && <span role="status">{notice}</span>}
      <dialog
        ref={dialog}
        className="developer-dialog azure-import-dialog"
        aria-label="Импорт выбранных тикетов"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <div className="developer-dialog-heading">
          <h2>Добавить в ваши тикеты?</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <p>
          Новых: {snapshot.length}. Уже в системе: {existing} — повторно не добавляются.
        </p>
        <div className="azure-import-list">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Название</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.map((t) => (
                <tr key={t.id}>
                  <td>#{t.id}</td>
                  <td>{t.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="ticket-bulk-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            Отмена
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !snapshot.length}
            onClick={async () => {
              if (lock.current) return;
              lock.current = true;
              setBusy(true);
              setError("");
              try {
                const result = await api("/azure/tickets/import", "POST", {
                  source,
                  ids: snapshot.map((t) => t.id),
                });
                setNotice(
                  `Добавлено: ${result.added.length}.${result.missing.length ? ` Недоступны: ${result.missing.join(", ")}.` : ""}`,
                );
                dialog.current?.close();
                onImported();
              } catch (e: any) {
                setError(e.message);
              } finally {
                lock.current = false;
                setBusy(false);
              }
            }}
          >
            {busy ? "Импортирую…" : "Добавить тикеты"}
          </button>
        </div>
      </dialog>
    </>
  );
}
