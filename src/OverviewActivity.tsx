import { Link } from "react-router-dom";
import { MessageSquare, GitPullRequest, Ticket, Activity } from "lucide-react";
import { pullRequestPath, ticketPath } from "./routing.js";
const actions: Record<string, string> = {
  "ticket.tracked": "Добавлен тикет",
  "ticket.removed_locally": "Тикет отправлен в корзину",
  "ticket.restored_locally": "Тикет восстановлен",
  "ticket.state.verified": "Статус тикета подтверждён",
  "ticket.state.unconfirmed": "Смена статуса не подтверждена",
  "ticket.comment.added": "Добавлен комментарий",
  "ticket.assigned_locally": "Обновлено локальное поручение",
  "settings.updated": "Настройки сохранены",
  "memory.saved": "Добавлена запись в память",
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
}: {
  audit: any[];
  requests: any[];
  tickets: any[];
}) {
  const events = [
    ...audit
      .filter((a) => a.action !== "pr.reviewed" || !requests.length)
      .map((a) => {
        const id = a.action.startsWith("ticket.")
          ? /^#?(\d+)(?:\D|$)/.exec(a.detail)?.[1]
          : null;
        const ticket = tickets.find((t) => String(t.id) === id);
        return {
          id: a.id,
          at: a.created_at,
          title: actions[a.action] || a.action,
          detail: ticket ? `#${id} · ${ticket.title}` : a.detail,
          href: ticket ? ticketPath(ticket.id, ticket.source) : undefined,
          icon: id ? Ticket : Activity,
        };
      }),
    ...requests.map((r) => ({
      id: r.id,
      at: r.finished_at || r.created_at,
      title:
        r.origin === "pr_review"
          ? "Ревью pull request"
          : r.origin === "chat"
            ? "Запрос к AI-ассистенту"
            : "Запрос LLM",
      detail: r.pull_request
        ? `#${r.pull_request.number} · ${r.pull_request.title}`
        : "Чат ассистента",
      status: statuses[r.status] || r.status,
      href: r.pull_request ? pullRequestPath(r.pull_request) : "/usage",
      icon: r.origin === "pr_review" ? GitPullRequest : MessageSquare,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);
  return events.length ? (
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
  );
}
