import { CommentEditor } from "../../../entities/rich-content/editor/index.js";
import { useEffect, useRef, useState } from "react";
import { Plus, X, LoaderCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../../shared/api/http/index.js";
import { SingleSelect } from "../../../shared/ui/single-select/index.js";
import { StatusBadge } from "../../../entities/ticket/index.js";
import { InitialsAvatar } from "../../../shared/ui/initials-avatar/index.js";
import { ticketPath } from "../../../shared/config/routes/index.js";
import "./create-ticket.css";

const imageMarker = (id: string) => `https://orbit.invalid/create-ticket-image/${id}`;
type Person = { id: string; name: string; email: string };
const textFields = [
  ["description", "System.Description", "Описание"],
  ["acceptance", "Microsoft.VSTS.Common.AcceptanceCriteria", "Критерии приёмки"],
  ["steps", "Microsoft.VSTS.TCM.ReproSteps", "Шаги воспроизведения"],
] as const;
export function CreateTicket({ settings }: { settings: any }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const source = `${(settings?.azureUrl || "").replace(/\/$/, "")}|${settings?.azureProject || ""}`;
  return (
    <>
      <button
        type="button"
        className="primary create-ticket-trigger"
        disabled={!settings?.azureUrl || !settings?.azureProject}
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <Plus size={17} />
        Создать тикет
      </button>
      <dialog
        ref={dialog}
        className="create-ticket-dialog"
        aria-label="Создать тикет в Azure"
        onClose={() => setOpen(false)}
      >
        {open && (
          <CreateTicketForm
            key={source}
            source={source}
            project={settings.azureProject}
            colors={settings.typeColors || {}}
            onClose={() => dialog.current?.close()}
            dialog={dialog.current!}
          />
        )}
      </dialog>
    </>
  );
}
function CreateTicketForm({
  source,
  project,
  colors,
  onClose,
  dialog,
}: {
  source: string;
  project: string;
  colors: Record<string, string>;
  onClose: () => void;
  dialog: HTMLDialogElement;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [types, setTypes] = useState<string[]>([]),
    [type, setType] = useState("");
  const [fields, setFields] = useState<string[]>([]),
    [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const images = useRef<{ id: string; file: File; preview: string; uploaded?: boolean }[]>([]);
  useEffect(
    () => () => {
      images.current.forEach((image) => URL.revokeObjectURL(image.preview));
    },
    [],
  );
  const [texts, setTexts] = useState({ description: "", acceptance: "", steps: "" });
  const [recent, setRecent] = useState<Person[]>([]);
  const [people, setPeople] = useState<Person[]>([]),
    [person, setPerson] = useState<Person | null>(null);
  const [query, setQuery] = useState(""),
    [searching, setSearching] = useState(false);
  const [relations, setRelations] = useState<{ key: string; kind: string; id: string }[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<{ id: number; source: string } | null>(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setFields([]);
    api(
      `/azure/tickets/create-options?${new URLSearchParams({ source, ...(type ? { type } : {}) })}`,
    )
      .then((v) => {
        if (live) {
          if (type) setFields(v.fields);
          else setTypes(v.types);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [source, type]);
  useEffect(() => {
    let live = true;
    api(`/developers/recent-assignees?${new URLSearchParams({ source })}`)
      .then((value) => {
        if (live) setRecent(value.users);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [source]);
  const suggestedPeople = query.trim().length < 2 ? recent : people;
  useEffect(() => {
    let live = true;
    setPeople([]);
    if (query.trim().length < 2) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api("/developers/search", "POST", { query: query.trim() })
        .then((v) => {
          if (live) setPeople(v.users);
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  useEffect(() => {
    const cancel = (e: Event) => {
      e.stopPropagation();
      if (busy) e.preventDefault();
    };
    dialog.addEventListener("cancel", cancel);
    return () => dialog.removeEventListener("cancel", cancel);
  }, [busy, dialog]);
  function addImages(files: File[]) {
    if (busy) return [];
    const added: { src: string; alt: string }[] = [];
    for (const file of files) {
      if (
        !/^image\/(png|jpeg|gif|webp)$/.test(file.type) ||
        !file.size ||
        file.size > 10 * 1024 * 1024
      ) {
        setError("Поддерживаются PNG, JPEG, GIF и WebP до 10 МБ.");
        continue;
      }
      if (images.current.length >= 10) {
        setError("До 10 изображений на один черновик тикета.");
        break;
      }
      const id = crypto.randomUUID();
      images.current.push({ id, file, preview: URL.createObjectURL(file) });
      added.push({ src: imageMarker(id), alt: file.name || "Изображение" });
    }
    return added;
  }
  async function create() {
    if (busy || result) return;
    if (relations.some((r) => !/^[1-9]\d*$/.test(r.id) || !Number.isSafeInteger(Number(r.id)))) {
      setError("Укажите корректные номера связанных тикетов.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const visibleText = textFields
        .filter(([, field]) => fields.includes(field))
        .map(([key]) => texts[key])
        .join("\n");
      for (const image of images.current.filter((image) =>
        visibleText.includes(imageMarker(image.id)),
      )) {
        if (image.uploaded) continue;
        const form = new FormData();
        form.append("source", source);
        form.append("requestId", requestId);
        form.append("uploadId", image.id);
        form.append("image", image.file);
        await api("/azure/tickets/create-images", "POST", form);
        image.uploaded = true;
      }
      const value = await api("/azure/tickets/create", "POST", {
        requestId,
        source,
        type,
        title,
        assigneeId: person?.id || null,
        ...Object.fromEntries(
          textFields.map(([key, field]) => [key, fields.includes(field) ? texts[key] : ""]),
        ),
        relations: relations.map((r) => ({ kind: r.kind, id: Number(r.id) })),
      });
      setResult(value);
    } catch (e: any) {
      setError(e.message + " Черновик и загруженные картинки остаются в открытой форме.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="create-ticket-heading">
        <div>
          <h2>Создать тикет в Azure</h2>
          <span className="muted">{project}</span>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Закрыть"
          disabled={busy}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </header>
      {result ? (
        <div className="create-ticket-success">
          <p role="status">
            Тикет #{result.id} создан в Azure. В локальный список он автоматически не добавляется.
          </p>
          <Link className="primary" to={ticketPath(result.id, result.source)} onClick={onClose}>
            Открыть тикет #{result.id}
          </Link>
        </div>
      ) : (
        <>
          <div
            className="create-ticket-layout"
            onKeyDown={(event) => {
              if (event.key === "Enter") event.stopPropagation();
            }}
          >
            <aside className="create-ticket-sidebar" aria-label="Поля тикета">
              <SingleSelect
                label="Тип задачи"
                value={type}
                options={[
                  { value: "", label: "Выберите тип задачи" },
                  ...types.map((t) => ({ value: t, label: t })),
                ]}
                onChange={setType}
                disabled={busy}
                loading={loading}
                renderOption={(o) =>
                  o.value ? <StatusBadge kind="type" state={o.label} colors={colors} /> : o.label
                }
              />
              <SingleSelect
                label="Исполнитель Azure"
                value={person?.id || ""}
                options={[
                  { value: "", label: "Не назначен" },
                  ...[
                    ...new Map(
                      [...(person ? [person] : []), ...suggestedPeople.filter((p) => p.email)].map(
                        (p) => [p.id, p],
                      ),
                    ).values(),
                  ].map((p) => ({ value: p.id, label: `${p.name} · ${p.email}` })),
                ]}
                onChange={(id) =>
                  setPerson(
                    suggestedPeople.find((p) => p.id === id) || (person?.id === id ? person : null),
                  )
                }
                onSearch={setQuery}
                loading={searching}
                disabled={busy}
                renderOption={(o) => (
                  <span className="create-ticket-person">
                    {o.value && (
                      <InitialsAvatar
                        name={
                          (person?.id === o.value
                            ? person
                            : suggestedPeople.find((p) => p.id === o.value)
                          )?.name || o.label
                        }
                      />
                    )}
                    <span>{o.label}</span>
                  </span>
                )}
              />
            </aside>
            <div className="create-ticket-fields">
              <label>
                Название
                <input
                  value={title}
                  maxLength={255}
                  disabled={busy}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Что нужно сделать?"
                />
              </label>
              {textFields
                .filter(([, field]) => fields.includes(field))
                .map(([key, , label]) => (
                  <section key={key} className="create-ticket-editor" aria-label={label}>
                    <h3>{label}</h3>
                    <CommentEditor
                      label={label}
                      text={texts[key]}
                      disabled={busy}
                      onChange={(text) => setTexts((old) => ({ ...old, [key]: text }))}
                      onImages={addImages}
                      resolveImage={(src) =>
                        images.current.find((image) => imageMarker(image.id) === src)?.preview ||
                        src
                      }
                    />
                  </section>
                ))}
              <section className="create-ticket-relations">
                <strong>Связанные тикеты</strong>
                <p className="muted">
                  Выберите роль существующего тикета относительно нового: родитель (Parent),
                  дочерний (Child) или связанный (Related).
                </p>
                {relations.map((r) => (
                  <div className="create-ticket-relation" key={r.key}>
                    <SingleSelect
                      label="Связь"
                      value={r.kind}
                      searchable={false}
                      options={[
                        { value: "parent", label: "Родитель · Parent" },
                        { value: "child", label: "Дочерний · Child" },
                        { value: "related", label: "Связанный · Related" },
                      ]}
                      disabled={busy}
                      onChange={(kind) =>
                        setRelations((old) =>
                          old.map((v) => (v.key === r.key ? { ...v, kind } : v)),
                        )
                      }
                    />
                    <label>
                      Номер тикета
                      <input
                        inputMode="numeric"
                        value={r.id}
                        disabled={busy}
                        placeholder="#12345"
                        onChange={(e) => {
                          const id = e.target.value.replace(/\D/g, "");
                          setRelations((old) =>
                            old.map((v) => (v.key === r.key ? { ...v, id } : v)),
                          );
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Удалить связь"
                      disabled={busy}
                      onClick={() => setRelations((old) => old.filter((v) => v.key !== r.key))}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || relations.length >= 50}
                  onClick={() =>
                    setRelations((old) => [
                      ...old,
                      { key: crypto.randomUUID(), kind: "related", id: "" },
                    ])
                  }
                >
                  <Plus size={15} />
                  Добавить связь
                </button>
              </section>
            </div>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer className="create-ticket-footer">
            <span className="muted">
              Картинки загружаются при создании в Azure. До 10 файлов по 10 МБ.
            </span>
            <button
              type="button"
              className="primary"
              disabled={
                busy ||
                loading ||
                !type ||
                !title.trim() ||
                Object.values(texts).some((text) => text.length > 100000)
              }
              onClick={() => void create()}
            >
              {busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}{" "}
              {busy ? "Создаю…" : "Создать в Azure"}
            </button>
          </footer>
        </>
      )}
    </>
  );
}
