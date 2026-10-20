import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  NotebookPen,
  Save,
  ChevronLeft,
  ChevronRight,
  CheckCheck,
  Ticket,
  Settings2,
} from "lucide-react";
import { api } from "./api.js";
import { InitialsAvatar } from "./InitialsAvatar.js";
import { StatusBadge } from "./TicketControls.js";
import { MultiSelect } from "./MultiSelect.js";
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
    completedStates: string[];
  } | null>(null);
  const [states, setStates] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    api(`/developer-board?${new URLSearchParams(context)}`)
      .then((result) => {
        if (live) {
          setData(result);
          setStates(result.completedStates);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [context.client, context.project]);
  async function saveStates() {
    setSaving(true);
    setError("");
    try {
      await api("/developer-board/states", "PUT", { context, states });
      setData((old) => (old ? { ...old, completedStates: states } : old));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  if (!context.project)
    return (
      <div className="panel">
        <Users size={24} />
        <h1>Разработчики</h1>
        <p>Выберите заказчика и проект сверху.</p>
      </div>
    );
  const options = [
    ...new Set([
      ...tickets.map((ticket) => ticket.state).filter(Boolean),
      ...states,
      ...(data?.completedStates || []),
    ]),
  ].sort();
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
        <details className="panel developer-board-settings">
          <summary>
            <Settings2 size={16} />
            Какие статусы считать завершёнными
          </summary>
          <MultiSelect
            label="Завершённые статусы"
            placeholder="Выберите статусы"
            value={states}
            onChange={setStates}
            options={options.map((value) => ({ value, label: value }))}
          />
          <button
            type="button"
            className="secondary"
            disabled={saving || !data}
            onClick={() => void saveStates()}
          >
            <Save size={16} />
            {saving ? "Сохранение…" : "Применить"}
          </button>
          <p className="muted">
            Настройка сохраняется для текущего проекта. Остальные статусы
            считаются активными; в Azure ничего не меняется.
          </p>
        </details>
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
      <div className="developer-board-grid">
        {data?.developers
          .filter((person) =>
            person.name
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()),
          )
          .map((person) => (
            <DeveloperCard
              key={person.id}
              person={person}
              context={context}
              tickets={tickets.filter((ticket) =>
                ticket.developers?.some(
                  (developer) => developer.id === person.id,
                ),
              )}
              completedStates={data.completedStates}
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
  completedStates,
  settings,
}: {
  person: Developer;
  context: Context;
  tickets: Task[];
  completedStates: string[];
  settings: any;
}) {
  const [tab, setTab] = useState("active"),
    [page, setPage] = useState(0);
  const [notes, setNotes] = useState(person.notes),
    [saved, setSaved] = useState(person.notes);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const completed = (ticket: Task) =>
    completedStates.some(
      (state) => state.toLocaleLowerCase() === ticket.state.toLocaleLowerCase(),
    );
  const done = tickets.filter(completed),
    active = tickets.filter((ticket) => !completed(ticket));
  const list = [...(tab === "active" ? active : done)].sort(
    (a, b) => (a.priority ?? 1) - (b.priority ?? 1) || b.id - a.id,
  );
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
          <small className="muted">{tickets.length} локальных поручений</small>
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
              to={ticketPath(ticket.id, ticket.source)}
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
