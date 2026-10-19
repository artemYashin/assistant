import { useState } from "react";
import { api } from "./api.js";
export function TicketImportSettings({
  form,
  set,
  save,
}: {
  form: any;
  set: (key: string, value: any) => void;
  save: () => Promise<void>;
}) {
  const [options, setOptions] = useState<any[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const types = [
    ...new Set<string>([...options.map((o) => o.name), ...form.azureTypes]),
  ];
  const states = [
    ...new Set<string>([
      ...options
        .filter((o) => form.azureTypes.includes(o.name))
        .flatMap((o) => o.states),
      ...form.azureStates,
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
    <div style={{ marginTop: 20 }}>
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
            await save();
            setOptions(await api("/tickets/options"));
          } catch (e: any) {
            setError(e.message);
          } finally {
            setLoading(false);
          }
        }}
      >
        {loading
          ? "Загрузка…"
          : "Сохранить подключение и загрузить типы / статусы"}
      </button>
      {error && <p className="error">{error}</p>}
      <div className="form-grid">
        <fieldset>
          <legend>Типы задач</legend>
          {types.map((t) => (
            <label style={{ display: "block" }} key={t}>
              <input
                type="checkbox"
                checked={form.azureTypes.includes(t)}
                onChange={(e) => toggle("azureTypes", t, e.target.checked)}
              />
              {t}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Статусы выбранных типов</legend>
          {states.map((s) => (
            <label style={{ display: "block" }} key={s}>
              <input
                type="checkbox"
                checked={form.azureStates.includes(s)}
                onChange={(e) => toggle("azureStates", s, e.target.checked)}
              />
              {s}
            </label>
          ))}
        </fieldset>
      </div>
      <label>
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
