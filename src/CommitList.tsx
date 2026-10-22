import { GitCommitHorizontal } from "lucide-react";
export type CommitListEntry = { id: string; message: string; author: string; date: string; truncated?: boolean };
export function CommitList({ commits, onSelect }: { commits: CommitListEntry[]; onSelect: (id: string) => void }) {
  return <div className="repository-commits-list">{commits.map(commit => <button type="button" className="repository-commit-row" key={commit.id} onClick={() => onSelect(commit.id)}>
    <GitCommitHorizontal size={17} /><span><strong>{commit.message || commit.id}</strong><small><code title={commit.id}>{commit.id.slice(0, 10)}</code><span>{commit.author || "Автор не указан"}</span>{commit.date && Number.isFinite(Date.parse(commit.date)) && <time dateTime={commit.date}>{new Date(commit.date).toLocaleString("ru-RU")}</time>}</small>{commit.truncated && <small>Azure вернул сокращённое сообщение коммита.</small>}</span>
  </button>)}</div>;
}
