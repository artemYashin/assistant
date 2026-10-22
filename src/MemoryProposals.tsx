import { ConfirmButton } from "./ConfirmButton.js";
import { MemoryBody, MemoryProposalContent } from "./MemoryBody.js";
import { Sparkles, Trash2, Pencil } from "lucide-react";
import { useState } from "react";
import { api } from "./api.js";
const scopes: Record<string, string> = {
  general: "Общая память",
  client: "Память заказчика",
  project: "Память проекта",
  project_review: "Ревью проекта",
};
export function MemoryProposalList({
  items,
  onChange,
  context,
}: {
  items: any[];
  onChange: () => void;
  context: { client: string; project: string };
}) {
  const [editing, setEditing] = useState<string | null>(null);
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
      throw e;
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
            <div className="section-heading memory-proposal-heading">
              <div className="memory-proposal-heading-text">
                <strong>{p.target_memory_id ? "Редактирование памяти" : "Добавление памяти"} · {scopes[p.scope]}</strong>
                {p.client && <span className="memory-proposal-context" title={[p.client, p.project].filter(Boolean).join(" / ")}>
                  · {p.client}{p.project ? ` / ${p.project}` : ""}
                </span>}
              </div>
              <span className="ticket-state-badge">
                {p.status === "pending"
                  ? "Ожидает подтверждения"
                  : p.status === "approved"
                    ? "Сохранено"
                    : "Отклонено"}
              </span>
            </div>
            <div className={p.target_memory_id ? "memory-change-comparison" : undefined}>
            {p.target_memory_id && <section><h3>Было</h3><MemoryProposalContent summary={p.original_summary} body={p.original_body} collapsible externalSummaryLabel /></section>}
            <section>{p.target_memory_id && <h3>Предлагаемое изменение</h3>}
            {p.status === "pending" ? <MemoryBody key={`${p.id}:${p.summary}:${p.body}`} id={p.id} body={p.body} summary={p.summary} proposal disabled={!!busy || (!!editing && editing !== p.id)} onSaved={() => { setEditing(null); onChange(); }} onEditingChange={value => setEditing(value ? p.id : null)} editing={editing === p.id} hideActions /> : <MemoryProposalContent summary={p.summary} body={p.body} collapsible externalSummaryLabel />}
            </section></div>
            <p className="muted">Зачем сохранить: {p.reason}</p>
            <div className="card-actions memory-proposal-actions">
              {p.status === "pending" && (
                <>
                  <ConfirmButton
                    title={p.target_memory_id ? "Подтвердить изменение памяти?" : "Сохранить предложение в память?"}
                    message={`«${p.summary}». ${p.target_memory_id ? "Текущая запись будет заменена предложенным вариантом." : "Запись станет доступна в выбранном разделе памяти."}`}
                    confirmLabel="Подтвердить"
                    className="primary"
                    disabled={!!busy || !!editing}
                    onConfirm={() => decide(p.id, true)}
                  >
                    {p.target_memory_id ? "Подтвердить изменение" : "Подтвердить сохранение"}
                  </ConfirmButton>
                  <button type="button" className="secondary" disabled={!!busy || !!editing} onClick={() => setEditing(p.id)}><Pencil size={15} />Редактировать</button>
                  <button type="button" className="secondary memory-refine-button" disabled={!!busy || !!editing || (p.scope !== "general" && p.client !== context.client) || (["project", "project_review"].includes(p.scope) && p.project !== context.project)} title="Прикрепить к следующему сообщению ассистенту. Выберите соответствующего заказчика и проект." onClick={() => window.dispatchEvent(new CustomEvent("orbit:refine-memory", { detail: { id: p.id, body: p.summary, client: p.client, project: p.project, scope: p.scope, target_memory_id: p.target_memory_id } }))}><Sparkles size={15} />Refine with AI</button>
                  <ConfirmButton title="Отклонить предложение?" message={`«${p.summary}». Сохранённая память останется без изменений.`} confirmLabel="Отклонить"
                    className="secondary"
                    disabled={!!busy || !!editing}
                    onConfirm={() => decide(p.id, false)}
                  >
                    Отклонить
                  </ConfirmButton>
                </>
              )}
              <ConfirmButton
                title="Удалить предложение?" message={`«${p.summary}». Предложение будет удалено из списка. Сохранённая память останется без изменений.`} confirmLabel="Удалить"
                className="secondary memory-proposal-delete"
                disabled={!!busy || !!editing}
                onConfirm={async () => {
                  setBusy(p.id);
                  setError("");
                  try {
                    await api(`/memory-proposals/${p.id}`, "DELETE");
                    onChange();
                  } catch (e: any) {
                    setError(e.message);
                    throw e;
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <Trash2 size={15} /> Удалить предложение
              </ConfirmButton>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
