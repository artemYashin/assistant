import { useEffect, useRef, useState } from "react";
import { Code2, FileCode2, LoaderCircle, X } from "lucide-react";
import { api } from "./api.js";
import { splitDiff, diffFileLabel, type DiffLine } from "./pr-diff.js";

type Loaded = {
  files: ReturnType<typeof splitDiff>;
  notes: string[];
  base: string;
  head: string;
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
  const file = data?.files[selected];
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

function DiffFileName({ path }: { path: string }) {
  const { directory, name } = diffFileLabel(path);
  return (
    <>
      <span className="pr-diff-directory">{directory || "Корень"}</span>
      <span className="pr-diff-filename">{name}</span>
    </>
  );
}
