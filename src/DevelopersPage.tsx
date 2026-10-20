import {
  developerGroup,
  type DeveloperStatusGroups,
} from "./developer-status.js";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  ClipboardCheck,
  NotebookPen,
  Save,
  ChevronLeft,
  ChevronRight,
  CheckCheck,
  Ticket,
} from "lucide-react";
import { api } from "./api.js";
import { InitialsAvatar } from "./InitialsAvatar.js";
import { StatusBadge } from "./TicketControls.js";
import { ticketPath } from "./routing.js";

type Context = { client: string; project: string };
type Developer = { id: string; name: string; notes: string };
type Task = {
  id: number;
  source: string;
  title: string;
  state: string;
  type: string;
  priority?: number;
  removedAt?: number;
  developers?: { id: string }[];
};
export function DevelopersPage({
  context,
  tickets,
  settings,
}: {
  context: Context;
  tickets: Task[];
  settings: any;
}) {
  const [data, setData] = useState<{
    developers: Developer[];
    completedTickets: Task[];
    source: string;
    statusGroups: DeveloperStatusGroups;
    showDeleted: boolean;
  } | null>(null);
  useEffect(() => {
    setData(null);
    setError("");
  }, [context.client, context.project]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("orbit:developer-board", refresh);
    return () => window.removeEventListener("orbit:developer-board", refresh);
  }, []);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api(`/developer-board?${new URLSearchParams(context)}`)
      .then((result) => {
        if (live) {
          setData(result);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [context.client, context.project, tickets, revision]);
  if (!context.project)
    return (
      <div className="panel">
        <Users size={24} />
        <h1>Разработчики</h1>
        <p>Выберите заказчика и проект сверху.</p>
      </div>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Разработчики</h1>
          <p>
            {context.client} · {context.project} — локальные поручения из
            текущего трекера.
          </p>
        </div>
      </div>
      <div className="developer-board-toolbar">
        <input
          aria-label="Поиск разработчика"
          placeholder="Найти разработчика…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Загрузка разработчиков…</p>}
      {data && !data.developers.length && (
        <div className="panel">
          <p>
            Разработчиков пока нет. Добавьте их в «Заказчики и проекты →
            Разработчики».
          </p>
        </div>
      )}
      <p className="muted">
        Группы настраиваются в «Заказчики и проекты → Разработчики». Не
        настроенные статусы — активные.{" "}
        {data?.showDeleted
          ? "Тикеты из корзины видны в завершённых."
          : "Тикеты из корзины скрыты."}
      </p>
      <div className="developer-board-grid">
        {data?.developers
          .filter((person) =>
            person.name
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()),
          )
          .map((person) => (
            <DeveloperCard
              key={`${context.client}:${context.project}:${person.id}`}
              person={person}
              context={context}
              tickets={tickets.filter((ticket) =>
                ticket.developers?.some(
                  (developer) => developer.id === person.id,
                ),
              )}
              completedTickets={(data.showDeleted
                ? data.completedTickets
                : []
              ).filter((ticket) =>
                ticket.developers?.some(
                  (developer) => developer.id === person.id,
                ),
              )}
              groups={data.statusGroups}
              settings={settings}
            />
          ))}
      </div>
      {data &&
        data.developers.length > 0 &&
        !data.developers.some((person) =>
          person.name
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        ) && <p>Разработчики не найдены.</p>}
    </>
  );
}
function DeveloperCard({
  person,
  context,
  tickets,
  completedTickets,
  groups,
  settings,
}: {
  person: Developer;
  context: Context;
  tickets: Task[];
  completedTickets: Task[];
  groups: DeveloperStatusGroups;
  settings: any;
}) {
  const [tab, setTab] = useState("active"),
    [page, setPage] = useState(0);
  const [notes, setNotes] = useState(person.notes),
    [saved, setSaved] = useState(person.notes);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const done = [
      ...tickets.filter(
        (ticket) => developerGroup(ticket.state, groups) === "done",
      ),
      ...completedTickets,
    ],
    review = tickets.filter(
      (ticket) => developerGroup(ticket.state, groups) === "review",
    ),
    active = tickets.filter(
      (ticket) => developerGroup(ticket.state, groups) === "active",
    );
  const list = [
    ...(tab === "active" ? active : tab === "review" ? review : done),
  ].sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1) || b.id - a.id);
  const pages = Math.max(1, Math.ceil(list.length / 5)),
    current = Math.min(page, pages - 1);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api(
        `/developer-board/${encodeURIComponent(person.id)}/notes`,
        "PUT",
        { context, notes },
      );
      setSaved(notes);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="panel developer-board-card">
      <header>
        <InitialsAvatar name={person.name} />
        <div>
          <h2>{person.name}</h2>
          <small className="muted">
            {tickets.length + completedTickets.length} локальных поручений
          </small>
        </div>
      </header>
      <nav className="pr-page-tabs" aria-label={`Тикеты: ${person.name}`}>
        <button
          type="button"
          aria-pressed={tab === "active"}
          onClick={() => {
            setTab("active");
            setPage(0);
          }}
        >
          <Ticket size={15} />
          Активные · {active.length}
        </button>
        <button
          type="button"
          aria-pressed={tab === "review"}
          onClick={() => {
            setTab("review");
            setPage(0);
          }}
        >
          <ClipboardCheck size={15} /> На проверке · {review.length}
        </button>
        <button
          type="button"
          aria-pressed={tab === "done"}
          onClick={() => {
            setTab("done");
            setPage(0);
          }}
        >
          <CheckCheck size={15} />
          Завершённые · {done.length}
        </button>
      </nav>
      <div className="developer-board-tickets">
        {list.slice(current * 5, current * 5 + 5).map((ticket) => (
          <div
            className="developer-board-ticket"
            key={`${ticket.source}:${ticket.id}`}
          >
            <Link
              to={
                ticket.removedAt !== undefined
                  ? `/tickets?${new URLSearchParams({ tab: "trash", id: String(ticket.id), source: ticket.source })}`
                  : ticketPath(ticket.id, ticket.source)
              }
              title={ticket.title}
            >
              #{ticket.id} · {ticket.title}
            </Link>
            <div>
              <StatusBadge
                state={ticket.type}
                kind="type"
                colors={settings?.typeColors}
              />
              <StatusBadge
                state={ticket.state}
                colors={settings?.statusColors}
              />
              <span className="badge">P{ticket.priority ?? 1}</span>
            </div>
          </div>
        ))}
        {!list.length && (
          <p className="muted">
            {tab === "active"
              ? "Нет активных поручений"
              : tab === "review"
                ? "Нет поручений на проверке"
                : "Нет завершённых поручений"}
          </p>
        )}
      </div>
      {pages > 1 && (
        <div className="developer-board-pagination">
          <button
            type="button"
            className="icon-button"
            aria-label={`Предыдущие тикеты: ${person.name}`}
            disabled={!current}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={`Следующие тикеты: ${person.name}`}
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
      <details className="developer-board-notes">
        <summary>
          <NotebookPen size={16} />
          Внутренние заметки{notes !== saved ? " · не сохранены" : ""}
        </summary>
        <textarea
          aria-label={`Заметки: ${person.name}`}
          rows={4}
          maxLength={20000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          disabled={busy}
          placeholder="Что важно помнить об этом разработчике…"
        />
        <button
          type="button"
          className="secondary"
          disabled={busy || notes === saved}
          onClick={() => void save()}
        >
          <Save size={15} />
          {busy ? "Сохранение…" : "Сохранить заметки"}
        </button>
        <small className="muted">
          Только локально, в рамках этого проекта.
        </small>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </details>
    </article>
  );
}
