import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";

const statuses: Record<string, string> = {
  active: "Активен",
  completed: "Завершён",
  abandoned: "Отклонён",
  unknown: "Статус недоступен",
};
export function TicketLinkedPullRequests({
  reference,
  onCount,
}: {
  reference: string;
  onCount: (count: number) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    api(`/ticket-cards/${encodeURIComponent(reference)}/pull-requests`)
      .then((result) => {
        if (live) {
          setData(result);
          onCount(result.items.length);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [reference, version, onCount]);
  return (
    <div>
      <button className="secondary" disabled={busy} onClick={() => setVersion((n) => n + 1)}>
        <RefreshCw size={15} />
        Обновить PR
      </button>
      {busy && <p role="status">Загружаю связанные PR…</p>}
      {(error || data?.warning) && (
        <p role="alert" className="error">
          {error || data.warning}
        </p>
      )}
      {data && (
        <ul className="ticket-linked-prs">
          {data.items.map((pr: any) => (
            <li key={`${pr.repo}:${pr.number}`}>
              <div className="ticket-linked-pr-heading">
                <span className="ticket-type-badge">PR #{pr.number}</span>
                <Link to={pr.href}>{pr.title}</Link>
                <span className="ticket-state-badge">{statuses[pr.status] || pr.status}</span>
                {pr.draft && <span className="ticket-state-badge">Черновик</span>}
              </div>
              <small>
                {pr.author || "Автор не указан"} · {pr.origin}
              </small>
              {pr.error && <p className="error">{pr.error}</p>}
            </li>
          ))}
        </ul>
      )}
      {data && !data.items.length && <p className="ticket-empty">Связанные PR не найдены.</p>}
      <p className="ticket-footnote">
        Связи Azure и синхронизированные связи Orbit объединены. Названия и статусы из Azure
        загружаются при открытии вкладки. PR вне локального списка открываются внутри Orbit в режиме
        просмотра.
      </p>
    </div>
  );
}
