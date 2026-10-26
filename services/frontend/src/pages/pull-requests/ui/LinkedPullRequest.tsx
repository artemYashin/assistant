import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { PullRequestsPage } from "./PullRequestsPage.js";

export function LinkedPullRequest({
  settings,
  context,
}: {
  settings: any;
  context: { client: string; project: string };
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ref = params.get("linkedCard") || "";
  const number = params.get("lookup") || params.get("number") || "";
  const query = new URLSearchParams({
    projectId: params.get("projectId") || "",
    repo: params.get("repo") || "",
    number,
  }).toString();
  const endpoint = ref
    ? `/ticket-cards/${encodeURIComponent(ref)}/pull-request?${query}`
    : `/pr/lookup?${new URLSearchParams({ number })}`;
  const [ticket, setTicket] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    setItems([]);
    setTicket(null);
    api(endpoint)
      .then((value) => {
        if (!live) return;
        if (value.href) navigate(value.href, { replace: true });
        else {
          setItems([value.item]);
          setTicket(value.ticket || null);
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
  }, [endpoint, version, navigate]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>PR #{number}</h1>
          <p>Точечный просмотр из Azure</p>
        </div>
        <button className="secondary" disabled={busy} onClick={() => setVersion((n) => n + 1)}>
          <RefreshCw size={15} /> Обновить
        </button>
      </div>
      <Link to="/pull-requests?tab=completed">Вернуться к списку PR</Link>
      {ticket && (
        <button
          className="secondary"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("orbit-show-ticket-details", {
                detail: { source: ticket.source, tickets: [ticket] },
              }),
            )
          }
        >
          Открыть тикет #{ticket.id}
        </button>
      )}
      {busy && <p role="status">Загружаю pull request…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!!items.length && (
        <>
          <p className="muted">
            Просмотр не добавляет PR в синхронизацию. Доступны описание, связанные тикеты, View Diff
            и коммиты. Для запуска ревью и изменения активного PR настройте его репозиторий и
            синхронизацию.
          </p>
          <PullRequestsPage
            key={items[0].monitor}
            context={context}
            settings={settings}
            completedItems={items}
          />
        </>
      )}
    </>
  );
}
