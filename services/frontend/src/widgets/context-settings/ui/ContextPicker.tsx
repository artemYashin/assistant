import { useLocalManagement } from "../../../entities/work-mode/index.js";
import { ProjectTicketImport } from "./ProjectTicketImport.js";
import { DeleteContextButton } from "./DeleteContextButton.js";
import { ContextSaveButton } from "../../../shared/ui/save-button/index.js";
import {
  copyRenamedContextStorage,
  deleteContextStorage,
} from "../../../entities/workspace/index.js";
import { ProjectAzureSettings } from "./ProjectAzureSettings.js";
import { DeveloperDirectory } from "./DeveloperDirectory.js";
import { SingleSelect } from "../../../shared/ui/single-select/index.js";
import {
  Users,
  Cloud,
  Folder,
  Pencil,
  GitBranch,
  Plus,
  X,
  ChevronRight,
  Settings,
} from "lucide-react";
import { ProjectRepository } from "./ProjectRepository.js";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../shared/api/http/index.js";
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
  const management = useLocalManagement();
  const [section, setSection] = useState<
    "browse" | "catalog" | "repository" | "developers" | "import"
  >("catalog");
  useEffect(() => {
    if (!management && section === "developers") setSection("catalog");
  }, [management, section]);
  const [catalogClient, setCatalogClient] = useState("");
  const [catalogProject, setCatalogProject] = useState("");
  const [creating, setCreating] = useState(false);
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
  const selectedClient = clients.includes(catalogClient)
    ? catalogClient
    : clients.includes(context.client)
      ? context.client
      : clients[0] || "";
  const clientProjects = projects(selectedClient);
  const selectedProject = clientProjects.includes(catalogProject)
    ? catalogProject
    : selectedClient === context.client && clientProjects.includes(context.project)
      ? context.project
      : clientProjects[0] || "";
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
      setCatalogClient(next.client);
      setCatalogProject(next.project);
      setCreating(false);
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
      try {
        copyRenamedContextStorage(localStorage, previous, name);
      } catch {
        /* Browser storage may be unavailable; server rename is already saved. */
      }
      setCatalogClient(previous.project ? previous.client : name);
      setCatalogProject(previous.project ? name : selectedProject);
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
  async function remove(target: Context, confirmation: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/contexts", "DELETE", { context: target, confirmation });
      try {
        deleteContextStorage(localStorage, target);
      } catch {
        /* Server deletion succeeded; browser storage may be unavailable. */
      }
      setItems(result.items);
      setCatalogClient(target.project ? target.client : "");
      setCatalogProject("");
      setCreating(false);
      onChange(result.context);
      onSettingsChange();
      window.dispatchEvent(new Event("orbit:data-synced"));
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
        onClick={() => {
          setCatalogClient(context.client);
          setCatalogProject(context.project);
          setOpen(true);
        }}
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
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="context-dialog-selectors">
              <SingleSelect
                label="Заказчик в настройках"
                value={context.client}
                disabled={busy}
                options={[
                  { value: "", label: "Общий контекст" },
                  ...clients.map((value) => ({ value, label: value })),
                ]}
                onChange={(client) => {
                  setCatalogClient(client);
                  setCatalogProject("");
                  void choose({ client, project: "" });
                }}
              />
              <ChevronRight size={15} />
              <SingleSelect
                label="Проект в настройках"
                value={context.project}
                disabled={busy || !context.client}
                options={[
                  { value: "", label: "Без проекта" },
                  ...projects(context.client).map((value) => ({ value, label: value })),
                ]}
                onChange={(project) => {
                  setCatalogProject(project);
                  void choose({ ...context, project });
                }}
              />
            </div>
            <div className="context-manager-nav" aria-label="Разделы управления контекстом">
              <button
                type="button"
                aria-pressed={section === "catalog"}
                onClick={() => setSection("catalog")}
              >
                <Users size={16} />
                Заказчики и проекты
              </button>
              <button
                type="button"
                aria-pressed={section === "browse"}
                onClick={() => setSection("browse")}
              >
                <Cloud size={16} />
                Подключение Azure
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
                aria-pressed={section === "import"}
                onClick={() => setSection("import")}
              >
                <Plus size={16} />
                Автоматический импорт
              </button>
              {management && (
                <button
                  type="button"
                  aria-pressed={section === "developers"}
                  onClick={() => setSection("developers")}
                >
                  <Users size={16} />
                  Разработчики
                </button>
              )}
            </div>
            {section === "import" && (
              <div className="context-manager-section">
                <ProjectTicketImport
                  key={JSON.stringify(context)}
                  context={context}
                  onSaved={onSettingsChange}
                />
              </div>
            )}
            {management && section === "developers" && (
              <div className="context-manager-section">
                <DeveloperDirectory
                  key={`${context.client}:${context.project}`}
                  context={context}
                />
              </div>
            )}
            {section === "browse" && (
              <div className="context-manager-section">
                {
                  <ProjectAzureSettings
                    key={JSON.stringify(context)}
                    context={context}
                    onSaved={onSettingsChange}
                  />
                }
              </div>
            )}
            {section === "catalog" && (
              <div className="context-manager-section">
                <section className="context-catalog-level">
                  <div className="context-catalog-heading">
                    <h3>
                      <Users size={16} />
                      Заказчики
                    </h3>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        setCreateKind("client");
                        setCreating(true);
                      }}
                    >
                      <Plus size={14} />
                      Заказчик
                    </button>
                  </div>
                  <div
                    className="context-catalog-tabs"
                    aria-label="Выбор заказчика для редактирования"
                  >
                    {clients.map((client) => (
                      <ContextChip
                        key={client}
                        value={client}
                        kind="Заказчик"
                        busy={busy}
                        selected={selectedClient === client}
                        onSelect={() => {
                          setCatalogClient(client);
                          setCatalogProject("");
                          setCreating(false);
                        }}
                        onSave={(name) => rename({ client, project: "" }, name)}
                        deleteAction={
                          <DeleteContextButton
                            iconOnly
                            context={{ client, project: "" }}
                            disabled={busy}
                            onDelete={remove}
                          />
                        }
                      />
                    ))}
                  </div>
                  {!clients.length && <p className="muted">Добавьте первого заказчика.</p>}
                </section>
                {selectedClient && (
                  <section className="context-catalog-level context-catalog-projects">
                    <div className="context-catalog-heading">
                      <h3>
                        <Folder size={16} />
                        Проекты <small>{selectedClient}</small>
                      </h3>
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setCreateKind("project");
                          setOwner(selectedClient);
                          setCreating(true);
                        }}
                      >
                        <Plus size={14} />
                        Проект
                      </button>
                    </div>
                    <div
                      className="context-catalog-tabs"
                      aria-label={`Проекты заказчика ${selectedClient}`}
                    >
                      {clientProjects.map((project) => (
                        <ContextChip
                          key={JSON.stringify([selectedClient, project])}
                          value={project}
                          kind="Проект"
                          busy={busy}
                          selected={selectedProject === project}
                          onSelect={() => {
                            setCatalogProject(project);
                            setCreating(false);
                          }}
                          onSave={(name) => rename({ client: selectedClient, project }, name)}
                          deleteAction={
                            <DeleteContextButton
                              iconOnly
                              context={{ client: selectedClient, project }}
                              disabled={busy}
                              onDelete={remove}
                            />
                          }
                        />
                      ))}
                    </div>
                    {!clientProjects.length && (
                      <p className="muted">У этого заказчика пока нет проектов.</p>
                    )}
                  </section>
                )}
                {creating && (
                  <div className="context-create-panel">
                    <div className="context-catalog-heading">
                      <h3>{createKind === "client" ? "Новый заказчик" : "Новый проект"}</h3>
                      <button
                        type="button"
                        className="icon-button"
                        disabled={busy}
                        aria-label="Отменить добавление"
                        onClick={() => setCreating(false)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <form
                      className="context-create-form"
                      onSubmit={(e) =>
                        void add(
                          e,
                          createKind === "client"
                            ? { client: name.trim(), project: "" }
                            : { client: owner, project: project.trim() },
                        )
                      }
                    >
                      {createKind === "project" && (
                        <SingleSelect
                          label="Заказчик проекта"
                          value={owner}
                          onChange={setOwner}
                          disabled={busy}
                          options={[
                            { value: "", label: "Выберите заказчика" },
                            ...clients.map((c) => ({ value: c, label: c })),
                          ]}
                        />
                      )}
                      <label>
                        {createKind === "client" ? "Название заказчика" : "Название проекта"}
                        <input
                          required
                          maxLength={200}
                          disabled={busy}
                          value={createKind === "client" ? name : project}
                          onChange={(e) =>
                            createKind === "client"
                              ? setName(e.target.value)
                              : setProject(e.target.value)
                          }
                        />
                      </label>
                      <button
                        className="primary"
                        disabled={
                          busy || !(createKind === "client" ? name.trim() : owner && project.trim())
                        }
                      >
                        <Plus size={16} />
                        Добавить и выбрать
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}
            {section === "repository" && (
              <div className="context-manager-section">
                <p className="muted">
                  Настройки PR для выбранного проекта. Подключение Azure DevOps задаётся здесь, в
                  разделе «Подключение Azure».
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

function ContextChip({
  value,
  kind,
  busy,
  selected,
  onSelect,
  onSave,
  deleteAction,
}: {
  value: string;
  kind: string;
  busy: boolean;
  selected: boolean;
  onSelect: () => void;
  onSave: (name: string) => Promise<void>;
  deleteAction: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  return (
    <div className={`context-catalog-chip${selected ? " is-selected" : ""}`}>
      <button
        type="button"
        className="context-chip-name"
        disabled={busy}
        aria-pressed={selected}
        onClick={onSelect}
        title={value}
      >
        {value}
      </button>
      <button
        type="button"
        className="icon-button"
        disabled={busy}
        aria-label={`Переименовать: ${value}`}
        title="Переименовать"
        onClick={() => {
          setDraft(value);
          setError("");
          dialog.current?.showModal();
        }}
      >
        <Pencil size={14} />
      </button>
      {deleteAction}
      {createPortal(
        <dialog
          ref={dialog}
          className="developer-dialog context-rename-dialog"
          aria-label={`Переименовать: ${value}`}
          onCancel={(event) => {
            event.stopPropagation();
            if (busy) event.preventDefault();
          }}
        >
          <div className="developer-dialog-heading">
            <h2>Переименовать</h2>
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              aria-label="Закрыть"
              onClick={() => dialog.current?.close()}
            >
              <X size={18} />
            </button>
          </div>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy || !draft.trim()) return;
              setError("");
              try {
                await onSave(draft.trim());
                dialog.current?.close();
              } catch (error: any) {
                setError(error.message || "Не удалось переименовать");
              }
            }}
          >
            <label>
              {kind}: новое название
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={200}
                required
                disabled={busy}
                autoFocus
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="context-save-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => dialog.current?.close()}
              >
                Отмена
              </button>
              <ContextSaveButton type="submit" busy={busy} disabled={!draft.trim()} />
            </div>
          </form>
        </dialog>,
        document.body,
      )}
    </div>
  );
}
