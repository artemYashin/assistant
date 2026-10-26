import { BranchLabel } from "../../../entities/repository/index.js";
import { CommitList } from "../../../entities/repository/index.js";
import { useEffect, useRef, useState } from "react";
import { GitCommitHorizontal, LoaderCircle, RefreshCw, X } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { PrDiffDialog } from "../../../features/view-diff/index.js";

type Commit = { id: string; message: string; author: string; date: string };
export function RepositoryCommits({ context, branch, onClose }: {
  context: { client: string; project: string }; branch: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [head, setHead] = useState("");
  const [next, setNext] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>();
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError("");
    api(`/repository/commits?${new URLSearchParams({ ...context, branch, offset: String(offset), ...(offset && head ? { head } : {}) })}`, "GET", undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) {
        setCommits(previous => offset ? [...previous, ...result.commits.filter((c: Commit) => !previous.some(p => p.id === c.id))] : result.commits);
        setHead(result.head); setNext(result.nextOffset);
      } }).catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
    // Head anchors subsequent pages; only page/reload changes trigger a request.
  }, [context.client, context.project, branch, offset, version]);
  return <dialog ref={dialog} className="developer-dialog repository-commits-dialog" aria-label={`Коммиты ветки ${branch}`}
    onCancel={e => { e.preventDefault(); e.stopPropagation(); onClose(); }}>
    <div className="developer-dialog-heading"><h2><GitCommitHorizontal size={19} />Коммиты</h2><button type="button" className="icon-button" aria-label="Закрыть коммиты" onClick={onClose}><X size={18} /></button></div>
    <div className="repository-commits-heading"><BranchLabel kind="ветка" value={branch} client={context.client} project={context.project} onNavigate={onClose} /><button type="button" className="secondary" disabled={busy} onClick={() => { setOffset(0); setCommits([]); setHead(""); setNext(null); setVersion(v => v + 1); }}><RefreshCw size={14} />Обновить</button></div>
    <p className="muted">История из Azure · выберите коммит, чтобы посмотреть изменения. Локальная глубина Git не ограничивает этот список.</p>
    <CommitList commits={commits} onSelect={setSelected} />
    {busy && <p role="status"><LoaderCircle size={16} className="spin" />Загружаю коммиты…</p>}
    {error && <div role="alert"><p className="error">{error}</p><button className="secondary" onClick={() => setVersion(v => v + 1)}>Повторить</button></div>}
    {!busy && !error && !commits.length && <p>В этой ветке коммитов нет.</p>}
    {!busy && !error && next !== null && <button className="secondary" onClick={() => setOffset(next)}>Ещё 50 коммитов</button>}
    {selected && <PrDiffDialog onNavigate={onClose} repositoryContext={context} commit={selected} onClose={() => setSelected(undefined)} />}
  </dialog>;
}
