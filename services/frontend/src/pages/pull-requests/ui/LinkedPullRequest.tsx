import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { ChatMarkdown } from "../../../features/render-content/index.js";
import { InitialsAvatar } from "../../../shared/ui/initials-avatar/index.js";

export function LinkedPullRequest() {
  const [params] = useSearchParams();
  const ref = params.get("linkedCard") || "";
  const query = new URLSearchParams({
    projectId: params.get("projectId") || "",
    repo: params.get("repo") || "",
    number: params.get("number") || "",
  }).toString();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    setData(null);
    api(`/ticket-cards/${encodeURIComponent(ref)}/pull-request?${query}`)
      .then((value) => {
        if (live) setData(value);
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
  }, [ref, query, version]);
  const status: Record<string, string> = {
    active: "Активен",
    completed: "Завершён",
    abandoned: "Отклонён",
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>PR #{params.get("number")}</h1>
          <p>Точечный просмотр связанного PR из Azure</p>
        </div>
        <button className="secondary" disabled={busy} onClick={() => setVersion((n) => n + 1)}>
          <RefreshCw size={15} />
          Обновить
        </button>
      </div>
      <Link
        to={params.get("tab") === "completed" ? "/pull-requests?tab=completed" : "/pull-requests"}
      >
        Вернуться к списку PR
      </Link>
      {busy && <p role="status">Загружаю pull request…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <article className="panel linked-pr-detail">
          <header>
            <h2>{data.title}</h2>
            <span className="ticket-state-badge">{status[data.status] || data.status}</span>
            {data.draft && <span className="ticket-state-badge">Черновик</span>}
          </header>
          <p className="linked-pr-author">
            <InitialsAvatar name={data.author} />
            {data.author || "Автор не указан"} · {data.project} / {data.repository}
          </p>
          <p>
            <strong>Source:</strong> {data.sourceBranch?.replace(/^refs\/heads\//, "")} →{" "}
            <strong>Target:</strong> {data.targetBranch?.replace(/^refs\/heads\//, "")}
          </p>
          <p>
            Создан: {data.createdAt ? new Date(data.createdAt).toLocaleString("ru-RU") : "—"}
            {data.closedAt && <> · Завершён: {new Date(data.closedAt).toLocaleString("ru-RU")}</>}
          </p>
          <div className="chat-markdown">
            <ChatMarkdown text={data.description || "Описание отсутствует."} />
          </div>
          {!!data.reviewers.length && (
            <section>
              <h3>Ревьюеры</h3>
              <ul>
                {data.reviewers.map((r: any, index: number) => (
                  <li key={index}>
                    {r.name} ·{" "}
                    {(
                      {
                        10: "Одобрено",
                        5: "Одобрено с замечаниями",
                        0: "Без голоса",
                        "-5": "Ожидание автора",
                        "-10": "Отклонено",
                      } as Record<string, string>
                    )[r.vote] || r.vote}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <button
            className="secondary"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("orbit-show-ticket-details", {
                  detail: { source: data.ticket.source, tickets: [data.ticket] },
                }),
              )
            }
          >
            Открыть тикет #{data.ticket.id}
          </button>
          <p className="muted">
            Просмотр не добавляет репозиторий в синхронизацию и не меняет локальные привязки. Ревью,
            merge и редактирование в этом режиме недоступны.
          </p>
        </article>
      )}
    </>
  );
}
