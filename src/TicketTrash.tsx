import { useEffect, useState } from "react";
import { ArchiveRestore, FileText, Trash2 } from "lucide-react";
import { api } from "./api.js";
import { StatusBadge } from "./TicketControls.js";
export function TicketTrash({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<any[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<number | null>(null),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    api("/tickets/trash")
      .then((rows) => {
        if (live) {
          setItems(rows);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setLoaded(true);
        }
      });
    return () => {
      live = false;
    };
  }, [version]);
  async function restore(t: any) {
    setBusy(t.id);
    setError("");
    try {
      await api(`/tickets/${t.id}/restore`, "POST", { source: t.source });
      setItems((old) => old.filter((i) => i.id !== t.id));
      onChange();
    } catch (e: any) {
      setError(e.message);
      setVersion((v) => v + 1);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Корзина тикетов</h1>
          <p>
            Снимки хранятся 30 дней после удаления. Восстановление возвращает
            тикет и локальные поручения в список.
          </p>
        </div>
      </div>
      <p className="muted">
        Данные ниже сохранены на момент удаления. Автоматическая синхронизация
        не возвращает удалённые тикеты. Azure не изменяется.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!loaded && <p role="status">Загрузка корзины…</p>}
      {loaded && !items.length && !error && (
        <div className="panel">
          <Trash2 size={22} />
          <h2>Корзина пуста</h2>
        </div>
      )}
      <div className="card-list">
        {items.map((t) => (
          <article className="panel" key={t.id}>
            <div className="section-heading">
              <h2>
                #{t.id} · {t.title}
              </h2>
              <button
                className="secondary"
                disabled={busy !== null}
                onClick={() => void restore(t)}
              >
                <ArchiveRestore size={17} />
                {busy === t.id ? "Восстанавливаю…" : "Восстановить"}
              </button>
            </div>
            <p>
              <span className="ticket-type-badge">{t.type || "Без типа"}</span>{" "}
              <StatusBadge state={t.state} />
            </p>
            <p>
              <strong>Исполнитель в Azure:</strong> {t.assigned || "N/A"}
            </p>
            <p>
              <strong>Локальное поручение:</strong>{" "}
              {t.developers?.map((d: any) => d.name).join(", ") ||
                t.developer_name ||
                "N/A"}
            </p>
            <p className="muted">
              Удалён {new Date(t.removedAt).toLocaleString("ru-RU")} · Хранится
              до {new Date(t.expiresAt).toLocaleString("ru-RU")}
            </p>
            <details>
              <summary>
                <FileText size={17} aria-hidden="true" />
                Данные сохранённого тикета
              </summary>
              <p>
                Последняя синхронизация:{" "}
                {new Date(t.synced_at).toLocaleString("ru-RU")}
              </p>
              <p>
                Последнее изменение:{" "}
                {t.changed_at
                  ? new Date(t.changed_at).toLocaleString("ru-RU")
                  : "—"}
              </p>
              {t.url?.startsWith("https://") && (
                <a href={t.url} target="_blank" rel="noreferrer">
                  Открыть в Azure DevOps
                </a>
              )}
            </details>
          </article>
        ))}
      </div>
    </>
  );
}
