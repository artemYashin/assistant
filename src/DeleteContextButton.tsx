import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2, TriangleAlert, X } from "lucide-react";

type Context = { client: string; project: string };
export function DeleteContextButton({ context, disabled, onDelete, iconOnly = false }: { iconOnly?: boolean; context: Context; disabled: boolean; onDelete: (context: Context, confirmation: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inputId = useId();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kind = context.project ? "проект" : "заказчика";
  const title = context.project ? `${context.client} / ${context.project}` : context.client;
  return <>
    <button type="button" className={`${iconOnly ? "icon-button" : "secondary"} context-delete-button`} aria-label={`Удалить ${kind}: ${title}`} title={`Удалить ${kind}`} disabled={disabled || busy} onClick={() => { setConfirmation(""); setError(""); dialog.current?.showModal(); }}><Trash2 size={14} />{!iconOnly && "Удалить"}</button>
    {createPortal(<dialog ref={dialog} className="developer-dialog context-delete-dialog" aria-label={`Удалить ${kind}`} onCancel={event => { event.stopPropagation(); if (busy) event.preventDefault(); }}>
      <div className="developer-dialog-heading"><h2><TriangleAlert size={20} />Удалить {kind}?</h2><button type="button" className="icon-button" aria-label="Закрыть" disabled={busy} onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      <strong className="context-delete-name">{title}</strong>
      <div className="context-delete-warning"><strong>Внимание: удаление необратимо.</strong>
        <p>{context.project ? "Все данные этого проекта" : "Заказчик, все его проекты и их данные"} в Orbit будут удалены: память и предложения, чаты, PR и история ревью, отчёты расхода LLM, настройки, разработчики и их локальные назначения.</p>
      </div>
      <p className="muted">Общая память приложения, данные других заказчиков и проектов, общие тикеты и Git-кэш подключения сохранятся. В Azure ничего не удаляется.</p>
      <form onSubmit={async event => {
        event.preventDefault();
        if (busy || confirmation !== "удалить") return;
        setBusy(true); setError("");
        try { await onDelete(context, confirmation); dialog.current?.close(); }
        catch (error: any) { setError(error.message || "Не удалось удалить"); }
        finally { setBusy(false); }
      }}>
        <label htmlFor={inputId}>Для подтверждения введите <b>удалить</b></label>
        <input id={inputId} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialog-actions"><button type="button" className="secondary" autoFocus disabled={busy} onClick={() => dialog.current?.close()}>Отмена</button><button type="submit" className="secondary context-delete-confirm" disabled={busy || confirmation !== "удалить"}><Trash2 size={16} aria-hidden="true" />{busy ? "Удаляю…" : `Удалить ${kind} навсегда`}</button></div>
      </form>
    </dialog>, document.body)}
  </>;
}
