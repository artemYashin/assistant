import { RepositorySearch } from "./RepositorySearch.js";
import { RepositoryFileIcon, repositoryFileKind, repositoryFileSize } from "./RepositoryFileKind.js";
import { CodeProgress, useCodeProgress } from "./CodeProgress.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, X, ChevronDown, ChevronRight, Code2, Download, FileCode2, GitBranch, LoaderCircle, RefreshCw } from "lucide-react";
import { api } from "./api.js";
import { SingleSelect } from "./SingleSelect.js";
import { diffLanguage } from "./diff-languages.js";
import type { CodeToken } from "./diff-highlight.js";

type Context = { client: string; project: string };
type Entry = { name: string; path: string; type: string; size: number };
type Status = { sha: string; remoteSha: string; checkedAt: string; behind: number | null; current: boolean; repository: string; syncError?: string };
type File = { sha: string; path: string; text?: string; unavailable?: string; lfs?: boolean; symlink?: boolean; size?: number };
type Request = (operation: string, extra?: Record<string, unknown>) => Promise<any>;

export function CodeBrowserPage({ context }: { context: Context }) {
  if (!context.client || !context.project) return <section className="panel"><h1>Код репозитория</h1><p>Выберите заказчика и проект в хедере и настройте его Git-репозиторий.</p></section>;
  return <RepositoryView key={JSON.stringify(context)} context={context} />;
}
function RepositoryView({ context }: { context: Context }) {
  const { progress, execute } = useCodeProgress();
  const branchStorageKey = "repository-branch:" + JSON.stringify(context);
  const rememberedBranch = () => { try { return sessionStorage.getItem(branchStorageKey) || ""; } catch { return ""; } };
  const chooseBranch = (value: string) => {
    try { sessionStorage.setItem(branchStorageKey, value); } catch { /* Storage can be unavailable. */ }
    setBranch(value);
  };
  const [branches, setBranches] = useState<string[]>([]), [branch, setBranch] = useState("");
  const [status, setStatus] = useState<Status | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [branchNote, setBranchNote] = useState("");
  const [branchReload, setBranchReload] = useState(0);
  const [file, setFile] = useState<File | null>(null), [fileBusy, setFileBusy] = useState(false), [line, setLine] = useState<number | undefined>();
  const generation = useRef(0), fileRequest = useRef(0);
  const snapshot = useRef<Status | null>(null);
  snapshot.current = status;
  const request = useCallback<Request>((operation, extra = {}) => {
    const body = { ...context, branch, operation, ...(["tree", "file", "search"].includes(operation) && snapshot.current ? { revision: snapshot.current.sha } : {}), ...extra };
    return operation === "tree" ? api("/code-browser", "POST", body) : execute(body);
  }, [context.client, context.project, branch, execute]);
  useEffect(() => {
    let live = true;
    setBusy(true); setError(""); setFileBusy(false);
    void execute({ ...context, operation: "branches", refresh: branchReload > 0 }).then(data => {
      if (!live) return;
      setBranches(data.branches); setBranch(current => {
        const preferred = current || rememberedBranch();
        return data.branches.includes(preferred) ? preferred : data.defaultBranch;
      });
      setBranchNote(data.more ? "Показаны первые 5 000 веток." : !data.branches.length ? "В репозитории пока нет веток." : "");
      if (!data.branches.length || data.branches.includes(branch)) setBusy(false);
    }).catch(e => { if (live) { setError(e.message); setBusy(false); } });
    return () => { live = false; generation.current++; fileRequest.current++; };
  }, [context.client, context.project, branchReload, execute]);
  const refresh = useCallback(async (operation: "status" | "pull", force = false) => {
    const current = ++generation.current;
    fileRequest.current++; setFileBusy(false);
    setBusy(true); setError("");
    if (operation === "pull") { setFile(null); }
    try {
      if (force) {
        const catalog = await request("branches", { refresh: true });
        if (current === generation.current) setBranches(catalog.branches);
      }
      const next = await request(operation, { refresh: force });
      if (current === generation.current) {
        if (snapshot.current && snapshot.current.sha !== next.sha) { setFile(null); }
        setStatus(next);
      }
    } catch (e: any) { if (current === generation.current) setError(e.message); }
    finally { if (current === generation.current) setBusy(false); }
  }, [request]);
  useEffect(() => {
    setStatus(null); setFile(null);
    if (branch) void refresh("status");
  }, [branch, refresh]);
  async function openFile(path: string, line?: number) {
    const current = ++fileRequest.current, scope = generation.current;
    setFileBusy(true); setError(""); setLine(line); setFile(null);
    try {
      const next = await request("file", { path });
      if (scope === generation.current && current === fileRequest.current) setFile(next);
    } catch (e: any) { if (scope === generation.current && current === fileRequest.current) setError(e.message); }
    finally { if (scope === generation.current && current === fileRequest.current) setFileBusy(false); }
  }
  function closeFile() {
    fileRequest.current++;
    setFile(null); setFileBusy(false); setLine(undefined);
  }
  return <section className="repository-page">
    <header className="repository-heading"><h1><Code2 size={23} />Код репозитория</h1><span className="muted">{status?.repository || context.project} · только чтение</span></header>
    <div className="repository-toolbar">
      <span className="repository-branch-label" aria-hidden="true">Ветка</span>
      <div className="repository-branch"><GitBranch size={14} aria-hidden="true" /><SingleSelect label="Ветка" value={branch} options={branches.map(value => ({ value, label: value }))} onChange={chooseBranch} disabled={busy || !branches.length} /></div>
      <button className="secondary" title="Проверить обновления репозитория" disabled={busy} onClick={() => branch ? void refresh("status", true) : setBranchReload(n => n + 1)}><RefreshCw size={15} />Проверить</button>
      <button className="icon-button" title="Обновить список веток" aria-label="Обновить список веток" disabled={busy} onClick={() => setBranchReload(n => n + 1)}><GitBranch size={16} /></button>
      <button className="secondary repository-pull" disabled={busy || !branch} onClick={() => void refresh("pull")} title="Обновить только локальную копию для просмотра"><Download size={15} />Pull</button>
      {busy && <span className="repository-loading" role="status"><LoaderCircle size={15} className="spin" />Загружаю…</span>}
    </div>
    <CodeProgress progress={progress} />
    {branchNote && <p className="muted">{branchNote}</p>}
    {status && <div className="repository-freshness">
      <GitBranch size={14} /><code title={status.sha}>{status.sha.slice(0, 10)}</code>
      <span>{status.current ? "Совпадает с Azure на момент проверки" : status.behind !== null ? `Отстаёт на ${status.behind} коммитов` : "В Azure другая версия; расстояние неизвестно (история изменена или ограничена глубиной загрузки)"}</span>
      <time dateTime={status.checkedAt}>Проверено: {new Date(status.checkedAt).toLocaleString()}</time>
    </div>}
    {status?.syncError && <p className="repository-sync-warning" role="status">Фоновая проверка: {status.syncError}</p>}
    {error && <div role="alert" className="repository-error">
      <AlertCircle size={20} aria-hidden="true" /><div><strong>Не удалось выполнить операцию</strong><p>{error}</p></div>
      <button className="icon-button" aria-label="Закрыть ошибку" onClick={() => setError("")}><X size={16} /></button>
    </div>}
    <div className="repository-browser">
    <RepositorySearch key={branch + ":" + (status?.sha || "")} context={context} branch={branch} revision={status?.sha || ""}
      disabled={busy || !status} onOpen={(path, line) => void openFile(path, line)} />
    <div className={`repository-workspace${!file && !fileBusy ? " is-browsing" : ""}`} aria-busy={busy}>
      <nav className="repository-tree" aria-label="Файлы репозитория">
        {!file && !fileBusy && <div className="repository-tree-columns" aria-hidden="true"><span>Имя</span><span>Тип</span><span>Размер</span></div>}
        {status && !busy ? <Directory key={branch + status.sha} path="" request={request} selected={file?.path} onFile={path => void openFile(path)} /> : <p className="muted">{busy ? "Подготавливаю снимок…" : "Выберите доступную ветку."}</p>}
      </nav>
      {(file || fileBusy) && <div className={`repository-file${!file ? " is-empty" : ""}`}>
        {fileBusy ? <div className="repository-placeholder" role="status"><LoaderCircle size={24} className="spin" /><strong>Загрузка файла</strong><button className="secondary" onClick={closeFile}>Закрыть</button></div> : file ? <>
          <header><RepositoryFileIcon name={file.path} /><strong>{file.path}</strong><small>{file.size === undefined ? "" : repositoryFileSize(file.size)} · {file.sha.slice(0, 10)}</small>
            <button type="button" className="icon-button repository-close-file" onClick={closeFile} title="Закрыть файл" aria-label="Закрыть файл"><X size={16} /></button></header>
          {file.unavailable ? <p className="muted">{file.unavailable}</p> : <>
            {file.symlink && <p className="muted">Символическая ссылка. Ниже — её цель; переход по ссылке отключён.</p>}
            {file.lfs && <p className="muted">Git LFS pointer. Большой объект не загружается.</p>}
            <FileContent key={file.sha + file.path} file={file} targetLine={line} />
          </>}
        </> : <div className="repository-placeholder"><span className="repository-placeholder-icon"><Code2 size={24} aria-hidden="true" /></span><strong>Откройте файл</strong><p>Выберите его в дереве слева или найдите через поиск.</p></div>}
      </div>}
    </div>
    </div>
  </section>;
}
function Directory({ path, request, selected, onFile }: { path: string; request: Request; selected?: string; onFile: (path: string) => void }) {
  const [entries, setEntries] = useState<Entry[]>([]), [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [more, setMore] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const live = useRef(true);
  async function load(offset = 0) {
    setLoading(true); setError("");
    try {
      const data = await request("tree", { path, offset });
      if (live.current) { setEntries(previous => offset ? [...previous, ...data.entries] : data.entries); setMore(data.more); }
    } catch (e: any) { if (live.current) setError(e.message); }
    finally { if (live.current) setLoading(false); }
  }
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; }; }, [path, request]);
  return <ul className="repository-directory">
    {entries.map(entry => <li key={entry.path}>
      <button type="button" className={`repository-entry repository-entry-${repositoryFileKind(entry.name, entry.type).tone}${entry.path === selected ? " is-selected" : ""}`} title={entry.path} aria-expanded={entry.type === "directory" ? expanded.has(entry.path) : undefined}
        onClick={() => entry.type === "directory" ? setExpanded(current => { const next = new Set(current); next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path); return next; }) : onFile(entry.path)}>
        <span className="repository-disclosure" aria-hidden="true">{entry.type === "directory" && (expanded.has(entry.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}</span>
        <RepositoryFileIcon name={entry.name} type={entry.type} />
        <span className="repository-entry-name">{entry.name}</span>
        <span className="repository-entry-type">{repositoryFileKind(entry.name, entry.type).label}</span>
        <span className="repository-entry-size">{entry.type === "directory" || entry.type === "submodule" ? "—" : repositoryFileSize(entry.size)}</span>
      </button>
      {entry.type === "directory" && expanded.has(entry.path) && <Directory path={entry.path} request={request} selected={selected} onFile={onFile} />}
    </li>)}
    {loading && <li className="muted">Загрузка…</li>}
    {error && <li><span role="alert" className="error">{error}</span><button onClick={() => void load(entries.length)}>Повторить</button></li>}
    {more && !loading && <li><button className="text-button" onClick={() => void load(entries.length)}>Ещё файлы</button></li>}
    {!loading && !error && !entries.length && <li className="muted">Пустая папка</li>}
  </ul>;
}
function FileContent({ file, targetLine }: { file: File; targetLine?: number }) {
  const [tokens, setTokens] = useState<CodeToken[][]>([]);
  const [start, setStart] = useState(Math.floor(((targetLine || 1) - 1) / 500) * 500);
  const root = useRef<HTMLDivElement>(null);
  const lines = (file.text || "").split("\n");
  useEffect(() => {
    const language = diffLanguage(file.path);
    if (language === "plaintext" || (file.text?.length || 0) > 120000) return;
    const worker = new Worker(new URL("./repository-highlight.worker.ts", import.meta.url), { type: "module" });
    const timer = window.setTimeout(() => worker.terminate(), 4000);
    worker.onmessage = event => { setTokens(event.data); clearTimeout(timer); worker.terminate(); };
    worker.postMessage({ language, code: file.text || "" });
    return () => { clearTimeout(timer); worker.terminate(); };
  }, [file.path, file.text]);
  useEffect(() => { root.current?.querySelector('[data-target="true"]')?.scrollIntoView({ block: "nearest" }); }, [targetLine, start]);
  return <>
    <div className="repository-file-pages"><button className="text-button" disabled={!start} onClick={() => setStart(Math.max(0, start - 500))}>←</button>
      <span>Строки {start + 1}–{Math.min(start + 500, lines.length)} из {lines.length}</span>
      <button className="text-button" disabled={start + 500 >= lines.length} onClick={() => setStart(start + 500)}>→</button></div>
    <div className="repository-source" ref={root}><pre>{lines.slice(start, start + 500).map((text, i) => <div className="repository-source-line" key={i} data-target={start + i + 1 === targetLine}>
      <span className="repository-line-number">{start + i + 1}</span><code>{tokens[start + i]?.length ? tokens[start + i].map((token, j) => <span className={token.className} key={j}>{token.text}</span>) : text || " "}</code>
    </div>)}</pre></div>
  </>;
}
