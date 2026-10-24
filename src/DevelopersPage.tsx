import { CalendarDateField } from "./CalendarDateField.js";
import { useCalendarClock } from "./useCalendarClock.js";
import { nextVacationDay, developerOnVacation } from "./developer-vacation.js";
import {
  developerGroup,
  type DeveloperStatusGroups,
} from "./developer-status.js";
import { useEffect, useId, useState } from "react";
import { TicketCopyButton } from "./TicketCard.js";
import { shareTicketUrl } from "./azure-ticket-link.js";
import {
  Users,
  UserRoundMinus,
  ClipboardCheck,
  Settings2,
  Palmtree,
  Save,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CheckCheck,
  Ticket,
} from "lucide-react";
import { PrInfoPopup } from "./PrInfoPopup.js";
import { api } from "./api.js";
import { InitialsAvatar } from "./InitialsAvatar.js";
import { StatusBadge } from "./TicketControls.js";
import { ticketPath } from "./routing.js";

type Context = { client: string; project: string };
type Developer = {
  id: string;
  name: string;
  notes: string;
  client: string;
  project: string;
  vacationStart: string | null;
  vacationEnd: string | null;
  vacationZone: string | null;
};
type Task = {
  id: number;
  source: string;
  title: string;
  state: string;
  type: string;
  priority?: number;
  azurePriority?: number | null;
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
    setActivity("all");
  }, [context.client, context.project]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("orbit:developer-board", refresh);
    return () => window.removeEventListener("orbit:developer-board", refresh);
  }, []);
  const [activity, setActivity] = useState<
    "all" | "active" | "inactive" | "vacation"
  >("all");
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
  const activeIds = new Set(
    tickets
      .filter(
        (ticket) =>
          ticket.removedAt === undefined &&
          developerGroup(ticket.state, data?.statusGroups || {}) === "active",
      )
      .flatMap((ticket) =>
        (ticket.developers || []).map((person) => person.id),
      ),
  );
  const matchingDevelopers = (data?.developers || []).filter((person) =>
    person.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const clock = useCalendarClock();
  const onVacation = (person: Developer) =>
    developerOnVacation(person, new Date(clock).toISOString());
  const vacationCount = matchingDevelopers.filter(onVacation).length;
  const activeCount = matchingDevelopers.filter(
    (person) => !onVacation(person) && activeIds.has(person.id),
  ).length;
  const visibleDevelopers = matchingDevelopers.filter(
    (person) =>
      activity === "all" ||
      (activity === "vacation"
        ? onVacation(person)
        : !onVacation(person) &&
          (activity === "active"
            ? activeIds.has(person.id)
            : !activeIds.has(person.id))),
  );
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
      <nav
        className="pr-page-tabs developer-activity-tabs"
        aria-label="Фильтр разработчиков по активным задачам"
      >
        <button
          type="button"
          aria-pressed={activity === "all"}
          onClick={() => setActivity("all")}
        >
          <Users size={16} /> Все · {matchingDevelopers.length}
        </button>
        <button
          type="button"
          aria-pressed={activity === "active"}
          onClick={() => setActivity("active")}
        >
          <Ticket size={16} /> С активными задачами · {activeCount}
        </button>
        <button
          type="button"
          aria-pressed={activity === "inactive"}
          onClick={() => setActivity("inactive")}
        >
          <UserRoundMinus size={16} /> Без активных задач ·{" "}
          {matchingDevelopers.length - activeCount - vacationCount}
        </button>
        <button
          type="button"
          aria-pressed={activity === "vacation"}
          onClick={() => setActivity("vacation")}
        >
          <Palmtree size={16} /> В отпуске · {vacationCount}
        </button>
      </nav>
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
      <div className="developer-board-list">
        {data &&
          visibleDevelopers.map((person) => (
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
      {data && data.developers.length > 0 && !visibleDevelopers.length && (
        <p className="muted" role="status">
          Нет разработчиков по выбранному фильтру и поиску.
        </p>
      )}
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
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const [tab, setTab] = useState("active"),
    [page, setPage] = useState(0);
  const [vacationStart, setVacationStart] = useState(
      person.vacationStart || "",
    ),
    [vacationEnd, setVacationEnd] = useState(person.vacationEnd || "");
  useEffect(() => {
    setVacationStart(person.vacationStart || "");
    setVacationEnd(person.vacationEnd || "");
  }, [person.vacationStart, person.vacationEnd]);
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
  async function save(cancel = false) {
    setBusy(true);
    setError("");
    try {
      await api(
        `/developer-board/${encodeURIComponent(person.id)}/vacation`,
        "PUT",
        {
          context,
          vacation: cancel ? null : { start: vacationStart, end: vacationEnd },
        },
      );
      window.dispatchEvent(new Event("orbit:developer-board"));
      window.dispatchEvent(new Event("orbit-calendar-changed"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="panel developer-board-card">
      <header>
        <button
          type="button"
          className="developer-board-toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown
            size={18}
            className={expanded ? "is-expanded" : ""}
            aria-hidden="true"
          />
          <InitialsAvatar name={person.name} />
          <span className="developer-board-person">
            <span className="developer-board-name">{person.name}</span>
            <span className="badge developer-scope-badge">
              {person.project
                ? `Проект · ${person.client} / ${person.project}`
                : person.client
                  ? `Заказчик · ${person.client}`
                  : "Общий список"}
            </span>
            {person.vacationStart && person.vacationEnd && (
              <small className="developer-vacation-label">
                <Palmtree size={14} /> Отпуск: {person.vacationStart} —{" "}
                {person.vacationEnd} · Возвращение{" "}
                {nextVacationDay(person.vacationEnd)}
              </small>
            )}
            <small className="muted">
              {tickets.length + completedTickets.length} локальных поручений
            </small>
          </span>
        </button>
        <PrInfoPopup
          title={`Настройки разработчика · ${person.name}`}
          trigger={
            <>
              <Settings2 size={17} />
              <span>Настройки</span>
            </>
          }
          className="secondary developer-notes-button"
        >
          <div className="developer-vacation-settings">
            <p className="muted">
              Один период отпуска, обе даты включительно. Часовой пояс:{" "}
              {person.vacationZone || settings.syncSchedule?.timeZone || "UTC"}.
              Действует во всех проектах, где доступен разработчик.
            </p>
            <div className="developer-vacation-dates">
              <CalendarDateField label="Отпуск с" dateOnly value={vacationStart} onChange={setVacationStart} disabled={busy} zone={person.vacationZone || settings.syncSchedule?.timeZone || "UTC"}/>
              <CalendarDateField label="Отпуск по" dateOnly value={vacationEnd} min={vacationStart} onChange={setVacationEnd} disabled={busy} zone={person.vacationZone || settings.syncSchedule?.timeZone || "UTC"}/>
            </div>
            <div className="developer-vacation-actions">
              <button
                type="button"
                className="primary"
                disabled={
                  busy ||
                  !vacationStart ||
                  !vacationEnd ||
                  vacationEnd < vacationStart
                }
                onClick={() => void save()}
              >
                <Save size={15} /> Сохранить отпуск
              </button>
              {person.vacationStart && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void save(true)}
                >
                  Отменить отпуск
                </button>
              )}
            </div>
            {person.notes && (
              <details>
                <summary>Ранее сохранённые заметки</summary>
                <p style={{ whiteSpace: "pre-wrap" }}>{person.notes}</p>
              </details>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        </PrInfoPopup>
      </header>
      <div
        id={contentId}
        hidden={!expanded}
        className="developer-board-content"
      >
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
              <div className="developer-ticket-heading">
                <TicketCopyButton
                  value={shareTicketUrl(ticketPath(ticket.id, ticket.source))}
                  label={`Скопировать ссылку на тикет #${ticket.id} в Azure DevOps`}
                  link
                />
                <button
                  type="button"
                  className="developer-ticket-open"
                  title={ticket.title}
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("orbit-show-ticket-details", {
                        detail: {
                          source: ticket.source,
                          tickets: [{ id: ticket.id, title: ticket.title }],
                        },
                      }),
                    )
                  }
                >
                  <span className="developer-ticket-number">#{ticket.id}</span>{" "}
                  {ticket.title}
                </button>
              </div>
              <div className="developer-ticket-badges">
                <StatusBadge
                  state={ticket.type}
                  kind="type"
                  colors={settings?.typeColors}
                />
                <StatusBadge
                  state={ticket.state}
                  colors={settings?.statusColors}
                />
                <span className="badge" title="Локальный приоритет">
                  {ticket.priority ?? 1}
                </span>
                {ticket.azurePriority != null && (
                  <span
                    className="badge"
                    title="Azure приоритет · только чтение"
                  >
                    Azure приоритет: {ticket.azurePriority}
                  </span>
                )}
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
      </div>
    </article>
  );
}
