import { Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "./api.js";
const scopes: Record<string, string> = {
  general: "Общая память",
  client: "Память заказчика",
  project: "Память проекта",
};
export function MemoryProposalList({
  items,
  onChange,
}: {
  items: any[];
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  async function decide(id: string, approve: boolean) {
    setBusy(id);
    setError("");
    try {
      await api(
        `/memory-proposals/${id}/${approve ? "approve" : "reject"}`,
        "POST",
        {},
      );
      onChange();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="memory-proposals">
      <h2>Предложения в память</h2>
      <p className="muted">
        Проверьте формулировку и область. До подтверждения эти записи не
        используются как память.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!items.length && <p className="muted">Новых предложений пока нет.</p>}
      <div className="card-list">
        {items.map((p) => (
          <article className="panel" key={p.id}>
            <div className="section-heading">
              <strong>{scopes[p.scope]}</strong>
              <span className="ticket-state-badge">
                {p.status === "pending"
                  ? "Ожидает подтверждения"
                  : p.status === "approved"
                    ? "Сохранено"
                    : "Отклонено"}
              </span>
            </div>
            {p.client && (
              <p className="muted">
                {p.client}
                {p.project ? ` / ${p.project}` : ""}
              </p>
            )}
            <p className="memory-proposal-body">{p.body}</p>
            <p className="muted">Зачем сохранить: {p.reason}</p>
            <div className="card-actions">
              {p.status === "pending" && (
                <>
                  <button
                    className="primary"
                    disabled={!!busy}
                    onClick={() => void decide(p.id, true)}
                  >
                    Подтвердить сохранение
                  </button>
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() => void decide(p.id, false)}
                  >
                    Отклонить
                  </button>
                </>
              )}
              <button
                className="secondary"
                disabled={!!busy}
                title="Убрать предложение из списка. Сохранённая память останется без изменений."
                onClick={async () => {
                  setBusy(p.id);
                  setError("");
                  try {
                    await api(`/memory-proposals/${p.id}`, "DELETE");
                    onChange();
                  } catch (e: any) {
                    setError(e.message);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <Trash2 size={15} /> Удалить предложение
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
