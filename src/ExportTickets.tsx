import {
  exportColumns,
  defaultExportColumns,
  type ExportColumnKey,
} from "./ticket-export-columns.js";
import { useRef, useState } from "react";
import { Download, FileSpreadsheet, X } from "lucide-react";
import { ticketsCsv, type CsvTicket } from "./tickets-csv.js";

export function ExportTickets({
  tickets,
  trash = false,
}: {
  tickets: CsvTicket[];
  trash?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState<"csv" | "xlsx">("xlsx");
  const [columns, setColumns] =
    useState<ExportColumnKey[]>(defaultExportColumns);
  const [snapshot, setSnapshot] = useState<CsvTicket[]>([]);
  const lock = useRef(false);
  function open(format: "csv" | "xlsx") {
    setFormat(format);
    setError("");
    setSnapshot(structuredClone(tickets));
    dialog.current?.showModal();
  }
  async function download() {
    if (lock.current || !columns.length) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const blob =
        format === "csv"
          ? new Blob([ticketsCsv(snapshot, columns)], {
              type: "text/csv;charset=utf-8",
            })
          : new Blob(
              [
                await (
                  await import("./tickets-xlsx.js")
                ).ticketsXlsx(snapshot, trash, columns),
              ],
              {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              },
            );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const date = new Date();
      const stamp = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-");
      anchor.href = url;
      anchor.download = `orbit-tickets${trash ? "-trash" : ""}-${stamp}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      dialog.current?.close();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      setError("Не удалось создать файл. Попробуйте экспортировать ещё раз.");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <div className="ticket-export-actions" aria-busy={busy}>
      <button
        type="button"
        className="secondary"
        disabled={!tickets.length || busy}
        title="Скачать таблицу с оформлением в Excel"
        onClick={() => open("xlsx")}
      >
        <FileSpreadsheet size={16} />
        {busy ? "Подготовка…" : `Экспорт Excel (${tickets.length})`}
      </button>
      <button
        type="button"
        className="secondary"
        disabled={!tickets.length || busy}
        title="Скачать CSV с разделителем точка с запятой"
        onClick={() => open("csv")}
      >
        <Download size={16} />
        CSV
      </button>
      <dialog
        ref={dialog}
        className="developer-dialog export-columns-dialog"
        aria-label="Столбцы экспорта"
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <div className="developer-dialog-heading">
          <strong>
            Экспорт {format === "xlsx" ? "Excel" : "CSV"} · {snapshot.length}{" "}
            тикетов
          </strong>
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
        <p className="muted">
          Выберите столбцы. Заголовки в файле будут на английском, значения
          сохранятся без перевода.
        </p>
        <div className="ticket-bulk-actions">
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => setColumns(exportColumns.map((c) => c.key))}
          >
            Выбрать все
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => setColumns([])}
          >
            Снять выбор
          </button>
        </div>
        <div className="export-column-options">
          {exportColumns.map((column) => (
            <label key={column.key}>
              <input
                type="checkbox"
                disabled={busy}
                checked={columns.includes(column.key)}
                onChange={(event) =>
                  setColumns((old) =>
                    event.target.checked
                      ? [...old, column.key]
                      : old.filter((key) => key !== column.key),
                  )
                }
              />
              <span>
                {column.label}
                <small>{column.header}</small>
              </span>
            </label>
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="primary"
          disabled={busy || !columns.length || !snapshot.length}
          onClick={() => void download()}
        >
          <Download size={16} />
          {busy ? "Подготовка…" : "Скачать файл"}
        </button>
      </dialog>
    </div>
  );
}
