import { useEffect, useRef, useState } from "react";
import { Activity, RefreshCw, X, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { formatChatDuration } from "./ChatStream.js";
import { api } from "./api.js";

const statuses: Record<string, string> = { running: "Выполняется", completed: "Завершён", error: "Ошибка", limited: "Лимит", stopped: "Остановлен", interrupted: "Прерван" };
const pretty = (value: string | null) => { if (!value) return "—"; try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } };
const tokens = (value: number | null) => value == null ? "—" : value.toLocaleString();
export function ChatTools({ context, sessionId = "", review }: { context: { client: string; project: string }; sessionId?: string; review?: { monitor: string; repo: string; number: number } }) {
  const dialog = useRef<HTMLDialogElement>(null), generation = useRef(0);
  const [open, setOpen] = useState(false), [requests, setRequests] = useState<any[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const key = JSON.stringify([context, sessionId, review]);
  const endpoint = review ? "/pr/debug-tools" : "/conversation/tools";
  useEffect(() => {
    generation.current++; dialog.current?.close(); setOpen(false); setRequests([]); setSelected(""); setError(""); setBusy(false);
    return () => { generation.current++; };
  }, [key]);
  async function load() {
    if (!sessionId && !review) return;
    const token = ++generation.current; setBusy(true); setError("");
    try {
      const result = await api(`${endpoint}?${new URLSearchParams(review ? { ...context, monitor: review.monitor, repo: review.repo, number: String(review.number) } : { ...context, sessionId })}`);
      if (token === generation.current) setRequests(result.requests);
    } catch (e: any) { if (token === generation.current) setError(e.message); }
    finally { if (token === generation.current) setBusy(false); }
  }
  useEffect(() => {
    if (!review || !open || busy) return;
    const timer = setTimeout(() => void load(), 2000);
    return () => clearTimeout(timer);
  }, [open, busy, requests, key]);
  const rows = [...requests].reverse().flatMap(request => request.tools.map((tool: any) => ({ ...tool, request,
    status: tool.status === "running" && request.status !== "running" ? "interrupted" : tool.status })));
  const active = rows.find(tool => tool.id === selected) || rows.at(-1);
  return <>
    <button type="button" className={review ? "secondary pr-review-debug" : "icon-button"} title={review ? "Диагностика последнего ревью" : "Инструменты текущего чата"} aria-label={review ? "Диагностика последнего ревью" : "Инструменты текущего чата"} disabled={!review && !sessionId}
      onClick={() => { setOpen(true); dialog.current?.showModal(); void load(); }}><Activity size={17} />{review && "Лог ревью"}</button>
    <dialog ref={dialog} className="chat-tools-dialog" aria-label="История инструментов" onClose={() => { generation.current++; setOpen(false); setBusy(false); }}>
      {open && <>
        <header className="tool-viewer-heading"><div><h2>{review ? "Диагностика последнего ревью" : "Инструменты чата"}</h2><small>{rows.length} вызовов · {review ? "только последнее ревью в приложении · обновление каждые 2 с" : "последние 20 запросов"}</small>{review && <small className="review-debug-total">Токены: вход {tokens(requests.reduce((n, r) => n + (r.inputTokens || 0), 0))} · выход {tokens(requests.reduce((n, r) => n + (r.outputTokens || 0), 0))}. Расход включает повторную передачу контекста. Полных логов старых ревью нет.</small>}{review && requests[0] && <small>{statuses[requests[0].status] || requests[0].status}{requests[0].reason ? ` · ${requests[0].reason}` : ""}</small>}</div>
          <div className="tool-viewer-actions"><button type="button" className="icon-button" title="Обновить" aria-label="Обновить" disabled={busy} onClick={() => void load()}><RefreshCw size={16} className={busy ? "spin" : ""} /></button>
          <button type="button" className="icon-button" aria-label="Закрыть" onClick={() => dialog.current?.close()}><X size={18} /></button></div></header>
        {error && <p className="tool-viewer-error" role="alert">{error}</p>}
        <div className="tool-viewer-layout">
          <nav className="tool-viewer-list" aria-label="Вызовы инструментов">
            {!rows.length && <p>{busy ? "Загрузка…" : "Вызовов инструментов пока нет."}</p>}
            {rows.map((tool, index) => <button type="button" key={tool.id} aria-current={active?.id === tool.id ? "true" : undefined} onClick={() => setSelected(tool.id)}>
              <span className="tool-viewer-number">{index + 1}</span><span className="tool-viewer-item"><code title={tool.name}>{tool.name}</code>
                <small><time>{new Date(tool.started_at).toLocaleTimeString()}</time> · {tool.finished_at ? formatChatDuration(Date.parse(tool.finished_at) - Date.parse(tool.started_at)) : "…"}{tool.internal ? " · пакет" : ""}</small></span>
              <span title={statuses[tool.status] || tool.status} className={`tool-viewer-status is-${tool.status}`}>{tool.status === "completed" ? <CheckCircle2 size={14} /> : tool.status === "running" ? <Clock size={14} /> : <AlertCircle size={14} />}</span>
            </button>)}
          </nav>
          {active ? <ToolInspection key={`${key}:${active.id}`} tool={active} context={context} endpoint={endpoint} /> : <div className="tool-viewer-empty">Выберите вызов слева</div>}
        </div>
      </>}
    </dialog>
  </>;
}
function ToolInspection({ tool, context, endpoint }: { tool: any; context: { client: string; project: string }; endpoint: string }) {
  const [argumentsData, setArgumentsData] = useState<{ arguments: unknown; full: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    api(`${endpoint}/${encodeURIComponent(tool.id)}/arguments?${new URLSearchParams(context)}`)
      .then(data => { if (active) setArgumentsData(data); }).catch(() => {});
    return () => { active = false; };
  }, [tool.id]);
  const [full, setFull] = useState(true), [body, setBody] = useState<string | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!full || body !== null || !tool.hasFullResult) return;
    let active = true; setBusy(true); setError("");
    api(`${endpoint}/${encodeURIComponent(tool.id)}/result?${new URLSearchParams(context)}`)
      .then(data => { if (active) setBody(JSON.stringify(data.result, null, 2)); })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [full, tool.hasFullResult, tool.finished_at]);
  return <section className="tool-viewer-detail">
    <div className="tool-viewer-meta"><strong>{tool.name}</strong><span>{statuses[tool.status] || tool.status}</span>{tool.request.model && <small>Модель: {tool.request.model}</small>}{tool.request.reason && <small>{tool.request.reason}</small>}
      <small title="SDK не сообщает расход отдельно по инструменту. Это сумма за весь запрос модели, включая остальные инструменты.">Токены всего запроса: вход <b>{tokens(tool.request.inputTokens)}</b> · выход <b>{tokens(tool.request.outputTokens)}</b></small>
    </div>
    <div className="tool-viewer-columns">
      <section><header><h3>Параметры</h3><small>{argumentsData?.full ? "Вызов модели" : "Сводка"}</small></header><pre>{argumentsData ? JSON.stringify(argumentsData.arguments, null, 2) : pretty(tool.arguments)}</pre></section>
      <section><header><h3>Результат</h3><label><input type="checkbox" checked={full} disabled={!tool.hasFullResult} onChange={e => setFull(e.target.checked)} />Полный</label></header>
        {error && <p role="alert">{error}</p>}
        <pre>{full && tool.hasFullResult ? busy ? "Загрузка…" : body ?? (error ? "Результат недоступен" : "Загрузка…") : pretty(tool.result)}</pre>
        {!tool.hasFullResult && <small>Полный результат ещё не сохранён.</small>}
      </section>
    </div>
  </section>;
}
