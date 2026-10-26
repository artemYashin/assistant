import { SingleSelect } from "../../../shared/ui/single-select/index.js";
import { InitialsAvatar } from "../../../shared/ui/initials-avatar/index.js";
import { ProjectDeveloperStatusSettings } from "./DeveloperStatusSettings.js";
import { Users, Settings2, Plus, X, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../../shared/api/http/index.js";
export function DeveloperDirectory({
  context,
}: {
  context: { client: string; project: string };
}) {
  const [items, setItems] = useState<any[]>([]),
    [names, setNames] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [scope,setScope]=useState(context.project?"project":context.client?"client":"general");
  const levels=[{value:"general",label:"Общий · все проекты"},
    ...(context.client?[{value:"client",label:"Заказчик · "+context.client}]:[]),
    ...(context.project?[{value:"project",label:"Проект · "+context.project}]:[])];
  const target=scope==="general"?{client:"",project:""}:scope==="client"?{client:context.client,project:""}:context;
  const query = new URLSearchParams(context).toString();
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
  const own = items;
  return (
    <div className="developer-directory">
      <section className="developer-directory-panel">
        <h3>
          <Users size={18} /> Справочник разработчиков
        </h3>
        <p className="muted">
          Одна строка — одно имя. Общие разработчики доступны везде, разработчики заказчика — во всех его проектах. Список хранится локально; Azure не изменяется.
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
            <SingleSelect label="Уровень нового разработчика" value={scope} options={levels} disabled={busy} onChange={setScope}/>
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
            <h4>Доступные разработчики · {own.length}</h4>
            <div className="developer-directory-list">
              {levels.map(level=>{
                const people=own.filter(person=>(!person.client?"general":!person.project?"client":"project")===level.value);
                return <section className="developer-scope-group" key={level.value}><h5>{level.label} · {people.length}</h5>
                  {people.map(person=><DeveloperRow key={JSON.stringify([person.id,person.name,person.client,person.project])}
                    person={person} busy={busy} action={action} context={context} levels={levels}/>)}
                </section>;
              })}
            </div>
            {!own.length && (
              <p className="muted">Нет доступных разработчиков.</p>
            )}
          </section>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <small className="muted">
          «Убрать» скрывает имя из новых назначений. Существующие поручения сохраняются. Смена уровня сохраняет ID и назначения. Имя и удаление общих разработчиков действуют во всех проектах их уровня.
        </small>
      </section>
      <details
        className="developer-directory-panel developer-grouping-panel"
        onToggle={(e) => setShowSettings(e.currentTarget.open)}
      >
        <summary>
          <Settings2 size={17} /> Группировка поручений ·{" "}
          {context.project || "выберите проект"}
        </summary>
        <div className="developer-grouping-body">
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
        </div>
      </details>
    </div>
  );
}
function DeveloperRow({ person, busy, action, context, levels }: any) {
  const [name, setName] = useState(person.name);
  const [scope,setScope]=useState(!person.client?"general":!person.project?"client":"project");
  const initialScope=!person.client?"general":!person.project?"client":"project";
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
      <SingleSelect label={`Уровень разработчика ${person.name}`} value={scope} options={levels} disabled={busy} onChange={setScope}/>
      <div className="developer-row-actions">

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
      <button type="button" className="icon-button developer-save-name" title="Сохранить имя и уровень" disabled={busy || !name.trim() || (name.trim() === person.name && scope === initialScope)}
        aria-label={`Сохранить имя ${person.name}`}
        onClick={() => void action(() => api(`/local-developers/${person.id}`, "PUT", { name: name.trim(), context: scope==="general"?{client:"",project:""}:scope==="client"?{client:context.client,project:""}:context }))}><Save size={16} aria-hidden="true" /></button>
      </div>
    </div>
  );
}
