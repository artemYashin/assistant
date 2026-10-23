import { useEffect, useState } from "react";
import { StatusBadge } from "./TicketControls.js";
import { Link2 } from "lucide-react";
import { api } from "./api.js";
export function PrTicketLink({
  pr,
  onChange,
  settings,
}: {
  pr: any;
  settings: any;
  onChange: () => void;
}) {
  const [id, setId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [catalog,setCatalog]=useState<any[]>([]), [focused,setFocused]=useState(false);
  useEffect(() => {
    if (!focused) return;
    let live=true;
    api<any[]>("/tickets").then(rows => {if(live) setCatalog(rows.filter(t => t.source === pr.ticket_source));}).catch(e => {if(live) setError(e.message);});
    return () => {live=false;};
  },[focused,pr.ticket_source]);
  const query=id.trim().replace(/^#/,"").toLocaleLowerCase();
  const results=query ? catalog.filter(t => !pr.tickets?.some((linked:any)=>linked.id===t.id) && (String(t.id).includes(query) || t.title.toLocaleLowerCase().includes(query))).slice(0,20) : [];
  return (
    <>
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const normalized=id.trim().replace(/^#/,"");
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
        <div className="pr-ticket-search" onBlur={e => {if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);}}>
        <input
          aria-label={`Номер тикета для PR #${pr.number}`}
          placeholder="Номер или название тикета"
          value={id}
          onChange={(e) => setId(e.target.value)}
          onFocus={() => setFocused(true)}
          disabled={busy}
        />
        {focused && results.length > 0 && <div className="pr-ticket-suggestions" aria-label="Найденные тикеты">
          {results.map(t => <button type="button" key={t.id} onMouseDown={e=>e.preventDefault()} onClick={()=>{setId(String(t.id));setFocused(false);}}>
            <span>#{t.id} {t.title}</span><StatusBadge state={t.type} kind="type" colors={settings?.typeColors}/><StatusBadge state={t.state} colors={settings?.statusColors}/>
          </button>)}
        </div>}
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
