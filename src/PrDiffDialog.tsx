import { useEffect, useRef, useState } from "react";
import { Code2, FileCode2, LoaderCircle, X } from "lucide-react";
import { api } from "./api.js";
import { splitDiff, type DiffLine } from "./pr-diff.js";

type Loaded = {
  files: ReturnType<typeof splitDiff>;
  notes: string[];
  base: string;
  head: string;
  title: string;
  sourceBranch?: string;
  targetBranch?: string;
};
export function PrDiffDialog({
  pr,
  onClose,
}: {
  pr: any;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
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
      `/pr/diff?${new URLSearchParams({ monitor: pr.monitor, repo: pr.repo, number: String(pr.number) })}`,
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
  }, [pr.monitor, pr.repo, pr.number, revision]);
  const file = data?.files[selected];
  return (
    <dialog
      ref={dialog}
      className="pr-diff-dialog"
      aria-labelledby="pr-diff-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="pr-diff-heading">
        <div>
          <h2 id="pr-diff-title">
            <Code2 size={20} /> Diff · PR #{pr.number}
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
          <p className="pr-diff-meta">
            Merge base <code>{data.base.slice(0, 12)}</code> → PR head{" "}
            <code>{data.head.slice(0, 12)}</code> ·{" "}
            {data.sourceBranch?.replace(/^refs\/heads\//, "")} →{" "}
            {data.targetBranch?.replace(/^refs\/heads\//, "")}
          </p>
          {!!data.notes.length && (
            <div className="pr-diff-notes" role="note">
              <strong>Показана не вся информация</strong>
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
                    title={f.after}
                    onClick={() => setSelected(i)}
                  >
                    <FileCode2 size={16} />
                    <span>
                      {f.after || f.before}
                      <small>
                        +{f.added} / −{f.removed}
                      </small>
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
                                    kind={
                                      r.kind === "change"
                                        ? "removed"
                                        : "context"
                                    }
                                  />
                                  <DiffCell
                                    line={r.right}
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
}: {
  line?: DiffLine;
  kind: "context" | "added" | "removed";
}) {
  return (
    <td className={line ? `diff-${kind}` : "diff-empty"}>
      {line && (
        <div className="pr-diff-line">
          <span className="pr-diff-number">{line.number}</span>
          <span aria-hidden="true">
            {kind === "added" ? "+" : kind === "removed" ? "−" : " "}
          </span>
          <code>{line.text || " "}</code>
        </div>
      )}
    </td>
  );
}
