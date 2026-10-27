import { useEffect, useRef, useState } from "react";
import { Plus, X, LoaderCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../../shared/api/http/index.js";
import { SingleSelect } from "../../../shared/ui/single-select/index.js";
import { StatusBadge } from "../../../entities/ticket/index.js";
import { InitialsAvatar } from "../../../shared/ui/initials-avatar/index.js";
import { ticketPath } from "../../../shared/config/routes/index.js";
import "./create-ticket.css";

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
  const [texts, setTexts] = useState({ description: "", acceptance: "", steps: "" });
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
  async function create() {
    if (busy || result) return;
    if (relations.some((r) => !/^[1-9]\d*$/.test(r.id) || !Number.isSafeInteger(Number(r.id)))) {
      setError("Укажите корректные номера связанных тикетов.");
      return;
    }
    setBusy(true);
    setError("");
    try {
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
      setError(e.message);
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
          <div className="create-ticket-fields">
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
            <SingleSelect
              label="Исполнитель Azure"
              value={person?.id || ""}
              options={[
                { value: "", label: "Не назначен" },
                ...[
                  ...new Map(
                    [...(person ? [person] : []), ...people.filter((p) => p.email)].map((p) => [
                      p.id,
                      p,
                    ]),
                  ).values(),
                ].map((p) => ({ value: p.id, label: `${p.name} · ${p.email}` })),
              ]}
              onChange={(id) =>
                setPerson(people.find((p) => p.id === id) || (person?.id === id ? person : null))
              }
              onSearch={setQuery}
              loading={searching}
              disabled={busy}
              renderOption={(o) => (
                <span className="create-ticket-person">
                  {o.value && (
                    <InitialsAvatar
                      name={
                        (person?.id === o.value ? person : people.find((p) => p.id === o.value))
                          ?.name || o.label
                      }
                    />
                  )}
                  <span>{o.label}</span>
                </span>
              )}
            />
            {textFields
              .filter(([, field]) => fields.includes(field))
              .map(([key, , label]) => (
                <label key={key}>
                  {label}
                  <textarea
                    aria-label={label}
                    rows={4}
                    maxLength={100000}
                    value={texts[key]}
                    disabled={busy}
                    onChange={(e) => setTexts((old) => ({ ...old, [key]: e.target.value }))}
                    placeholder="Текст или Markdown"
                  />
                </label>
              ))}
            <section className="create-ticket-relations">
              <strong>Связанные тикеты</strong>
              <p className="muted">
                Выберите роль существующего тикета относительно нового: родитель (Parent), дочерний
                (Child) или связанный (Related).
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
                      setRelations((old) => old.map((v) => (v.key === r.key ? { ...v, kind } : v)))
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
                        setRelations((old) => old.map((v) => (v.key === r.key ? { ...v, id } : v)));
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
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer className="create-ticket-footer">
            <span className="muted">Создание изменит данные в Azure DevOps.</span>
            <button
              type="button"
              className="primary"
              disabled={busy || loading || !type || !title.trim()}
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
