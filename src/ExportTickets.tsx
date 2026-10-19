import { useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
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
  async function download(format: "csv" | "xlsx") {
    setBusy(true);
    setError("");
    try {
      const blob =
        format === "csv"
          ? new Blob([ticketsCsv(tickets)], { type: "text/csv;charset=utf-8" })
          : new Blob(
              [
                await (
                  await import("./tickets-xlsx.js")
                ).ticketsXlsx(tickets, trash),
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
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      setError("Не удалось создать файл. Попробуйте экспортировать ещё раз.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ticket-export-actions" aria-busy={busy}>
      <button
        type="button"
        className="secondary"
        disabled={!tickets.length || busy}
        title="Скачать таблицу с оформлением в Excel"
        onClick={() => void download("xlsx")}
      >
        <FileSpreadsheet size={16} />
        {busy ? "Подготовка…" : `Экспорт Excel (${tickets.length})`}
      </button>
      <button
        type="button"
        className="secondary"
        disabled={!tickets.length || busy}
        title="Скачать CSV с разделителем точка с запятой"
        onClick={() => void download("csv")}
      >
        <Download size={16} />
        CSV
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
