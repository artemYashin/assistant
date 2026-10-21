import { Link } from "react-router-dom";
import { ProjectAzureSettings } from "./ProjectAzureSettings.js";
import { PrioritySettings } from "./TicketMetadata.js";
import { DeveloperDirectory } from "./DeveloperDirectory.js";
import { SingleSelect } from "./SingleSelect.js";
import {
  Users,
  Code2,
  Pencil,
  Flag,
  GitBranch,
  Plus,
  X,
  ChevronRight,
  Settings,
} from "lucide-react";
import { ProjectRepository } from "./ProjectRepository.js";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
type Context = { client: string; project: string };
export function ContextPicker({
  context,
  onChange,
  onSettingsChange,
}: {
  context: Context;
  onChange: (c: Context) => void;
  onSettingsChange: () => void;
}) {
  const [section, setSection] = useState<
    "browse" | "catalog" | "repository" | "developers" | "priorities"
  >("browse");
  const [createKind, setCreateKind] = useState<"client" | "project">("client");
  const [items, setItems] = useState<Context[]>([]),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [project, setProject] = useState(""),
    [owner, setOwner] = useState("");
  useEffect(() => {
    let live = true;
    api("/contexts")
      .then((v) => {
        if (live) setItems(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  const all = [...items, context];
  const clients = [...new Set(all.map((x) => x.client).filter(Boolean))].sort();
  const projects = (client: string) =>
    [
      ...new Set(
        all
          .filter((x) => x.client === client)
          .map((x) => x.project)
          .filter(Boolean),
      ),
    ].sort();
  async function choose(next: Context) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/context", "PUT", next);
      onChange(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function add(e: React.FormEvent, next: Context) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setItems(await api("/contexts", "POST", next));
      setName("");
      setProject("");
      setOwner(next.client);
      await choose(next);

    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function rename(previous: Context, name: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/contexts/rename", "POST", { context: previous, name });
      // Customer filter presets are stored in this browser, separately from SQLite.
      try { if (!previous.project) {
        for (const key of Object.keys(localStorage)) {
          const match = /^(orbit\.ticket-(?:filters|presets)\.customer\.(?:active|azure|trash):)("(?:[^"\\]|\\.)*")(.*)$/.exec(key);
          if (match && JSON.parse(match[2]) === previous.client) {
            localStorage.setItem(match[1] + JSON.stringify(name) + match[3], localStorage.getItem(key)!);
          }
        }
      }
      } catch { /* Browser storage may be unavailable; server rename is already saved. */ }
      setItems(result.items);
      onChange(result.context);
      onSettingsChange();
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="header-context">
      <SingleSelect
        label="Текущий заказчик"
        value={context.client}
        disabled={busy}
        options={[
          { value: "", label: "Общий контекст" },
          ...clients.map((value) => ({ value, label: value })),
        ]}
        onChange={(client) => void choose({ client, project: "" })}
      />
      <ChevronRight size={15} aria-hidden="true" />
      <SingleSelect
        label="Текущий проект"
        value={context.project}
        disabled={busy || !context.client}
        options={[
          { value: "", label: "Без проекта" },
          ...projects(context.client).map((value) => ({ value, label: value })),
        ]}
        onChange={(project) => void choose({ ...context, project })}
      />
      {error && !open && (
        <div className="header-context-error" role="alert">
          {error}
        </div>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label="Настройки заказчиков и проектов"
        title="Заказчики и проекты"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Settings size={17} />
      </button>
      <Link className="icon-button" to="/code" title="Код репозитория" aria-label="Код репозитория"><Code2 size={18} /></Link>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            className="developer-dialog context-manager context-dialog"
            aria-label="Заказчики и проекты"
            onCancel={(event) => {
              event.preventDefault();
              setOpen(false);
            }}
          >
            <div className="context-manager-heading">
              <div>
                <h2>Заказчики и проекты</h2>
                <p className="muted">
                  {context.client || "Общий контекст"}
                  {context.project ? ` / ${context.project}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Закрыть управление контекстом"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div
              className="context-manager-nav"
              aria-label="Разделы управления контекстом"
            >
              <button
                type="button"
                aria-pressed={section === "browse"}
                onClick={() => setSection("browse")}
              >
                <Users size={16} />
                Проекты
              </button>
              <button type="button" aria-pressed={section === "catalog"} onClick={() => setSection("catalog")}>
                <Pencil size={16} />Заказчики и проекты
              </button>
              <button
                type="button"
                aria-pressed={section === "repository"}
                onClick={() => setSection("repository")}
              >
                <GitBranch size={16} />
                Репозиторий
              </button>
              <button
                type="button"
                aria-pressed={section === "developers"}
                onClick={() => setSection("developers")}
              >
                <Users size={16} />
                Разработчики
              </button>
              <button
                type="button"
                aria-pressed={section === "priorities"}
                onClick={() => setSection("priorities")}
              >
                <Flag size={16} />
                Приоритеты
              </button>
            </div>
            {section === "priorities" && (
              <PrioritySettings
                key={JSON.stringify(context)}
                context={context}
              />
            )}
            {section === "developers" && (
              <div className="context-manager-section">
                <DeveloperDirectory
                  key={`${context.client}:${context.project}`}
                  context={context}
                />
              </div>
            )}
            {section === "browse" && (
              <div className="context-manager-section">
                {context.client ? <ProjectAzureSettings
                  key={JSON.stringify(context)} context={context} onSaved={onSettingsChange}
                /> : <p className="muted">Выберите заказчика и проект в верхней панели.</p>}
              </div>
            )}
            {section === "catalog" && <div className="context-manager-section">
              <div className="context-create-kind">
                <button type="button" aria-pressed={createKind === "client"} onClick={() => setCreateKind("client")}>Новый заказчик</button>
                <button type="button" aria-pressed={createKind === "project"} onClick={() => { setCreateKind("project"); setOwner(context.client); }}>Новый проект</button>
              </div>
              <form className="context-create-form" onSubmit={(e) => void add(e, createKind === "client"
                ? { client: name.trim(), project: "" } : { client: owner, project: project.trim() })}>
                {createKind === "project" && <SingleSelect label="Заказчик проекта" value={owner} onChange={setOwner} disabled={busy}
                  options={[{ value: "", label: "Выберите заказчика" }, ...clients.map(c => ({ value: c, label: c }))]} />}
                <label>{createKind === "client" ? "Название заказчика" : "Название проекта"}
                  <input required maxLength={200} disabled={busy} value={createKind === "client" ? name : project}
                    onChange={e => createKind === "client" ? setName(e.target.value) : setProject(e.target.value)} />
                </label>
                <button className="primary" disabled={busy || !(createKind === "client" ? name.trim() : owner && project.trim())}>
                  <Plus size={16} />Добавить и выбрать
                </button>
              </form>
              <div className="context-directory">
                {clients.map(client => <section className="context-directory-client" key={client}>
                  <ContextName key={client} value={client} kind="Заказчик" busy={busy} onSave={name => rename({ client, project: "" }, name)} />
                  {projects(client).map(project => <ContextName key={project} value={project} kind="Проект" busy={busy}
                    onSave={name => rename({ client, project }, name)} />)}
                  {!projects(client).length && <p className="muted">Пока нет проектов</p>}
                </section>)}
              </div>
            </div>}
            {section === "repository" && (
              <div className="context-manager-section">
                <p className="muted">
                  Настройки PR для выбранного проекта. Подключение Azure DevOps
                  задаётся в настройках приложения.
                </p>
                <ProjectRepository
                  onSaved={onSettingsChange}
                  key={`${context.client}:${context.project}`}
                  context={context}
                />
              </div>
            )}
          </dialog>,
          document.body,
        )}
    </div>
  );
}

function ContextName({ value, kind, busy, onSave }: { value: string; kind: string; busy: boolean; onSave: (name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  return <form className="context-directory-name" onSubmit={async e => {
    e.preventDefault();
    try { await onSave(draft.trim()); setEditing(false); } catch { /* Parent displays the error. */ }
  }}>
    <span className="muted">{kind}</span>
    {editing ? <><input aria-label={`Название: ${value}`} value={draft} onChange={e => setDraft(e.target.value)} maxLength={200} required disabled={busy} autoFocus />
      <button className="primary" disabled={busy || !draft.trim()}>Сохранить</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(false)}>Отмена</button></>
      : <><strong>{value}</strong><button type="button" className="icon-button" disabled={busy} aria-label={`Переименовать ${value}`}
        onClick={() => { setDraft(value); setEditing(true); }}><Pencil size={14} /></button></>}
  </form>;
}
