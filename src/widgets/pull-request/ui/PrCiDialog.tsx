import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Clock, FileText, LoaderCircle, RefreshCw, Workflow, X, XCircle } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
const labels: Record<string, string> = { approved: "Пройдена", rejected: "Не пройдена", broken: "Ошибка", queued: "В очереди", running: "Выполняется", pending: "Ожидает", inProgress: "Выполняется", completed: "Завершён", succeeded: "Успешно", succeededWithIssues: "С предупреждениями", failed: "Ошибка", canceled: "Отменён", skipped: "Пропущен", notApplicable: "Не применяется" };
function duration(row: any) {
  if (!row.startTime) return "";
  const ms = (row.finishTime ? Date.parse(row.finishTime) : Date.now()) - Date.parse(row.startTime);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const seconds = Math.floor(ms / 1000);
  return ` · ${Math.floor(seconds / 60)}м ${seconds % 60}с`;
}
function StateIcon({ state }: { state?: string }) {
  return ["succeeded", "approved"].includes(state || "") ? <CheckCircle2 size={15} className="ci-success" /> : ["failed", "rejected", "broken"].includes(state || "") ? <XCircle size={15} className="ci-failed" /> : ["running", "inProgress"].includes(state || "") ? <LoaderCircle size={15} className="spin" /> : <Circle size={15} />;
}
export function PrCiDialog({ pr, onClose, onUpdated }: { pr: any; onClose: () => void; onUpdated?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), logRequest = useRef<AbortController | null>(null);
  const [checks, setChecks] = useState<any[]>([]), [buildId, setBuildId] = useState<number | null>(null);
  const [timeline, setTimeline] = useState<any>(null), [selected, setSelected] = useState<any>(null), [log, setLog] = useState<any>(null);
  const [loading, setLoading] = useState(false), [stepsLoading, setStepsLoading] = useState(false), [logLoading, setLogLoading] = useState(false), [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const key = { monitor: pr.monitor, repo: pr.repo, number: pr.number };
  const updated = useRef(onUpdated); updated.current = onUpdated;
  useEffect(() => { dialog.current?.showModal(); return () => logRequest.current?.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    logRequest.current?.abort(); setLoading(true); setError(""); setChecks([]); setBuildId(null); setTimeline(null); setSelected(null); setLog(null); setLogLoading(false);
    api("/pr/ci", "POST", key, controller.signal).then(data => { if (!controller.signal.aborted) { setChecks(data.builds); setBuildId(data.builds.find((b: any) => b.buildId)?.buildId || null); updated.current?.(); } })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [pr.monitor, pr.repo, pr.number, version]);
  useEffect(() => {
    logRequest.current?.abort(); setSelected(null); setLog(null); setLogLoading(false); setTimeline(null);
    if (!buildId) { setStepsLoading(false); return; }
    const controller = new AbortController(); setStepsLoading(true); setError("");
    api("/pr/ci/timeline", "POST", { ...key, buildId }, controller.signal).then(data => { if (!controller.signal.aborted) setTimeline(data); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setStepsLoading(false); });
    return () => controller.abort();
  }, [buildId, version]);
  async function selectStep(step: any) {
    logRequest.current?.abort(); setSelected(step); setLog(null); setError(""); setLogLoading(false);
    if (!step.logId) return;
    const controller = new AbortController(); logRequest.current = controller; setLogLoading(true);
    try { const result = await api("/pr/ci/log", "POST", { ...key, buildId, logId: step.logId }, controller.signal); if (!controller.signal.aborted) setLog(result); }
    catch (e: any) { if (!controller.signal.aborted) setError(e.message); }
    finally { if (!controller.signal.aborted) setLogLoading(false); }
  }
  const records: any[] = timeline?.records || [];
  const ordered: any[] = [];
  const seen = new Set<string>();
  function visit(row: any, depth: number) { if (seen.has(row.id)) return; seen.add(row.id); ordered.push({ ...row, depth }); records.filter(r => r.parentId === row.id).sort((a,b) => (a.order || 0)-(b.order || 0)).forEach(r => visit(r, depth + 1)); }
  records.filter(r => !records.some(p => p.id === r.parentId)).sort((a,b) => (a.order || 0)-(b.order || 0)).forEach(r => visit(r, 0));
  records.forEach(r => visit(r, 0));
  return <dialog ref={dialog} className="developer-dialog pr-ci-dialog" aria-label={`CI · PR #${pr.number}`} onCancel={e => { e.preventDefault(); onClose(); }}>
    <div className="developer-dialog-heading"><h2><Workflow size={19} /> CI · PR #{pr.number}</h2><div className="pr-ci-toolbar"><button className="secondary" disabled={loading || stepsLoading || logLoading} onClick={() => setVersion(v => v + 1)}><RefreshCw size={14} />Обновить</button><button className="icon-button" aria-label="Закрыть" onClick={onClose}><X size={18} /></button></div></div>
    <p className="muted">Этапы и логи доступны с PAT Build: Read. Лог загружается только при выборе шага.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="pr-ci-layout"><aside className="pr-ci-steps">
      {loading && <p role="status"><LoaderCircle size={15} className="spin" /> Загружаю проверки…</p>}
      {!loading && !error && !checks.length && <p className="muted">Для этого PR нет проверок сборки.</p>}
      {checks.map((b, i) => <button key={i} className={`pr-ci-build${b.buildId === buildId ? " is-selected" : ""}`} disabled={!b.buildId} onClick={() => setBuildId(b.buildId)}><StateIcon state={b.state} /><span><strong>{b.name}</strong><small>{labels[b.state] || b.state}{!b.buildId ? " · запуск ещё не создан" : ` · #${b.buildId}`}</small></span></button>)}
      {stepsLoading && <p role="status">Загружаю шаги…</p>}
      {timeline && <><div className="pr-ci-build-info"><Clock size={13} />{labels[timeline.build.result || timeline.build.status] || timeline.build.status}{duration(timeline.build)}{timeline.build.startTime && ` · ${new Date(timeline.build.startTime).toLocaleString("ru-RU")}`}</div>
        {ordered.map(r => <button key={r.id} title={r.name} className={`pr-ci-step${selected?.id === r.id ? " is-selected" : ""}`} style={{ paddingLeft: 10 + Math.min(r.depth, 4) * 12 }} onClick={() => void selectStep(r)}><StateIcon state={r.result || r.state} /><span>{r.name}<small>{labels[r.result || r.state] || r.state}{duration(r)}</small></span>{r.logId && <FileText size={13} />}</button>)}
        {!records.length && <p className="muted">Шаги ещё не появились.</p>}</>}
    </aside><section className="pr-ci-log"><div className="pr-ci-log-heading"><FileText size={15} />{selected?.name || "Лог шага"}</div>
      {!selected && <div className="pr-ci-empty">Выберите шаг слева, чтобы посмотреть его лог.</div>}
      {selected?.issues?.map((issue: any, i: number) => <p className={issue.type === "error" ? "error" : "muted"} key={i}>{issue.message}</p>)}
      {logLoading && <p role="status">Загружаю лог…</p>}
      {selected && !selected.logId && <p className="muted">Для этого этапа отдельного лога нет. Выберите вложенную задачу.</p>}
      {log && <><pre>{log.text || "Лог пока пуст."}</pre>{log.truncated && <small>Показаны первые 256 КБ лога.</small>}</>}
    </section></div>
  </dialog>;
}
