import { useState } from "react";
import { Link2 } from "lucide-react";
import { api } from "./api.js";
export function PrTicketLink({
  pr,
  onChange,
}: {
  pr: any;
  onChange: () => void;
}) {
  const [id, setId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const ticketId = Number(id);
          if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(ticketId)) {
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
        <input
          aria-label={`Номер тикета для PR #${pr.number}`}
          placeholder="Номер тикета"
          inputMode="numeric"
          value={id}
          onChange={(e) => setId(e.target.value.trim())}
          disabled={busy}
        />
        <button className="secondary" disabled={busy || !id}>
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
