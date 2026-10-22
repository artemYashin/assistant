import { BranchLabel } from "./PrBranchLabel.js";
import { CommitList } from "./CommitList.js";
import { PrDiffDialog } from "./PrDiffDialog.js";
import { useEffect, useRef, useState } from "react";
import { GitCommitHorizontal, LoaderCircle, X, RefreshCw } from "lucide-react";
import { api } from "./api.js";

type Commit = {
  id: string;
  url: string;
  message: string;
  truncated: boolean;
  author: string;
  date: string;
};
export function PrCommitsDialog({
  pr,
  onClose,
}: {
  pr: any;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [selectedCommit, setSelectedCommit] = useState("");
  const [commits, setCommits] = useState<Commit[]>([]);
  const [cursor, setCursor] = useState("");
  const [requested, setRequested] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    api(
      "/pr/commits?" +
        new URLSearchParams({
          monitor: pr.monitor,
          repo: pr.repo,
          number: String(pr.number),
          continuationToken: requested,
        }),
    )
      .then((result) => {
        if (!live) return;
        setCommits((old) => {
          const unique = new Map<string, Commit>(
            (requested ? old : []).map((c) => [c.id, c]),
          );
          for (const c of result.commits) unique.set(c.id, c);
          return [...unique.values()];
        });
        setCursor(result.continuationToken);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [pr.monitor, pr.repo, pr.number, requested, revision]);
  return (
    <dialog
      ref={ref}
      className="developer-dialog pr-commits-dialog"
      aria-labelledby="pr-commits-title"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedCommit) onClose();
      }}
    >
      <div className="developer-dialog-heading">
        <h2 id="pr-commits-title">
          <GitCommitHorizontal size={20} /> Коммиты · PR #{pr.number}
        </h2>
        <button
          className="icon-button"
          aria-label="Закрыть историю коммитов"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <p className="muted">{pr.title}</p>
      <div className="repository-commits-heading">
        <div className="commit-history-branches"><BranchLabel kind="source" value={pr.source_branch} client={pr.client} project={pr.project} onNavigate={onClose} /><BranchLabel kind="target" value={pr.target_branch} client={pr.client} project={pr.project} onNavigate={onClose} /></div>
        <button type="button" className="secondary" disabled={busy} onClick={() => { setRequested(""); setCursor(""); setCommits([]); setRevision(v => v + 1); }}><RefreshCw size={14} />Обновить</button>
      </div>
      <CommitList commits={commits} onSelect={setSelectedCommit} />
      {busy && (
        <p role="status">
          <LoaderCircle className="spin" size={17} /> Загружаю коммиты…
        </p>
      )}
      {error && (
        <div role="alert">
          <p className="error">{error}</p>
          <button
            className="secondary"
            onClick={() => setRevision((v) => v + 1)}
          >
            Повторить загрузку
          </button>
        </div>
      )}
      {!busy && !error && !commits.length && <p>В этом PR нет коммитов.</p>}
      {!busy && !error && cursor && (
        <button className="secondary" onClick={() => setRequested(cursor)}>
          Загрузить ещё
        </button>
      )}
      {selectedCommit && (
        <PrDiffDialog
          pr={pr}
          commit={selectedCommit}
          onClose={() => setSelectedCommit("")}
        />
      )}
    </dialog>
  );
}
