import { useEffect, useState } from "react";
import { api } from "./api.js";
type Context = { client: string; project: string };
export function ContextPicker({
  context,
  onChange,
}: {
  context: Context;
  onChange: (c: Context) => void;
}) {
  const [items, setItems] = useState<Context[]>([]),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
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
    setSaved(false);
    try {
      const result = await api("/context", "PUT", next);
      onChange(result);
      setSaved(true);
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
    <section className="context-picker">
      <div className="context-bar">
        <label>
          Заказчик
          <select
            aria-label="Текущий заказчик"
            disabled={busy}
            value={context.client}
            onChange={(e) =>
              void choose({ client: e.target.value, project: "" })
            }
          >
            <option value="">Общий контекст</option>
            {clients.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Проект
          <select
            aria-label="Текущий проект"
            disabled={busy || !context.client}
            value={context.project}
            onChange={(e) =>
              void choose({ ...context, project: e.target.value })
            }
          >
            <option value="">Без проекта · память заказчика</option>
            {projects(context.client).map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          Заказчики и проекты
        </button>
        <small role="status">
          {busy
            ? "Сохраняю…"
            : saved
              ? "Контекст сохранён"
              : "Переключение сохраняется сразу"}
        </small>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <div className="panel context-manager">
          <h2>Заказчики и проекты</h2>
          <p className="muted">
            Контекст выбирает историю диалога и память ассистента. Общая память
            доступна всегда. Подключение и проект Azure DevOps задаются отдельно
            в настройках.
          </p>
          <div className="context-forms">
            <form
              onSubmit={(e) =>
                void add(e, { client: name.trim(), project: "" })
              }
            >
              <label>
                Новый заказчик
                <input
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Например, Acme"
                  required
                />
              </label>
              <button className="secondary" disabled={busy || !name.trim()}>
                Добавить и выбрать
              </button>
            </form>
            <form
              onSubmit={(e) =>
                void add(e, { client: owner, project: project.trim() })
              }
            >
              <label>
                Заказчик проекта
                <select
                  required
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                >
                  <option value="">Выберите заказчика</option>
                  {clients.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Новый проект
                <input
                  maxLength={200}
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  placeholder="Например, Портал"
                  required
                />
              </label>
              <button
                className="secondary"
                disabled={busy || !owner || !project.trim()}
              >
                Добавить и выбрать
              </button>
            </form>
          </div>
          {!clients.length ? (
            <p className="muted">Заказчиков пока нет. Добавьте первого выше.</p>
          ) : (
            <div className="context-list">
              {clients.map((c) => (
                <div key={c}>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void choose({ client: c, project: "" })}
                  >
                    {c}
                    {context.client === c && !context.project
                      ? " · выбран"
                      : ""}
                  </button>
                  {projects(c).map((p) => (
                    <button
                      className="text-button"
                      disabled={busy}
                      key={p}
                      onClick={() => void choose({ client: c, project: p })}
                    >
                      {p}
                      {context.client === c && context.project === p
                        ? " · выбран"
                        : ""}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
