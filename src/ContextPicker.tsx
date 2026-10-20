import { PrioritySettings } from "./TicketMetadata.js";
import { DeveloperDirectory } from "./DeveloperDirectory.js";
import { SingleSelect } from "./SingleSelect.js";
import {
  Users,
  FolderPlus,
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
}: {
  context: Context;
  onChange: (c: Context) => void;
}) {
  const [section, setSection] = useState<
    "browse" | "create" | "repository" | "developers" | "priorities"
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
            <div className="context-bar">
              <SingleSelect
                label="Текущий заказчик"
                value={context.client}
                disabled={busy}
                options={[
                  { value: "", label: "Общий контекст" },
                  ...clients.map((c) => ({ value: c, label: c })),
                ]}
                onChange={(client) => void choose({ client, project: "" })}
              />
              <SingleSelect
                label="Текущий проект"
                value={context.project}
                disabled={busy || !context.client}
                options={[
                  { value: "", label: "Без проекта · память заказчика" },
                  ...projects(context.client).map((p) => ({
                    value: p,
                    label: p,
                  })),
                ]}
                onChange={(project) => void choose({ ...context, project })}
              />
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
                Обзор
              </button>
              <button
                type="button"
                aria-pressed={section === "create"}
                onClick={() => {
                  setSection("create");
                  setOwner(context.client);
                }}
              >
                <FolderPlus size={16} />
                Добавить
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
                <p className="muted">
                  Выбор переключает историю чата и память проекта. Общая память
                  доступна всегда.
                </p>
                {!clients.length ? (
                  <div className="context-empty">
                    <p>
                      Начните с первого заказчика, затем добавьте его проекты.
                    </p>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setCreateKind("client");
                        setSection("create");
                      }}
                    >
                      <Plus size={16} />
                      Добавить заказчика
                    </button>
                  </div>
                ) : (
                  <div className="context-catalog">
                    {clients.map((c) => (
                      <details key={c} open={context.client === c}>
                        <summary>
                          <Users size={17} aria-hidden="true" />
                          {c}
                          <span className="ticket-count">
                            {projects(c).length} проектов
                          </span>
                        </summary>
                        <div className="context-project-list">
                          <button
                            type="button"
                            className="secondary"
                            disabled={busy}
                            aria-pressed={
                              context.client === c && !context.project
                            }
                            onClick={() =>
                              void choose({ client: c, project: "" })
                            }
                          >
                            Без проекта · память заказчика
                          </button>
                          {projects(c).map((p) => (
                            <button
                              type="button"
                              key={p}
                              className="secondary"
                              disabled={busy}
                              aria-pressed={
                                context.client === c && context.project === p
                              }
                              onClick={() =>
                                void choose({ client: c, project: p })
                              }
                            >
                              {p}
                              {context.client === c && context.project === p
                                ? " · выбран"
                                : ""}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => {
                              setOwner(c);
                              setCreateKind("project");
                              setSection("create");
                            }}
                          >
                            <Plus size={14} />
                            Новый проект
                          </button>
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            )}
            {section === "create" && (
              <div className="context-manager-section">
                <div className="context-create-kind">
                  <button
                    type="button"
                    aria-pressed={createKind === "client"}
                    onClick={() => setCreateKind("client")}
                  >
                    Новый заказчик
                  </button>
                  <button
                    type="button"
                    aria-pressed={createKind === "project"}
                    onClick={() => setCreateKind("project")}
                  >
                    Новый проект
                  </button>
                </div>
                <p className="muted">
                  После создания контекст будет выбран и сохранён автоматически.
                </p>
                {createKind === "client" ? (
                  <form
                    className="context-create-form"
                    onSubmit={(e) =>
                      void add(e, { client: name.trim(), project: "" })
                    }
                  >
                    <label>
                      Название заказчика
                      <input
                        disabled={busy}
                        maxLength={200}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Например, Acme"
                        required
                      />
                    </label>
                    <button className="primary" disabled={busy || !name.trim()}>
                      Добавить и выбрать
                    </button>
                  </form>
                ) : (
                  <form
                    className="context-create-form"
                    onSubmit={(e) =>
                      void add(e, { client: owner, project: project.trim() })
                    }
                  >
                    <SingleSelect
                      label="Заказчик проекта"
                      disabled={busy}
                      value={owner}
                      onChange={setOwner}
                      options={[
                        { value: "", label: "Выберите заказчика" },
                        ...clients.map((c) => ({ value: c, label: c })),
                      ]}
                    />
                    {!clients.length && (
                      <p className="muted">Сначала добавьте заказчика.</p>
                    )}
                    <label>
                      Название проекта
                      <input
                        disabled={busy}
                        maxLength={200}
                        value={project}
                        onChange={(e) => setProject(e.target.value)}
                        placeholder="Например, Портал"
                        required
                      />
                    </label>
                    <button
                      className="primary"
                      disabled={busy || !owner || !project.trim()}
                    >
                      Добавить и выбрать
                    </button>
                  </form>
                )}
              </div>
            )}
            {section === "repository" && (
              <div className="context-manager-section">
                <p className="muted">
                  Настройки PR для выбранного проекта. Подключение Azure DevOps
                  задаётся в настройках приложения.
                </p>
                <ProjectRepository
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
