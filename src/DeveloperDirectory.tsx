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
        Одна строка — одно имя. Это локальный справочник, без привязки к Azure.
        Общие имена доступны всем проектам, имена заказчика — его проектам.
      </p>
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
          Добавить имена
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
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
      {!!inherited.length && (
        <details>
          <summary>
            Доступны из общей области и заказчика · {inherited.length}
          </summary>
          <p>{inherited.map((p) => p.name).join(", ")}</p>
        </details>
      )}
      <small className="muted">
        «Убрать» скрывает имя из новых назначений. Существующие поручения
        сохраняются.
      </small>
    </div>
  );
}
function DeveloperRow({ person, busy, action }: any) {
  const [name, setName] = useState(person.name);
  return (
    <div className="developer-directory-row">
      <input
        aria-label={`Имя разработчика ${person.name}`}
        maxLength={200}
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
      />
      <button
        className="secondary"
        disabled={busy || !name.trim() || name.trim() === person.name}
        onClick={() =>
          void action(() =>
            api(`/local-developers/${person.id}`, "PUT", { name: name.trim() }),
          )
        }
      >
        Сохранить
      </button>
      <button
        className="text-button"
        disabled={busy}
        onClick={() =>
          void action(() => api(`/local-developers/${person.id}`, "DELETE"))
        }
      >
        Убрать
      </button>
    </div>
  );
}
