import { DiffFileTree } from "./DiffFileTree.js";
import { useEffect, useRef, useState } from "react";
import { Code2, FileCode2, LoaderCircle, MessageSquarePlus, Send, CornerUpLeft, X } from "lucide-react";
import { InitialsAvatar } from "./InitialsAvatar.js";
import { api } from "./api.js";
import { splitDiff, type DiffLine } from "./pr-diff.js";
import { SingleSelect } from "./SingleSelect.js";
import { diffLanguage, diffLanguages, diffLanguageStorageKey, validDiffLanguage } from "./diff-languages.js";
import type { CodeToken, HighlightedFile } from "./diff-highlight.js";

type Loaded = {
  files: ReturnType<typeof splitDiff>;
  notes: string[];
  base: string;
  head: string;
  target: string;
  canComment?: boolean;
  title: string;
  limits?: {
    totalCharacters: number;
    perFileCharacters: number;
    usedCharacters: number;
    ignoredFiles: number;
  };
  diagnostics?: {
    client: string;
    project: string;
    repository: string;
    rules: string[];
    unmatchedRules: string[];
    excludedPaths: string[];
    includedFiles: { path: string; characters: number; sizeBytes?: number }[];
  };
  sourceBranch?: string;
  targetBranch?: string;
};
type CommentThread = {
  id: number; status: string | number; path: string;
  line: number | null; leftLine: number | null;
  comments: { id: number; author: string; content: string; createdAt: string }[];
};
export function PrDiffDialog({
  pr,
  onClose,
  commit,
  repositoryContext,
}: {
  pr?: any;
  repositoryContext?: { client: string; project: string };
  commit?: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [language, setLanguage] = useState(() => {
    try { return validDiffLanguage(localStorage.getItem(diffLanguageStorageKey)); }
    catch { return "auto"; }
  });
  const [highlighted, setHighlighted] = useState<{
    file: Loaded["files"][number]; language: string; value: HighlightedFile;
  } | null>(null);
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [commentsError, setCommentsError] = useState("");
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsVersion, setCommentsVersion] = useState(0);
  const [lineTarget, setLineTarget] = useState<{
    file: number; side: "left" | "right"; line: number;
  } | null>(null);
  const [data, setData] = useState<Loaded | null>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(0),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    setSelected(0);
    api(
      repositoryContext ? `/repository/commit-diff?${new URLSearchParams({ ...repositoryContext, commit: commit! })}` : `/pr/${commit ? "commit-diff" : "diff"}?${new URLSearchParams({ monitor: pr.monitor, repo: pr.repo, number: String(pr.number), ...(commit ? { commit } : {}) })}`,
    )
      .then((result) => {
        const parsed = { ...result, files: splitDiff(result.patches) };
        if (live) setData(parsed);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [pr?.monitor, pr?.repo, pr?.number, commit, revision, repositoryContext?.client, repositoryContext?.project]);
  useEffect(() => {
    let live = true;
    if (!data || commit || repositoryContext) { setThreads([]); return; }
    setCommentsLoading(true);
    setCommentsError("");
    api(`/pr/line-comments?${new URLSearchParams({
      monitor: pr.monitor, repo: pr.repo, number: String(pr.number), head: data.head, base: data.base,
    })}`).then((result) => { if (live) setThreads(result); })
      .catch((e) => { if (live) setCommentsError(e.message); })
      .finally(() => { if (live) setCommentsLoading(false); });
    return () => { live = false; };
  }, [data, commit, pr?.monitor, pr?.repo, pr?.number, commentsVersion, repositoryContext]);
  const file = data?.files[selected];
  useEffect(() => {
    if (!lineTarget || selected !== lineTarget.file) return;
    const frame = requestAnimationFrame(() => {
      const cell = dialog.current?.querySelector<HTMLElement>(
        `[data-diff-side="${lineTarget.side}"][data-diff-line="${lineTarget.line}"]`,
      );
      cell?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      cell?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [lineTarget, selected]);
  const commentLocation = (thread: CommentThread) => {
    const side = thread.line ? "right" : "left";
    const line = thread.line || thread.leftLine;
    if (!line) return null;
    const index = data?.files.findIndex((f) =>
      (side === "right" ? f.after : f.before) === thread.path &&
      f.hunks.some((h) => h.rows.some((r) => r[side]?.number === line)),
    ) ?? -1;
    return index < 0 ? null : { file: index, side, line } as const;
  };
  const effectiveLanguage = language === "auto"
    ? diffLanguage(file?.after === "/dev/null" ? file.before : file?.after || "") : language;
  useEffect(() => {
    setHighlighted(null);
    if (!file || effectiveLanguage === "plaintext") return;
    let worker: Worker;
    try {
      worker = new Worker(new URL("./diff-highlight.worker.ts", import.meta.url), { type: "module" });
    } catch { return; }
    const timer = setTimeout(() => worker.terminate(), 4000);
    worker.onmessage = (event: MessageEvent<HighlightedFile>) => {
      setHighlighted({ file, language: effectiveLanguage, value: event.data });
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); };
    worker.postMessage({ file, language: effectiveLanguage });
    return () => { clearTimeout(timer); worker.terminate(); };
  }, [file, effectiveLanguage]);
  const tokens = highlighted?.file === file && highlighted?.language === effectiveLanguage
    ? highlighted.value : undefined;
  return (
    <dialog
      ref={dialog}
      className="pr-diff-dialog"
      aria-labelledby="pr-diff-title"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <header className="pr-diff-heading">
        <div>
          <h2 id="pr-diff-title">
            <Code2 size={20} /> Diff ·{" "}
            {commit ? `коммит ${commit.slice(0, 12)}` : `PR #${pr.number}`}
          </h2>
          <p>{data?.title || pr?.title}</p>
        </div>
        <button
          className="icon-button"
          aria-label="Закрыть diff"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {!data && !error && (
        <p role="status">
          <LoaderCircle className="spin" size={17} /> Загружаю изменения из
          Azure…
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
      {data && (
        <>
          <p className="pr-diff-meta">
            {commit ? "Родитель" : "Merge base"}{" "}
            <code>{data.base ? data.base.slice(0, 12) : "пустое дерево"}</code> →{" "}
            {commit ? "Коммит" : "PR head"}{" "}
            <code>{data.head.slice(0, 12)}</code>
            {!commit && (
              <>
                {" "}
                · {data.sourceBranch?.replace(/^refs\/heads\//, "")} →{" "}
                {data.targetBranch?.replace(/^refs\/heads\//, "")}
              </>
            )}
          </p>
          {!!data.notes.length && (
            <div className="pr-diff-notes" role="note">
              <strong>Покрытие diff и причины пропусков</strong>
              <ul>
                {data.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          )}
          {!data.files.length && (
            <p>
              {data.notes.length
                ? "Нет доступных текстовых изменений. Причины указаны выше."
                : "Текстовых изменений между этими коммитами нет."}
            </p>
          )}
          {!!data.files.length && (
            <div className="pr-diff-layout">
              <div className="pr-diff-toolbar-language">
                <div className="pr-diff-language">
                  <SingleSelect label="Подсветка кода" value={language}
                    options={[
                      { value: "auto", label: `Авто · ${diffLanguages.find((l) => l.value === diffLanguage(file?.after === "/dev/null" ? file.before : file?.after || ""))?.label || "обычный текст"}` },
                      { value: "plaintext", label: "Без подсветки" }, ...diffLanguages,
                    ]}
                    onChange={(value) => {
                      setLanguage(value);
                      try { localStorage.setItem(diffLanguageStorageKey, value); } catch { /* Storage may be disabled. */ }
                    }} />
                </div>
              </div>
              <div className="pr-diff-toolbar-file">
                <FileCode2 size={18} aria-hidden="true" />
                <h3>{file && (file.before !== file.after
                  ? `${file.before} → ${file.after}` : file.after)}</h3>
              </div>
              <DiffFileTree files={data.files} selected={selected} sizes={data.diagnostics?.includedFiles}
                onSelect={index => { setSelected(index); setLineTarget(null); }} />
              {file && (
                <section
                  className="pr-diff-code"
                  key={selected}
                  aria-label={`Изменения ${file.after}`}
                >
                  {!file.hunks.length ? (
                    <p>Текст не изменился (например, файл переименован).</p>
                  ) : (
                    <div
                      className="pr-diff-scroll"
                      tabIndex={0}
                      role="region"
                      aria-label="Код до и после изменений"
                    >
                      <table className="pr-diff-table">
                        <thead>
                          <tr>
                            <th scope="col">До · удалённые строки −</th>
                            <th scope="col">После · добавленные строки +</th>
                          </tr>
                        </thead>
                        {file.hunks.map((h, i) => (
                          <tbody key={i}>
                            <tr className="pr-diff-hunk">
                              <td colSpan={2}>{h.label}</td>
                            </tr>
                            {h.rows.map((r, j) =>
                              r.kind === "notice" ? (
                                <tr key={j} className="pr-diff-hunk">
                                  <td colSpan={2}>{r.notice}</td>
                                </tr>
                              ) : (
                                <tr key={j}>
                                  <DiffCell
                                    line={r.left}
                                    side="left"
                                    threads={threads.filter((t) => !t.line && !!r.left && t.path === file.before && t.leftLine === r.left.number)}
                                    highlighted={lineTarget?.file === selected && lineTarget.side === "left" && lineTarget.line === r.left?.number}
                                    tokens={r.left && tokens?.left[r.left.number]}
                                    kind={
                                      r.kind === "change"
                                        ? "removed"
                                        : "context"
                                    }
                                  />
                                  <DiffCell
                                    line={r.right}
                                    side="right"
                                    threads={threads.filter((t) => !!r.right && t.path === file.after && t.line === r.right.number)}
                                    highlighted={lineTarget?.file === selected && lineTarget.side === "right" && lineTarget.line === r.right?.number}
                                    tokens={r.right && tokens?.right[r.right.number]}
                                    onComment={!repositoryContext && !commit && data.canComment ? async (content) => {
                                      await api("/pr/line-comment", "POST", {
                                        monitor: pr.monitor, repo: pr.repo, number: pr.number,
                                        head: data.head, base: data.base, target: data.target,
                                        path: file.after, line: r.right!.number, content,
                                      });
                                      setCommentsVersion((v) => v + 1);
                                    } : undefined}
                                    kind={
                                      r.kind === "change" ? "added" : "context"
                                    }
                                  />
                                </tr>
                              ),
                            )}
                          </tbody>
                        ))}
                      </table>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
          {!repositoryContext && !commit && <section className="pr-diff-discussions" aria-label="Комментарии к pull request">
            <div className="pr-diff-comments-status">
              <h3>Комментарии · {threads.length}</h3>
              <button className="text-button" disabled={commentsLoading}
                onClick={() => setCommentsVersion((v) => v + 1)}>Обновить</button>
              {commentsLoading && <span role="status">Загружаю…</span>}
            </div>
            {commentsError && <p className="error" role="alert">Комментарии не обновлены: {commentsError}</p>}
            {!commentsLoading && !commentsError && !threads.length && <p className="muted">Комментариев пока нет.</p>}
            <CommentThreads threads={threads} canLocate={(thread) => !!commentLocation(thread)}
              onLocate={(thread) => {
                const target = commentLocation(thread);
                if (target) { setSelected(target.file); setLineTarget(target); }
              }} />
          </section>}
          <p className="muted">
            Показаны изменённые участки с контекстом. Просмотр не запускает LLM
            и не меняет код.
          </p>
        </>
      )}
    </dialog>
  );
}
function DiffCell({
  line,
  kind,
  onComment,
  tokens,
  side,
  highlighted = false,
  threads = [],
}: {
  line?: DiffLine;
  kind: "context" | "added" | "removed";
  onComment?: (content: string) => Promise<void>;
  side: "left" | "right";
  highlighted?: boolean;
  tokens?: CodeToken[];
  threads?: CommentThread[];
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <td className={`${line ? `diff-${kind}` : "diff-empty"}${highlighted ? " pr-diff-comment-target" : ""}`}
      data-diff-side={side} data-diff-line={line?.number} tabIndex={highlighted ? -1 : undefined}>
      {line && (
        <div className="pr-diff-line">
          <span className="pr-diff-number">
            {line.number}
            {onComment && (
              <button type="button" className="pr-diff-comment-trigger"
                aria-label={`Комментарий к строке ${line.number}`}
                title="Добавить комментарий в Azure"
                aria-expanded={editing}
                onClick={() => setEditing(true)}>
                <MessageSquarePlus size={14} />
              </button>
            )}
          </span>
          <span aria-hidden="true">
            {kind === "added" ? "+" : kind === "removed" ? "−" : " "}
          </span>
          <code>{tokens?.length ? tokens.map((token, index) =>
            <span className={token.className || undefined} key={index}>{token.text}</span>,
          ) : line.text || " "}</code>
        </div>
      )}
      {!!threads.length && <div className="pr-diff-inline-threads">
        <CommentThreads threads={threads} inline />
      </div>}
      {sent && <p className="pr-diff-comment-sent" role="status">Комментарий отправлен в Azure.</p>}
      {editing && onComment && (
        <form className={`pr-diff-comment-form${!threads.length && !sent ? " pr-diff-line-pointer" : ""}`} onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current || !content.trim()) return;
          pending.current = true;
          setBusy(true);
          setError("");
          try {
            await onComment(content);
            setContent("");
            setSent(true);
            setEditing(false);
          } catch (e: any) {
            setError(e.message);
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}>
          <label>
            Комментарий к строке {line?.number}
            <textarea autoFocus rows={3} maxLength={20000} value={content}
              disabled={busy} onChange={(event) => setContent(event.target.value)} />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <div>
            <button type="submit" className="primary pr-diff-comment-submit"
              disabled={busy || !content.trim()} aria-busy={busy}>
              {busy
                ? <LoaderCircle size={15} className="spin" aria-hidden="true" />
                : <Send size={15} aria-hidden="true" />}
              {busy ? "Отправляю…" : "Отправить в Azure"}
            </button>
            <button type="button" className="secondary" disabled={busy}
              onClick={() => setEditing(false)}>Отмена</button>
          </div>
        </form>
      )}
    </td>
  );
}

function CommentThreads({ threads, canLocate, onLocate, inline = false }: {
  threads: CommentThread[];
  canLocate?: (thread: CommentThread) => boolean;
  onLocate?: (thread: CommentThread) => void;
  inline?: boolean;
}) {
  const statuses: Record<string, string> = {
    active: "Открыто", fixed: "Решено", closed: "Закрыто", wontFix: "Без изменений",
    byDesign: "По замыслу", pending: "Ожидает", unknown: "",
    "1": "Открыто", "2": "Решено", "3": "Без изменений", "4": "Закрыто", "5": "По замыслу", "6": "Ожидает",
  };
  return <>{threads.map((thread, index) => <details
    className={`pr-diff-thread pr-diff-thread-accordion${inline && index === 0 ? " pr-diff-line-pointer" : ""}`}
    open={inline || undefined} key={thread.id}>
    <summary className="pr-diff-thread-heading">
      <InitialsAvatar name={thread.comments[0]?.author || "Azure"} />
      <span className="pr-diff-thread-title">
        <span className="pr-diff-thread-author">{thread.comments[0]?.author || "Azure"}</span>
        <span className="pr-diff-thread-location">
          <FileCode2 size={13} aria-hidden="true" />
          <span title={thread.path}>{inline ? `Строка ${thread.line || thread.leftLine}` : thread.path || "Общий комментарий к PR"}</span>
          {!inline && (thread.line || thread.leftLine) && <span className="pr-diff-thread-line">:{thread.line || thread.leftLine}</span>}
        </span>
      </span>
      <span className="pr-diff-thread-status">{statuses[String(thread.status)] || ""}</span>
    </summary>
    {!inline && (canLocate?.(thread) ? <button type="button" className="secondary pr-diff-locate-comment"
      onClick={() => onLocate?.(thread)}><CornerUpLeft size={14} aria-hidden="true" />Показать строку {thread.line || thread.leftLine}<span>{thread.line ? "После" : "До"}</span></button>
      : thread.path && <p className="muted">Эта строка не входит в показанный diff.</p>)}
    {thread.comments.map((comment) => <article key={comment.id}>
      <header><InitialsAvatar name={comment.author} /><strong>{comment.author}</strong>{comment.createdAt && <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString("ru-RU")}</time>}</header>
      <p>{comment.content}</p>
    </article>)}
  </details>)}</>;
}
