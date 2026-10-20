import { InitialsAvatar } from "./InitialsAvatar.js";
import { ProjectDeveloperStatusSettings } from "./DeveloperStatusSettings.js";
import { Users, Settings2, Plus, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "./api.js";
import { SingleSelect } from "./SingleSelect.js";
export function DeveloperDirectory({
  context,
}: {
  context: { client: string; project: string };
}) {
  const [scope, setScope] = useState(
      context.project ? "project" : context.client ? "client" : "general",
    ),
    [items, setItems] = useState<any[]>([]),
    [names, setNames] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const target = {
    client: scope === "general" ? "" : context.client,
    project: scope === "project" ? context.project : "",
  };
  const query = new URLSearchParams(target).toString();
  useEffect(() => {
    let live = true;
    api(`/local-developers?${query}`)
      .then((rows) => {
        if (live) setItems(rows);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [query, revision]);
  async function action(fn: () => Promise<any>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setRevision((v) => v + 1);
      window.dispatchEvent(new Event("orbit:developer-board"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const own = items.filter(
    (p) => p.client === target.client && p.project === target.project,
  );
  const inherited = items.filter(
    (p) => p.client !== target.client || p.project !== target.project,
  );
  return (
    <div className="developer-directory">
      <section className="developer-directory-panel">
        <h3>
          <Users size={18} /> Справочник разработчиков
        </h3>
        <SingleSelect
          label="Область списка разработчиков"
          value={scope}
          onChange={setScope}
          disabled={busy}
          options={[
            { value: "general", label: "Общий список" },
            ...(context.client
              ? [{ value: "client", label: `Заказчик: ${context.client}` }]
              : []),
            ...(context.project
              ? [{ value: "project", label: `Проект: ${context.project}` }]
              : []),
          ]}
        />
        <p className="muted">
          Одна строка — одно имя. Это локальный справочник, без привязки к
          Azure. Общие имена доступны всем проектам, имена заказчика — его
          проектам.
        </p>
        <div className="developer-directory-editor">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await api("/local-developers", "POST", {
                  context: target,
                  names: names
                    .split("\n")
                    .map((n) => n.trim())
                    .filter(Boolean),
                });
                setNames("");
              });
            }}
          >
            <label>
              Добавить разработчиков
              <textarea
                rows={4}
                maxLength={20000}
                value={names}
                disabled={busy}
                onChange={(e) => setNames(e.target.value)}
                placeholder={"Анна Иванова\nИван Петров"}
              />
            </label>
            <button className="primary" disabled={busy || !names.trim()}>
              <Plus size={15} /> Добавить
            </button>
          </form>
          <section className="developer-directory-roster">
            <h4>В выбранной области · {own.length}</h4>
            <div className="developer-directory-list">
              {own.map((person) => (
                <DeveloperRow
                  key={`${person.id}:${person.name}`}
                  person={person}
                  busy={busy}
                  action={action}
                />
              ))}
            </div>
            {!own.length && (
              <p className="muted">В этой области пока нет разработчиков.</p>
            )}
          </section>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!!inherited.length && (
          <details>
            <summary>
              <Users size={17} aria-hidden="true" />
              Доступны из общей области и заказчика · {inherited.length}
            </summary>
            <div className="developer-inherited-list">
              {inherited.map((p) => (
                <span key={p.id}>
                  <InitialsAvatar name={p.name} />
                  {p.name}
                </span>
              ))}
            </div>
          </details>
        )}
        <small className="muted">
          «Убрать» скрывает имя из новых назначений. Существующие поручения
          сохраняются.
        </small>
      </section>
      <details
        className="developer-directory-panel"
        onToggle={(e) => setShowSettings(e.currentTarget.open)}
      >
        <summary>
          <Settings2 size={17} /> Группировка поручений ·{" "}
          {context.project || "выберите проект"}
        </summary>
        {showSettings &&
          (context.project ? (
            <ProjectDeveloperStatusSettings
              key={JSON.stringify(context)}
              context={context}
            />
          ) : (
            <p className="muted">
              Выберите проект, чтобы настроить вкладки и показ корзины.
            </p>
          ))}
      </details>
    </div>
  );
}
function DeveloperRow({ person, busy, action }: any) {
  const [name, setName] = useState(person.name);
  return (
    <div className="developer-directory-row">
      <InitialsAvatar name={person.name} />
      <input
        aria-label={`Имя разработчика ${person.name}`}
        maxLength={200}
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
      />
      <button
        className="icon-button"
        title="Сохранить имя"
        aria-label={`Сохранить имя ${person.name}`}
        disabled={busy || !name.trim() || name.trim() === person.name}
        onClick={() =>
          void action(() =>
            api(`/local-developers/${person.id}`, "PUT", { name: name.trim() }),
          )
        }
      >
        <Save size={16} />
      </button>
      <button
        className="icon-button"
        title="Убрать из справочника"
        aria-label={`Убрать ${person.name} из справочника`}
        disabled={busy}
        onClick={() =>
          void action(() => api(`/local-developers/${person.id}`, "DELETE"))
        }
      >
        <X size={16} />
      </button>
    </div>
  );
}
