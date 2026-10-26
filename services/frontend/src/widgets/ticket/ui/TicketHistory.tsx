import { InitialsAvatar } from "../../../shared/ui/initials-avatar/index.js";
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
  "System.AssignedTo": "Исполнитель",
  "System.State": "Статус",
  "System.Description": "Описание",
  "Microsoft.VSTS.Common.AcceptanceCriteria": "Критерии приёмки",
  "System.Tags": "Теги",
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
  const visibleItems = items
    .map((item) => ({
      ...item,
      changes: Object.entries(labels).flatMap(([field, label]) =>
        Object.hasOwn(item.fields, field) ? [{ field, label, ...item.fields[field] }] : [],
      ),
    }))
    .filter((item) => item.changes.length > 0);
  return (
    <div className="ticket-history">
      <p className="muted">
        История Azure, от новых изменений к старым. Локальные изменения Orbit сюда не входят.
      </p>
      {visibleItems.map((item) => (
        <details className="ticket-history-entry" key={item.id}>
          <summary>
            <span className="ticket-history-author">
              <InitialsAvatar name={item.author} />
              <strong>{item.author}</strong>
            </span>
            <time>
              {item.date && Number.isFinite(Date.parse(item.date))
                ? new Date(item.date).toLocaleString("ru-RU")
                : "Дата не указана"}
            </time>
            <span className="ticket-count">#{item.revision || item.id}</span>
          </summary>
          <div className="ticket-history-changes">
            {item.changes.map((change) => (
              <section key={change.field} className="ticket-history-field">
                <h4>{change.label}</h4>
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
              </section>
            ))}
          </div>
        </details>
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
      {!busy && !error && !visibleItems.length && (
        <p>
          {nextSkip !== null
            ? "В загруженной части истории нет изменений основных полей. Нажмите «Загрузить ещё», чтобы проверить следующие записи."
            : "Изменения основных полей отсутствуют."}
        </p>
      )}
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
