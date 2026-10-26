import { Fragment } from "react";
import { ExportMemoryButton } from "../../../features/export-memory/index.js";
import { MemoryBody } from "../../../widgets/memory/index.js";
import { MultiSelect } from "../../../shared/ui/multi-select/index.js";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Plus, Search, Sparkles, Trash2, X, Users, Globe, FolderOpen } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { TicketCard } from "../../../widgets/ticket/index.js";
import { Badge } from "../../../shared/ui/badge/index.js";
import { Empty } from "../../../shared/ui/empty/index.js";
import { Field } from "../../../shared/ui/field/index.js";
import { PageHeading } from "../../../shared/ui/page-heading/index.js";

const date = (s?: string) =>
  s
    ? new Date(s).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Ещё не было";
export function Memory({ memories, context, run, busy }: any) {
  const [editingMemory, setEditingMemory] = useState<string | null>(null);
  const [scope, setScope] = useState("general"),
    [body, setBody] = useState(""),
    [summary, setSummary] = useState("");
  const createDialog = useRef<HTMLDialogElement>(null);
  const [createError, setCreateError] = useState("");
  const [scopeFilters, setScopeFilters] = useState<string[]>(["general", "client", "project", "project_review"]);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; summary: string } | null>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (deleteTarget) deleteDialog.current?.showModal();
    else deleteDialog.current?.close();
  }, [deleteTarget]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const filtered = memories.filter((memory: any) =>
    scopeFilters.includes(memory.scope) && (memory.summary || "").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const pageSize = 36;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); setSearch(""); }, [context.client, context.project]);
  useEffect(() => { setPage(currentPage); }, [currentPage]);
  const labels: any = {
    general: "Общая",
    client: "Заказчик",
    project: "Проект",
    project_review: "Ревью проекта",
  };
  return (
    <>
      <dialog ref={deleteDialog} className="developer-dialog memory-delete-dialog" aria-label="Удалить запись памяти" onClose={() => setDeleteTarget(null)} onCancel={event => { if (busy) event.preventDefault(); }}>
        <div className="developer-dialog-heading">
          <strong>Удалить запись памяти?</strong>
          <button type="button" className="icon-button" aria-label="Закрыть" disabled={!!busy} onClick={() => setDeleteTarget(null)}><X size={18} /></button>
        </div>
        <p>Вы действительно хотите удалить эту запись?</p>
        <div className="memory-delete-title">{deleteTarget?.summary}</div>
        <div className="card-actions">
          <button type="button" className="secondary" autoFocus disabled={!!busy} onClick={() => setDeleteTarget(null)}>Отмена</button>
          <button type="button" className="memory-delete-confirm" disabled={!!busy || !deleteTarget} onClick={() => {
            if (!deleteTarget) return;
            const id = deleteTarget.id;
            run(id, async () => {
              await api(`/memories/${id}`, "DELETE");
              setDeleteTarget(null);
            }, "Запись удалена");
          }}><Trash2 size={16} />{busy ? "Удаление…" : "Удалить"}</button>
        </div>
      </dialog>
      <div className="memory-page-heading"><PageHeading
        title="Важное остаётся с вами"
        subtitle="Память доступна ассистенту с учётом выбранного заказчика и проекта."
      ><ExportMemoryButton key={JSON.stringify(context)} context={context} /></PageHeading></div>
      <div className="memory-create-toolbar">
        <button type="button" className="primary" disabled={!!busy} onClick={() => {
          setCreateError("");
          if ((scope !== "general" && !context.client) || (["project", "project_review"].includes(scope) && !context.project)) setScope("general");
          createDialog.current?.showModal();
        }}><Plus size={16} />Добавить память</button>
      </div>
      <dialog ref={createDialog} className="developer-dialog memory-create-dialog" aria-label="Добавить память" onCancel={event => { if (busy) event.preventDefault(); }}>
        <div className="developer-dialog-heading"><strong>Добавить память · {labels[scope]}</strong><button type="button" className="icon-button" aria-label="Закрыть" disabled={!!busy} onClick={() => createDialog.current?.close()}><X size={18} /></button></div>
      <div className="memory-scopes" role="group" aria-label="Раздел для новой записи">
        {[
          {
            id: "general",
            icon: Globe,
            title: "Общая",
            description: "Ваши предпочтения и важные тезисы",
          },
          {
            id: "client",
            icon: Users,
            title: "Заказчик",
            description: context.client || "Выберите заказчика сверху",
          },
          {
            id: "project",
            icon: FolderOpen,
            title: "Проект",
            description: context.project || "Выберите проект сверху",
          },
          { id: "project_review", icon: Sparkles, title: "Ревью проекта", description: "Только для ревью pull request, не для контекста чата" },
        ].map((s) => (
          <button
            className={scope === s.id ? "selected" : ""}
            key={s.id}
            type="button"
            aria-pressed={scope === s.id}
            title={s.description}
            disabled={!!busy || (s.id !== "general" && !context.client) || (["project", "project_review"].includes(s.id) && !context.project)}
            onClick={() => setScope(s.id)}
          >
            <s.icon size={16} />
            <b>{s.title}</b>

          </button>
        ))}
      </div>
        {scope !== "general" && <p className="muted">{context.client}{["project", "project_review"].includes(scope) ? ` / ${context.project}` : ""}</p>}
      <form
        className="memory-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          setCreateError("");
          run(
            "memory",
            async () => {
              try {
                await api("/memories", "POST", { scope, body, summary, context });
                setBody("");
                setSummary("");
                createDialog.current?.close();
              } catch (error: any) {
                setCreateError(error.message);
                throw error;
              }
            },
            "Сохранено в память",
          );
        }}
      >
        <Field label="Название · 1–2 предложения"><input autoFocus disabled={!!busy} value={summary} onChange={event => setSummary(event.target.value)} maxLength={320} required placeholder="Для чего нужна эта запись" /></Field>
        <Field label="Описание · Markdown">
          <textarea
            placeholder="Например: по этому проекту договорились отправлять статус каждую пятницу…"
            rows={5}
            disabled={!!busy}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            maxLength={8000}
          />
        </Field>
        {createError && <p className="error" role="alert">{createError}</p>}
        <div className="card-actions">
        <button type="button" className="secondary" disabled={!!busy} onClick={() => createDialog.current?.close()}>Отмена</button>
        <button
          className="primary"
          disabled={
            !!busy ||
            (scope !== "general" && !context.client) ||
            (["project", "project_review"].includes(scope) && !context.project)
          }
        >
          <Plus size={16} />
          Сохранить
        </button>
        </div>
      </form>
      </dialog>
      <section className="memory-bank-toolbar" aria-label="Банк памяти">
      <h2><BookOpen size={16} />Банк памяти</h2>
      <div className="memory-list-toolbar">
        <MultiSelect label="Разделы памяти" placeholder="Выберите разделы" options={Object.entries(labels).map(([value, label]) => ({ value, label: String(label) }))} value={scopeFilters} onChange={value => { setScopeFilters(value); setPage(1); }} />
        <div className="memory-search-group">
          <span className="memory-search-label">Поиск по названию</span>
          <label className="memory-search">
            <Search size={16} aria-hidden="true" />
            <input aria-label="Поиск памяти по названию" placeholder="Поиск по названию…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
          </label>
          <span className="memory-search-count" role="status">Найдено: {filtered.length}</span>
        </div>
      </div>
      <div className="memory-grid">
        {visible.map((m: any) => (
          <article className="panel memory-note" key={m.id}>
            <div className="memory-note-heading">
              <small className="memory-note-id" title={m.id}>ID: {m.id}</small>
              <button className="icon-button memory-note-delete" title="Удалить запись" aria-label="Удалить запись" disabled={!!busy}
                onClick={() => setDeleteTarget({ id: m.id, summary: m.summary })}>
                <Trash2 size={16} />
              </button>
            </div>
            <div className="memory-note-scope">
              <Badge
                tone={
                  m.scope === "general"
                    ? "green"
                    : m.scope === "client"
                      ? "violet"
                      : "amber"
                }
              >
                {labels[m.scope]}
                {m.project
                  ? ` · ${m.project}`
                  : m.client
                    ? ` · ${m.client}`
                    : ""}
              </Badge>

            </div>
            <MemoryBody
              key={`${m.id}:${m.summary}:${m.body}`}
              id={m.id}
              body={m.body}
              summary={m.summary}
              disabled={!!busy}
              actions={<button type="button" className="secondary memory-refine-button" disabled={!!busy || editingMemory === m.id} onClick={() => run(`refine-memory:${m.id}`, async () => {
              const proposal = await api<any>(`/memories/${m.id}/refine`, "POST", { context });
              window.dispatchEvent(new CustomEvent("orbit:refine-memory", { detail: { ...proposal, body: proposal.summary } }));
            })}><Sparkles size={15} />Refine with AI</button>}
              onEditingChange={editing => setEditingMemory(editing ? m.id : null)}
              onSaved={() => { setEditingMemory(null); run("refresh-memory", async () => {}); }}
            />

            {(typeof m.cards === "string"
              ? JSON.parse(m.cards)
              : m.cards || []
            ).map((ref: string) => (
              <TicketCard key={ref} reference={ref} />
            ))}
            <small className="memory-note-date">{date(m.created_at)}</small>
          </article>
        ))}
      </div>
      {filtered.length > 0 && (
        <nav className="memory-pagination" aria-label="Страницы памяти">
          <button className="secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Назад</button>
          {Array.from(new Set([1, currentPage - 1, currentPage, currentPage + 1, pageCount]))
            .filter(value => value >= 1 && value <= pageCount).sort((a, b) => a - b)
            .map((value, index, pages) => <Fragment key={value}>
              {index > 0 && value - pages[index - 1] > 1 && <span>…</span>}
              <button className={value === currentPage ? "primary" : "secondary"} aria-current={value === currentPage ? "page" : undefined} onClick={() => setPage(value)}>{value}</button>
            </Fragment>)}
          <button className="secondary" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Далее</button>
          <span>{currentPage} из {pageCount}</span>
        </nav>
      )}
      {!!memories.length && !filtered.length && <Empty icon={Search} title="Ничего не найдено" description="Измените поисковый запрос или выбранные разделы памяти." />}
      {!memories.length && (
        <Empty
          icon={BookOpen}
          title="Начните с одной важной детали"
          description="Добавьте запись здесь или скажите ассистенту: «Запомни для этого проекта…»."
        />
      )}
      </section>
    </>
  );
}
