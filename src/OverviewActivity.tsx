import { activityDescription } from "./activity-description.js";
import { useState } from "react";
import { PrInfoPopup } from "./PrInfoPopup.js";
import { api } from "./api.js";
import { Link } from "react-router-dom";
import {
  MessageSquare,
  GitPullRequest,
  Ticket,
  Activity,
  RefreshCw,
  History,
} from "lucide-react";
import { pullRequestPath, ticketPath } from "./routing.js";
const actions: Record<string, string> = {
  "ticket.metadata_updated_by_chat": "Обновлены локальные поля через чат",
  "memory.updated": "Изменена запись в памяти",
  "memory.proposal_removed": "Удалено предложение памяти",
  "ticket.tracked": "Добавлен тикет",
  "ticket.removed_locally": "Тикет отправлен в корзину",
  "ticket.restored_locally": "Тикет восстановлен",
  "ticket.state.verified": "Статус тикета подтверждён",
  "ticket.state.unconfirmed": "Смена статуса не подтверждена",
  "ticket.comment.added": "Добавлен комментарий",
  "ticket.assigned_locally": "Обновлено локальное поручение",
  "settings.updated": "Настройки сохранены",
  "memory.saved": "Добавлена запись в память",
  "sync.completed": "Синхронизация завершена",
  "sync.error": "Ошибка синхронизации",
  "pr.merge.requested": "Запущено слияние PR",
  "pr.merged": "PR объединён",
  "pr.abandon": "PR закрыт без слияния",
  "pr.draft": "PR переведён в черновик",
  "pr.publish": "PR выведен из черновика",
  "pr.ticket.link": "Тикет привязан к PR",
  "pr.ticket.unlink": "Связь тикета с PR удалена",
  "pr.answers_submitted": "Ответы для ревью отправлены",
  "pr.questions_ignored": "Ревью завершено без ответов",
  "pr.reviewed": "Выполнено ревью PR",
  "github.connected": "GitHub подключён",
  "teams.connected": "Teams подключён",
};
const statuses: Record<string, string> = {
  completed: "Готово",
  running: "Выполняется",
  error: "Ошибка",
  stopped: "Остановлено",
  limited: "Лимит",
  interrupted: "Прервано",
};
export function OverviewActivity({
  audit,
  requests,
  tickets,
  context,
  limit = 8,
  history = true,
}: {
  audit: any[];
  requests: any[];
  tickets: any[];
  context: { client: string; project: string };
  limit?: number;
  history?: boolean;
}) {
  const [expanded, setExpanded] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const loadHistory = async () => {
    setLoading(true);
    setError("");
    setExpanded(null);
    try {
      setExpanded(
        await api("/overview/activity?" + new URLSearchParams(context)),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  const events = [
    ...audit
      .filter(
        (a) =>
          a.action !== "pr.reviewed" ||
          !requests.some(
            (r) =>
              r.pull_request &&
              a.pull_request &&
              r.pull_request.monitor === a.pull_request.monitor &&
              r.pull_request.repo === a.pull_request.repo &&
              r.pull_request.number === a.pull_request.number &&
              Math.abs(
                Date.parse(r.finished_at || r.created_at) -
                  Date.parse(a.created_at),
              ) < 60000,
          ),
      )
      .map((a) => {
        const description = activityDescription(a.action, a.detail || "");
        const id = description.id;
        const ticket = tickets.find((t) => String(t.id) === id);
        return {
          id: "audit:" + a.id,
          at: a.created_at,
          title: actions[a.action] || description.fallback,
          detail: a.pull_request
            ? `#${a.pull_request.number} · ${a.pull_request.title || "Название недоступно"}`
            : ticket
              ? `#${id} · ${ticket.title}${description.summary ? " · " + description.summary : ""}`
              : id && description.summary
                ? `#${id} · ${description.summary}`
                : description.detail,
          href: a.pull_request
            ? pullRequestPath(a.pull_request)
            : ticket
              ? ticketPath(ticket.id, ticket.source)
              : undefined,
          icon: a.action.startsWith("sync.")
            ? RefreshCw
            : a.action.startsWith("pr.")
              ? GitPullRequest
              : id
                ? Ticket
                : Activity,
        };
      }),
    ...requests.map((r) => ({
      id: "request:" + r.id,
      at: r.finished_at || r.created_at,
      title:
        r.origin === "pr_review"
          ? "Ревью pull request"
          : r.origin === "chat"
            ? "Запрос к AI-ассистенту"
            : "Запрос LLM",
      detail: r.pull_request
        ? `#${r.pull_request.number} · ${r.pull_request.title}`
        : r.origin === "pr_review"
          ? "Pull request · сведения не сохранены"
          : "Чат ассистента",
      status: statuses[r.status] || r.status,
      href: r.pull_request ? pullRequestPath(r.pull_request) : "/usage",
      icon: r.origin === "pr_review" ? GitPullRequest : MessageSquare,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
  return (
    <>
      {history && (
        <PrInfoPopup
          title="История активности · последние 100 событий"
          className="secondary overview-history-button"
          trigger={
            <>
              <History size={15} /> История
            </>
          }
          onOpenChange={(open) => {
            if (open) void loadHistory();
          }}
        >
          {loading ? (
            <p role="status">Загрузка истории…</p>
          ) : error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : (
            expanded && (
              <OverviewActivity
                audit={expanded.audit}
                requests={expanded.requests}
                tickets={tickets}
                context={context}
                limit={100}
                history={false}
              />
            )
          )}
        </PrInfoPopup>
      )}
      {events.length ? (
        <div className="overview-activity-list">
          {events.map((event: any) => (
            <div className="overview-activity-item" key={event.id}>
              <event.icon size={17} />
              <div>
                <strong>
                  {event.title}
                  {event.status ? ` · ${event.status}` : ""}
                </strong>
                {event.detail &&
                  (event.href ? (
                    <Link to={event.href}>{event.detail}</Link>
                  ) : (
                    <span>{event.detail}</span>
                  ))}
              </div>
              <time dateTime={event.at}>
                {new Date(event.at).toLocaleString("ru-RU", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">История действий появится здесь.</p>
      )}
    </>
  );
}
