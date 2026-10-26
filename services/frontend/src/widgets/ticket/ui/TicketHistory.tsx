import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { ticketText } from "../../../entities/ticket/index.js";

type Update = {
  id: number;
  revision: number;
  author: string;
  date: string;
  fields: Record<string, { oldValue?: unknown; newValue?: unknown }>;
  relations: Record<string, unknown>;
};
const labels: Record<string, string> = {
  "System.Title": "Название",
  "System.State": "Статус",
  "System.AssignedTo": "Исполнитель",
  "System.Description": "Описание",
  "System.WorkItemType": "Тип задачи",
  "System.Tags": "Теги",
  "System.ChangedDate": "Дата изменения",
  "System.ChangedBy": "Изменил",
  "System.CreatedDate": "Дата создания",
  "System.CreatedBy": "Создал",
  "Microsoft.VSTS.Common.Priority": "Azure приоритет",
  "Microsoft.VSTS.Common.AcceptanceCriteria": "Критерии приёмки",
  "Microsoft.VSTS.TCM.ReproSteps": "Шаги воспроизведения",
};
function valueText(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "object") {
    const identity = value as { displayName?: string; uniqueName?: string };
    return identity.displayName || identity.uniqueName || JSON.stringify(value, null, 2);
  }
  return ticketText(String(value), (_src, alt) => `[Изображение: ${alt}]`);
}
export function TicketHistory({ reference }: { reference: string }) {
  const [items, setItems] = useState<Update[]>([]);
  const [nextSkip, setNextSkip] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const pending = useRef(false);
  const load = useCallback(
    async (skip: number, request: number) => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      setError("");
      try {
        const result = await api(
          `/ticket-cards/${encodeURIComponent(reference)}/history?skip=${skip}`,
        );
        if (request !== generation.current) return;
        setItems((old) => [
          ...old,
          ...result.items.filter((item: Update) => !old.some((row) => row.id === item.id)),
        ]);
        setNextSkip(result.nextSkip);
      } catch (e: any) {
        if (request === generation.current) setError(e.message);
      } finally {
        if (request === generation.current) {
          pending.current = false;
          setBusy(false);
        }
      }
    },
    [reference],
  );
  useEffect(() => {
    const request = ++generation.current;
    setItems([]);
    setNextSkip(0);
    pending.current = false;
    void load(0, request);
    return () => {
      generation.current = request + 1;
    };
  }, [load]);
  return (
    <div className="ticket-history">
      <p className="muted">
        История Azure, от ранних изменений к новым. Локальные изменения Orbit сюда не входят.
      </p>
      {items.map((item) => (
        <article className="ticket-history-entry" key={item.id}>
          <header>
            <strong>{item.author}</strong>
            <time>
              {item.date && Number.isFinite(Date.parse(item.date))
                ? new Date(item.date).toLocaleString("ru-RU")
                : "Дата не указана"}
            </time>
            <span className="ticket-count">#{item.revision || item.id}</span>
          </header>
          {Object.entries(item.fields).map(([field, change]) => (
            <details
              key={field}
              className="ticket-history-field"
              open={
                ![
                  "System.Description",
                  "Microsoft.VSTS.Common.AcceptanceCriteria",
                  "Microsoft.VSTS.TCM.ReproSteps",
                ].includes(field) &&
                Math.max(valueText(change.oldValue).length, valueText(change.newValue).length) < 300
              }
            >
              <summary title={field}>{labels[field] || field}</summary>
              <div className="ticket-history-values">
                <div>
                  <b>Было</b>
                  <pre>{valueText(change.oldValue)}</pre>
                </div>
                <div>
                  <b>Стало</b>
                  <pre>{valueText(change.newValue)}</pre>
                </div>
              </div>
            </details>
          ))}
          {Object.keys(item.relations).length > 0 && (
            <details className="ticket-history-field">
              <summary>Изменения связей и вложений</summary>
              <pre>{JSON.stringify(item.relations, null, 2)}</pre>
            </details>
          )}
          {!Object.keys(item.fields).length && !Object.keys(item.relations).length && (
            <p>Azure не вернул изменённых полей для этой записи.</p>
          )}
        </article>
      ))}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {busy && (
        <p role="status">
          <LoaderCircle size={16} className="spin" /> Загружаю историю…
        </p>
      )}
      {!busy && !error && !items.length && <p>История изменений отсутствует.</p>}
      {nextSkip !== null && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void load(nextSkip, generation.current)}
        >
          {error ? "Повторить" : "Загрузить ещё"}
        </button>
      )}
    </div>
  );
}
