import { StatusBadge } from "./TicketControls.js";
import { RefreshCw, ListFilter, Tags } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "./api.js";
export function TicketImportSettings({
  form,
  set,
}: {
  form: any;
  set: (key: string, value: any) => void;
}) {
  const [options, setOptions] = useState<any[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setOptions([]);
    api("/tickets/options", "GET", undefined, controller.signal).then(setOptions)
      .catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [form.client, form.project, form.azureUrl, form.azureProject]);
  const types = [
    ...new Set<string>([
      ...options.map((o) => o.name),
      ...form.azureTypes,
      ...Object.keys(form.typeColors || {}),
    ]),
  ];
  const states = [
    ...new Set<string>([
      ...options
        .filter((o) => form.azureTypes.includes(o.name))
        .flatMap((o) => o.states),
      ...form.azureStates,
      ...Object.keys(form.statusColors || {}),
    ]),
  ];
  const toggle = (key: string, value: string, checked: boolean) =>
    set(
      key,
      checked
        ? [...form[key], value]
        : form[key].filter((x: string) => x !== value),
    );
  return (
    <div className="stack import-settings">
      <h3>Автоматически импортировать мои задачи</h3>
      <p className="muted">
        Запрашивает Azure API каждые {form.syncSeconds / 60} минут: Assigned To
        = владелец PAT, выбранные типы и статусы. LLM для импорта не
        используется. Уже добавленные тикеты сохраняются и продолжают
        обновляться после выхода из фильтра.
      </p>
      <button
        type="button"
        className="secondary"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          setError("");
          try {
            setOptions(await api("/tickets/options?refresh=true"));
          } catch (e: any) {
            setError(e.message);
          } finally {
            setLoading(false);
          }
        }}
      >
        <RefreshCw size={15} className={loading ? "spin" : undefined} />{loading
          ? "Загрузка…"
          : "Реимпортировать статусы"}
      </button>
      <p className="muted">Полный каталог Azure кэшируется на 30 дней независимо от галочек. Реимпорт обновляет его по сохранённому подключению, не меняя фильтры и настройки.</p>
      {error && <p className="error">{error}</p>}
      <div className="form-grid">
        {[
          {
            key: "azureTypes",
            colors: "typeColors",
            title: "Типы задач",
            items: types,
            kind: "type" as const,
            fallback: "#555d87",
          },
          {
            key: "azureStates",
            colors: "statusColors",
            title: "Статусы выбранных типов",
            items: states,
            kind: "state" as const,
            fallback: "#466540",
          },
        ].map((group) => (
          <section className="import-catalog-group" key={group.key}>
            <h4>{group.kind === "type" ? <Tags size={16} /> : <ListFilter size={16} />}{group.title}</h4><div className="import-catalog-options">
            {!group.items.length && (
              <p className="muted">
                Загрузите типы / статусы из Azure.
                {group.kind === "state" ? " Затем выберите типы задач." : ""}
              </p>
            )}
            {group.items.map((name) => (
              <div className="import-color-row" key={name}>
                <label className="check-option">
                  <input
                    type="checkbox"
                    checked={form[group.key].includes(name)}
                    onChange={(e) => toggle(group.key, name, e.target.checked)}
                  />
                  <StatusBadge
                    state={name}
                    colors={form[group.colors]}
                    kind={group.kind}
                  />
                </label>
                <input
                  type="color"
                  aria-label={`Цвет ${group.kind === "type" ? "типа" : "статуса"} ${name}`}
                  value={form[group.colors]?.[name] || group.fallback}
                  onChange={(e) =>
                    set(group.colors, {
                      ...form[group.colors],
                      [name]: e.target.value,
                    })
                  }
                />
                {form[group.colors]?.[name] && (
                  <button
                    type="button"
                    className="text-button"
                    title="Вернуть стандартный цвет"
                    aria-label={`Сбросить цвет ${name}`}
                    onClick={() => {
                      const next = { ...form[group.colors] };
                      delete next[name];
                      set(group.colors, next);
                    }}
                  >
                    ↺
                  </button>
                )}
              </div>
            ))}
          </div></section>
        ))}
      </div>
      <p className="muted">
        Галочки задают фильтр импорта. Цвета меняют только оформление типов и
        статусов в Orbit, независимо от галочек.
      </p>
      <label className="check-option">
        <input
          type="checkbox"
          checked={form.azureAutoImport}
          disabled={
            !form.azureAutoImport &&
            (!form.azureTypes.length || !form.azureStates.length)
          }
          onChange={(e) => set("azureAutoImport", e.target.checked)}
        />{" "}
        Включить автоматический импорт
      </label>
      <p className="muted">
        После выбора фильтров нажмите «Сохранить настройки». Для Bug и Change
        Request выберите их реальные названия из вашего процесса Azure.
      </p>
    </div>
  );
}
