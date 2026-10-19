import { Download } from "lucide-react";
import { ticketsCsv, type CsvTicket } from "./tickets-csv.js";
export function ExportTickets({
  tickets,
  trash = false,
}: {
  tickets: CsvTicket[];
  trash?: boolean;
}) {
  return (
    <button
      type="button"
      className="secondary"
      disabled={!tickets.length}
      title={`Экспортировать показанные тикеты: ${tickets.length}`}
      onClick={() => {
        const url = URL.createObjectURL(
          new Blob([ticketsCsv(tickets)], { type: "text/csv;charset=utf-8" }),
        );
        const anchor = document.createElement("a");
        const date = new Date();
        const stamp = [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, "0"),
          String(date.getDate()).padStart(2, "0"),
        ].join("-");
        anchor.href = url;
        anchor.download = `orbit-tickets${trash ? "-trash" : ""}-${stamp}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }}
    >
      <Download size={16} />
      Экспорт CSV ({tickets.length})
    </button>
  );
}
