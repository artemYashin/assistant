import { useEffect, useRef, useState } from "react";
import { Code2, FileCode2, LoaderCircle, MessageSquarePlus, Send, X } from "lucide-react";
import { api } from "./api.js";
import { splitDiff, diffFileLabel, type DiffLine } from "./pr-diff.js";
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
    includedFiles: { path: string; characters: number }[];
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
}: {
  pr: any;
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
      `/pr/${commit ? "commit-diff" : "diff"}?${new URLSearchParams({ monitor: pr.monitor, repo: pr.repo, number: String(pr.number), ...(commit ? { commit } : {}) })}`,
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
  }, [pr.monitor, pr.repo, pr.number, commit, revision]);
  useEffect(() => {
    let live = true;
    if (!data || commit) { setThreads([]); return; }
    setCommentsLoading(true);
    setCommentsError("");
    api(`/pr/line-comments?${new URLSearchParams({
      monitor: pr.monitor, repo: pr.repo, number: String(pr.number), head: data.head, base: data.base,
    })}`).then((result) => { if (live) setThreads(result); })
      .catch((e) => { if (live) setCommentsError(e.message); })
      .finally(() => { if (live) setCommentsLoading(false); });
    return () => { live = false; };
  }, [data, commit, pr.monitor, pr.repo, pr.number, commentsVersion]);
  const file = data?.files[selected];
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
  const unplacedThreads = threads.filter((thread) => !data?.files.some((f) =>
    f.hunks.some((h) => h.rows.some((r) =>
      thread.line
        ? f.after === thread.path && r.right?.number === thread.line
        : f.before === thread.path && !!thread.leftLine && r.left?.number === thread.leftLine,
    )),
  ));
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
          <p>{data?.title || pr.title}</p>
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
          {!commit && <div className="pr-diff-comments-status">
            <span role="status">{commentsLoading ? "Загружаю комментарии…" : `Обсуждения: ${threads.length}`}</span>
            <button className="text-button" disabled={commentsLoading}
              onClick={() => setCommentsVersion((v) => v + 1)}>Обновить комментарии</button>
            {commentsError && <p className="error" role="alert">Комментарии не обновлены: {commentsError}</p>}
          </div>}
          {!!unplacedThreads.length && <details className="pr-diff-accounting">
            <summary>Комментарии вне показанных строк · {unplacedThreads.length}</summary>
            <CommentThreads threads={unplacedThreads} showPath />
          </details>}
          <p className="pr-diff-meta">
            {commit ? "Родитель" : "Merge base"}{" "}
            <code>{data.base.slice(0, 12)}</code> →{" "}
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
          {data.limits && (
            <p className="muted">
              Diff: {data.limits.usedCharacters.toLocaleString("ru-RU")} /{" "}
              {data.limits.totalCharacters.toLocaleString("ru-RU")} символов ·
              на файл до {data.limits.perFileCharacters.toLocaleString("ru-RU")}{" "}
              · остаток общего бюджета:{" "}
              {(
                data.limits.totalCharacters - data.limits.usedCharacters
              ).toLocaleString("ru-RU")}{" "}
              · исключено файлов: {data.limits.ignoredFiles} (расход 0).
            </p>
          )}
          {data.diagnostics && (
            <details className="pr-diff-accounting">
              <summary>
                <FileCode2 size={16} />
                Исключения и расход бюджета
              </summary>
              <p>
                {data.diagnostics.client} / {data.diagnostics.project} ·{" "}
                {data.diagnostics.repository}
              </p>
              <p className="muted">
                Бюджет расходуют только включённые diff, вместе с заголовками и
                строками контекста. Пропущенные файлы его не расходуют. Лимит
                одного файла проверяется отдельно.
              </p>
              <h3>Применённые правила</h3>
              {data.diagnostics.rules.length ? (
                <ul>
                  {data.diagnostics.rules.map((rule) => (
                    <li key={rule}>
                      <code>{rule}</code>
                      {data.diagnostics!.unmatchedRules.includes(rule) &&
                        " — нет совпадений в загруженном списке изменений"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Для этого проекта исключения не заданы.</p>
              )}
              <h3>Исключённые файлы · {data.limits?.ignoredFiles}</h3>
              <ul>
                {data.diagnostics.excludedPaths.map((path, i) => (
                  <li key={i}>
                    <code>{path}</code> — 0 символов
                  </li>
                ))}
              </ul>
              {(data.limits?.ignoredFiles || 0) >
                data.diagnostics.excludedPaths.length && (
                <p>Показаны первые 100 исключённых путей.</p>
              )}
              <h3>Включено в бюджет</h3>
              <ul>
                {data.diagnostics.includedFiles.map((file, i) => (
                  <li key={i}>
                    <code>{file.path}</code> —{" "}
                    {file.characters.toLocaleString("ru-RU")} символов
                  </li>
                ))}
              </ul>
            </details>
          )}
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
              <nav className="pr-diff-files" aria-label="Файлы изменений">
                {data.files.map((f, i) => (
                  <button
                    key={i}
                    aria-pressed={i === selected}
                    title={f.after === "/dev/null" ? f.before : f.after}
                    onClick={() => setSelected(i)}
                  >
                    <FileCode2 size={16} />
                    <span>
                      <DiffFileName
                        path={
                          f.after === "/dev/null"
                            ? f.before
                            : f.after || f.before
                        }
                      />
                      <span className="pr-diff-counts">
                        <span className="pr-diff-added">+{f.added}</span>
                        <span className="pr-diff-removed">−{f.removed}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </nav>
              {file && (
                <section
                  className="pr-diff-code"
                  key={selected}
                  aria-label={`Изменения ${file.after}`}
                >
                  <h3>
                    {file.before !== file.after
                      ? `${file.before} → ${file.after}`
                      : file.after}
                  </h3>
                  <div className="pr-diff-language">
                    <SingleSelect label="Подсветка кода" value={language}
                      options={[
                        { value: "auto", label: `Авто · ${diffLanguages.find((l) => l.value === diffLanguage(file.after === "/dev/null" ? file.before : file.after))?.label || "обычный текст"}` },
                        { value: "plaintext", label: "Без подсветки" }, ...diffLanguages,
                      ]}
                      onChange={(value) => {
                        setLanguage(value);
                        try { localStorage.setItem(diffLanguageStorageKey, value); } catch { /* Storage may be disabled. */ }
                      }} />
                  </div>
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
                                    tokens={r.left && tokens?.left[r.left.number]}
                                    threads={threads.filter((t) => !t.line && !!r.left && t.path === file.before && t.leftLine === r.left.number)}
                                    kind={
                                      r.kind === "change"
                                        ? "removed"
                                        : "context"
                                    }
                                  />
                                  <DiffCell
                                    line={r.right}
                                    tokens={r.right && tokens?.right[r.right.number]}
                                    threads={threads.filter((t) => !!r.right && t.path === file.after && t.line === r.right.number)}
                                    onComment={!commit && data.canComment ? async (content) => {
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
  threads = [],
  tokens,
}: {
  line?: DiffLine;
  kind: "context" | "added" | "removed";
  onComment?: (content: string) => Promise<void>;
  threads?: CommentThread[];
  tokens?: CodeToken[];
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <td className={line ? `diff-${kind}` : "diff-empty"}>
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
      <CommentThreads threads={threads} />
      {sent && <p className="pr-diff-comment-sent" role="status">Комментарий отправлен в Azure.</p>}
      {editing && onComment && (
        <form className="pr-diff-comment-form" onSubmit={async (event) => {
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

function CommentThreads({ threads, showPath = false }: { threads: CommentThread[]; showPath?: boolean }) {
  const statuses: Record<string, string> = {
    active: "Открыто", fixed: "Решено", closed: "Закрыто", wontFix: "Без изменений",
    byDesign: "По замыслу", pending: "Ожидает", unknown: "",
    "1": "Открыто", "2": "Решено", "3": "Без изменений", "4": "Закрыто", "5": "По замыслу", "6": "Ожидает",
  };
  return <>{threads.map((thread) => <div className="pr-diff-thread" key={thread.id}>
    <div className="pr-diff-thread-heading">
      <strong>Обсуждение #{thread.id}</strong>
      <span>{statuses[String(thread.status)] || ""}</span>
    </div>
    {showPath && <div className="muted">{thread.path || "Общий комментарий к PR"}{(thread.line || thread.leftLine) ? ` · строка ${thread.line || thread.leftLine}` : ""}</div>}
    {thread.comments.map((comment) => <article key={comment.id}>
      <header><strong>{comment.author}</strong>{comment.createdAt && <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString("ru-RU")}</time>}</header>
      <p>{comment.content}</p>
    </article>)}
  </div>)}</>;
}

function DiffFileName({ path }: { path: string }) {
  const { directory, name } = diffFileLabel(path);
  return (
    <>
      <span className="pr-diff-directory">{directory || "Корень"}</span>
      <span className="pr-diff-filename">{name}</span>
    </>
  );
}
