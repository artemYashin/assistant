import { useEffect, useState } from "react";
import { TicketAutocomplete } from "../../../entities/ticket/index.js";
import { Link2 } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
export function PrTicketLink({ pr, onChange }: { pr: any; settings: any; onChange: () => void }) {
  const [id, setId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [catalog, setCatalog] = useState<any[]>([]),
    [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!focused) return;
    let live = true;
    setLoading(true);
    api<any[]>("/tickets")
      .then((rows) => {
        if (live) setCatalog(rows.filter((t) => t.source === pr.ticket_source));
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [focused, pr.ticket_source]);
  return (
    <>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const normalized = id.trim().replace(/^#/, "");
          const ticketId = Number(normalized);
          if (!/^[1-9][0-9]*$/.test(normalized) || !Number.isSafeInteger(ticketId)) {
            setError("Введите корректный номер тикета");
            return;
          }
          setBusy(true);
          try {
            await api("/pr/tickets", "POST", {
              monitor: pr.monitor,
              repo: pr.repo,
              number: pr.number,
              ticketId,
              source: pr.ticket_source,
              action: "link",
            });
            setId("");
            onChange();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="pr-ticket-search">
          <TicketAutocomplete
            label={`Номер тикета для PR #${pr.number}`}
            value={id}
            onChange={setId}
            onFocus={() => setFocused(true)}
            tickets={catalog.filter(
              (ticket) => !pr.tickets?.some((linked: any) => linked.id === ticket.id),
            )}
            disabled={busy}
            loading={loading}
          />
        </div>
        <button
          className="secondary"
          disabled={busy || !id}
          title="Связь сохраняется только в Orbit и не изменяет Azure. Тикет также появится в диалоге Merge при выборе смены статуса."
        >
          <Link2 size={16} />
          {busy ? "Привязываю…" : "Привязать локально"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
