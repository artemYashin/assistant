import { useEffect, useId, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { api } from "./api.js";
import {
  developerGroup,
  type DeveloperGroup,
  type DeveloperStatusGroups,
} from "./developer-status.js";

const categories: [DeveloperGroup, string][] = [
  ["active", "Активные"],
  ["review", "На проверке"],
  ["done", "Завершённые"],
];
export function DeveloperStatusSettings({
  context,
  source,
  groups,
  showDeleted,
  states,
  onSaved,
}: {
  context: { client: string; project: string };
  source: string;
  groups: DeveloperStatusGroups;
  showDeleted: boolean;
  states: string[];
  onSaved: (groups: DeveloperStatusGroups, showDeleted: boolean) => void;
}) {
  const prefix = useId();
  const [draft, setDraft] = useState(groups);
  const [includeDeleted, setIncludeDeleted] = useState(showDeleted);
  const [loaded, setLoaded] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const options = [
    ...new Map(
      (loaded ?? states)
        .filter(Boolean)
        .map((state) => [state.trim().toLocaleLowerCase(), state.trim()]),
    ).values(),
  ].sort((a, b) => a.localeCompare(b, "ru"));
  async function load() {
    setBusy(true);
    setError("");
    try {
      const result = await api("/tickets/options");
      setLoaded(result.flatMap((type: { states: string[] }) => type.states));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await api("/developer-board/status-groups", "PUT", {
        context,
        source,
        statusGroups: Object.fromEntries(
          Object.entries(draft).filter(([state]) =>
            options.some(
              (option) =>
                option.toLocaleLowerCase() === state.toLocaleLowerCase(),
            ),
          ),
        ),
        showDeleted: includeDeleted,
      });
      onSaved(result.statusGroups, result.showDeleted);
      window.dispatchEvent(new Event("orbit:developer-board"));
      setSaved(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="developer-status-settings">
      <p className="muted">
        Для всех типов задач в этом проекте. Меняется только группировка на
        странице разработчиков — статусы в Azure остаются прежними.
      </p>
      <label className="developer-deleted-toggle">
        <input
          type="checkbox"
          checked={includeDeleted}
          disabled={busy}
          onChange={(e) => {
            setIncludeDeleted(e.target.checked);
            setSaved(false);
          }}
        />
        <span>
          Показывать тикеты из корзины
          <small>В завершённых поручениях и счётчиках разработчиков.</small>
        </span>
      </label>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => void load()}
      >
        <RefreshCw size={15} /> Загрузить все статусы из Azure
      </button>
      {!options.length && (
        <p className="muted">
          Список статусов ещё не загружен. Загрузите типы и статусы в настройках
          Azure или кнопкой выше. Все задачи пока считаются активными.
        </p>
      )}
      <input
        aria-label="Поиск статуса"
        placeholder="Найти статус…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="developer-status-table">
        <table>
          <thead>
            <tr>
              <th>Статус Azure</th>
              {categories.map(([key, label]) => (
                <th key={key}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {options
              .filter((state) =>
                state
                  .toLocaleLowerCase()
                  .includes(query.trim().toLocaleLowerCase()),
              )
              .map((state, index) => (
                <tr key={state}>
                  <th scope="row">{state}</th>
                  {categories.map(([key, label]) => (
                    <td key={key}>
                      <label title={`${state}: ${label}`}>
                        <input
                          type="radio"
                          name={`${prefix}-${index}`}
                          aria-label={`${state}: ${label}`}
                          disabled={busy}
                          checked={developerGroup(state, draft) === key}
                          onChange={() => {
                            setDraft((old) => ({
                              ...Object.fromEntries(
                                Object.entries(old).filter(
                                  ([name]) =>
                                    name.toLocaleLowerCase() !==
                                    state.toLocaleLowerCase(),
                                ),
                              ),
                              [state]: key,
                            }));
                            setSaved(false);
                          }}
                        />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <small className="muted">
        Не настроенные статусы считаются активными. Тикеты из корзины остаются в
        завершённых до удаления через 30 дней.
      </small>
      <button
        type="button"
        className="primary"
        disabled={busy}
        onClick={() => void save()}
      >
        <Save size={15} /> {busy ? "Подождите…" : "Сохранить группировку"}
      </button>
      {saved && <p role="status">Настройки сохранены</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ProjectDeveloperStatusSettings({
  context,
}: {
  context: { client: string; project: string };
}) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    setData(null);
    api(`/developer-board?${new URLSearchParams(context)}`)
      .then((result) => {
        if (live) setData(result);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [context.client, context.project, revision]);
  if (error)
    return (
      <div>
        <p className="error" role="alert">
          {error}
        </p>
        <button
          type="button"
          className="secondary"
          onClick={() => setRevision((v) => v + 1)}
        >
          Повторить
        </button>
      </div>
    );
  if (!data) return <p role="status">Загрузка настроек…</p>;
  return (
    <DeveloperStatusSettings
      context={context}
      source={data.source}
      groups={data.statusGroups}
      showDeleted={data.showDeleted}
      states={data.availableStates}
      onSaved={(statusGroups, showDeleted) =>
        setData({ ...data, statusGroups, showDeleted })
      }
    />
  );
}
