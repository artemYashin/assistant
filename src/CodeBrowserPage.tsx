import { CodeWorkDialog } from "./CodeWorkDialog.js";
import { repositoryBranchKey } from "./repository-branch.js";
import { useSearchParams } from "react-router-dom";
import { chatCodeBranch } from "./chat-code-branch.js";
import { RepositorySearch } from "./RepositorySearch.js";
import { RepositoryFileIcon, repositoryFileKind, repositoryFileSize } from "./RepositoryFileKind.js";
import { CodeProgress, useCodeProgress } from "./CodeProgress.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bug, AlertCircle, X, ChevronDown, ChevronRight, Code2, Download, FileCode2, GitBranch, LoaderCircle, RefreshCw } from "lucide-react";
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
  const [params] = useSearchParams();
  const link = chatCodeBranch(`/code?${params}`);
  if (link && (link.client !== context.client || link.project !== context.project)) return <section className="panel"><h1>Код репозитория</h1><p>Выберите заказчика {link.client} и проект {link.project} в хедере, чтобы открыть ветку {link.branch}.</p></section>;
  if (!context.client || !context.project) return <section className="panel"><h1>Код репозитория</h1><p>Выберите заказчика и проект в хедере и настройте его Git-репозиторий.</p></section>;
  return <RepositoryView key={JSON.stringify([context, link?.href])} context={context} requestedBranch={link?.branch} reference={link || undefined} />;
}
function RepositoryView({ context, requestedBranch, reference }: { context: Context; requestedBranch?: string; reference?: NonNullable<ReturnType<typeof chatCodeBranch>> }) {
  const { progress, execute, stop } = useCodeProgress();
  const [debugWork, setDebugWork] = useState(false);
  const branchStorageKey = repositoryBranchKey(context);
  const rememberedBranch = () => { try { return sessionStorage.getItem(branchStorageKey) || ""; } catch { return ""; } };
  const [branches, setBranches] = useState<string[]>([]), [branch, setBranch] = useState("");
  useEffect(() => { if (branch) { try { sessionStorage.setItem(branchStorageKey, branch); } catch { /* Optional storage. */ } } }, [branch, branchStorageKey]);
  const [status, setStatus] = useState<Status | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [branchNote, setBranchNote] = useState("");
  const [branchReload, setBranchReload] = useState(0);
  const [file, setFile] = useState<File | null>(null), [fileBusy, setFileBusy] = useState(false), [line, setLine] = useState<number | undefined>();
  const generation = useRef(0), fileRequest = useRef(0);
  const [cancelling, setCancelling] = useState(false);
  const cancellingRef = useRef(false);
  async function cancelCurrent(nextBranch?: string) {
    if (cancellingRef.current) return;
    cancellingRef.current = true;
    setCancelling(true); setBusy(true); setError("");
    generation.current++; fileRequest.current++;
    stop();
    try {
      await api("/code-browser", "POST", { ...context, operation: "cancel", branch });
      if (nextBranch) {
        try { sessionStorage.setItem(branchStorageKey, nextBranch); } catch { /* Storage can be unavailable. */ }
        setBranch(nextBranch);
      }
    } catch (e: any) { setError(e.message); }
    finally { cancellingRef.current = false; setCancelling(false); setBusy(false); setFileBusy(false); }
  }
  const chooseBranch = (value: string) => { if (value !== branch) void cancelCurrent(value); };
  const workspace = useRef<HTMLDivElement>(null);
  const [treeWidth, setTreeWidth] = useState(() => {
    try { const value = Number(localStorage.getItem("repository-tree-width")); return value >= 160 && value <= 600 ? value : 280; }
    catch { return 280; }
  });
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    if (!resizing) return;
    const move = (event: PointerEvent) => {
      const rect = workspace.current?.getBoundingClientRect();
      if (rect) setTreeWidth(Math.round(Math.max(160, Math.min(600, rect.width - 240, event.clientX - rect.left))));
    };
    const end = () => setResizing(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end); window.removeEventListener("blur", end);
    };
  }, [resizing]);
  useEffect(() => { if (!resizing) { try { localStorage.setItem("repository-tree-width", String(treeWidth)); } catch { /* Optional preference. */ } } }, [treeWidth, resizing]);
  const snapshot = useRef<Status | null>(null);
  snapshot.current = status;
  const request = useCallback<Request>((operation, extra = {}) => {
    const body = { ...context, branch, operation, ...(["tree", "file", "search"].includes(operation) && snapshot.current ? { revision: snapshot.current.sha } : {}), ...extra };
    return ["tree", "file"].includes(operation) ? api("/code-browser", "POST", body) : execute(body);
  }, [context.client, context.project, branch, execute]);
  useEffect(() => {
    let live = true;
    const scope = generation.current;
    setBusy(true); setError(""); setFileBusy(false);
    void execute({ ...context, operation: "branches", refresh: branchReload > 0 }).then(data => {
      if (!live || scope !== generation.current) return;
      if (requestedBranch && !data.branches.includes(requestedBranch)) { setError("Ветка из ссылки отсутствует в локальном списке. Обновите список веток кнопкой проверки."); setBusy(false); return; }
      setBranches(data.branches); setBranch(current => {
        const preferred = current || requestedBranch || rememberedBranch();
        return data.branches.includes(preferred) ? preferred : data.defaultBranch;
      });
      setBranchNote(data.more ? "Показаны первые 5 000 веток." : !data.branches.length ? "В репозитории пока нет веток." : "");
      if (!data.branches.length || data.branches.includes(branch)) setBusy(false);
    }).catch(e => { if (live && scope === generation.current) { setError(e.message); setBusy(false); } });
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
        if (current !== generation.current) return;
        setBranches(catalog.branches);
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
  const openedReference = useRef(false);
  const [endLine, setEndLine] = useState<number>();
  useEffect(() => {
    if (!openedReference.current && reference?.path && status && !busy && branch === reference.branch) {
      openedReference.current = true;
      void openFile(reference.path, reference.startLine, reference.endLine);
    }
  }, [status, busy, branch, reference]);
  async function openFile(path: string, line?: number, lastLine?: number) {
    const current = ++fileRequest.current, scope = generation.current;
    setFileBusy(true); setError("");
    try {
      const next = await request("file", { path });
      if (scope === generation.current && current === fileRequest.current) { setFile(next); setLine(line); setEndLine(lastLine); }
    } catch (e: any) { if (scope === generation.current && current === fileRequest.current) setError(e.message); }
    finally { if (scope === generation.current && current === fileRequest.current) setFileBusy(false); }
  }
  function closeFile() {
    fileRequest.current++;
    setFile(null); setFileBusy(false); setLine(undefined);
  }
  return <section className="repository-page">
    <header className="repository-heading">
      <div className="repository-heading-title"><h1><Code2 size={23} />Код репозитория</h1><span className="muted">{status?.repository || context.project} · только чтение</span></div>
      <div className="repository-heading-status">
    {status && <div className="repository-freshness" title="Сравнение с Azure на момент последней проверки">
      <GitBranch size={14} /><code title={status.sha}>{status.sha.slice(0, 10)}</code>
      <span>{status.current ? "Совпадает с Azure" : status.behind !== null ? `Отстаёт на ${status.behind} коммитов` : "В Azure другая версия; расстояние неизвестно (история изменена или ограничена глубиной загрузки)"}</span>
      <time dateTime={status.checkedAt}>Проверено: {new Date(status.checkedAt).toLocaleString()}</time>
    </div>}
        <CodeProgress progress={progress} />
      </div>
    </header>
    <div className="repository-toolbar">
      <span className="repository-branch-label" aria-hidden="true">Ветка</span>
      <div className="repository-branch"><GitBranch size={14} aria-hidden="true" /><SingleSelect label="Ветка" value={branch} options={branches.map(value => ({ value, label: value }))} onChange={chooseBranch} disabled={cancelling || !branches.length} /></div>
      <button className="secondary" title="Проверить обновления репозитория" disabled={busy} onClick={() => branch ? void refresh("status", true) : setBranchReload(n => n + 1)}><RefreshCw size={15} />Проверить</button>
      <button className="secondary repository-pull" disabled={busy || !branch} onClick={() => void refresh("pull")} title="Обновить только локальную копию для просмотра"><Download size={15} />Pull</button>
      {(busy || (progress && !progress.ended)) && <button className="secondary" disabled={cancelling} onClick={() => void cancelCurrent()}><X size={15} />{cancelling ? "Отменяю…" : "Отменить"}</button>}
      {busy && <span className="repository-loading" role="status"><LoaderCircle size={15} className="spin" />Загружаю…</span>}
      <button type="button" className="secondary repository-debug-work" onClick={() => setDebugWork(true)}><Bug size={15} />Работа Git</button>
    </div>
    {debugWork && <CodeWorkDialog context={context} onClose={() => setDebugWork(false)} />}
    {branchNote && <p className="muted">{branchNote}</p>}

    {status?.syncError && <p className="repository-sync-warning" role="status">Фоновая проверка: {status.syncError}</p>}
    {error && <div role="alert" className="repository-error">
      <AlertCircle size={20} aria-hidden="true" /><div><strong>Не удалось выполнить операцию</strong><p>{error}</p></div>
      <button className="icon-button" aria-label="Закрыть ошибку" onClick={() => setError("")}><X size={16} /></button>
    </div>}
    <div className="repository-browser">
    <RepositorySearch key={branch + ":" + (status?.sha || "")} context={context} branch={branch} revision={status?.sha || ""}
      disabled={busy || !status} onOpen={(path, line) => void openFile(path, line)} />
    <div ref={workspace} className={`repository-workspace${!file && !fileBusy ? " is-browsing" : ""}${resizing ? " is-resizing" : ""}`} style={{ "--repository-tree-width": treeWidth + "px" } as import("react").CSSProperties} aria-busy={busy}>
      {(file || fileBusy) && <div className="repository-tree-resizer" role="separator" aria-label="Ширина списка файлов" aria-orientation="vertical" aria-valuemin={160} aria-valuemax={600} aria-valuenow={treeWidth} tabIndex={0}
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); setResizing(true); }}
        onKeyDown={event => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setTreeWidth(value => Math.max(160, Math.min(600, value + (event.key === "ArrowLeft" ? -10 : 10)))); }
          if (event.key === "Home") { event.preventDefault(); setTreeWidth(280); }
        }} onDoubleClick={() => setTreeWidth(280)} />}
      <nav className="repository-tree" aria-label="Файлы репозитория">
        {!file && !fileBusy && <div className="repository-tree-columns" aria-hidden="true"><span>Имя</span><span>Тип</span><span>Размер</span></div>}
        {status && !busy ? <Directory key={branch + status.sha} path="" request={request} selected={file?.path} onFile={path => void openFile(path)} /> : <p className="muted">{busy ? "Подготавливаю снимок…" : "Выберите доступную ветку."}</p>}
      </nav>
      {(file || fileBusy) && <div className={`repository-file${!file ? " is-empty" : ""}`}>
        {fileBusy && file && <span className="repository-file-loading" role="status"><LoaderCircle size={14} className="spin" />Загрузка…</span>}
        {fileBusy && !file ? <div className="repository-placeholder" role="status"><LoaderCircle size={24} className="spin" /><strong>Загрузка файла</strong><button className="secondary" onClick={closeFile}>Закрыть</button></div> : file ? <>
          <header><RepositoryFileIcon name={file.path} /><strong>{file.path}</strong><small>{file.size === undefined ? "" : repositoryFileSize(file.size)} · {file.sha.slice(0, 10)}</small>
            <button type="button" className="icon-button repository-close-file" onClick={closeFile} title="Закрыть файл" aria-label="Закрыть файл"><X size={16} /></button></header>
          {file.unavailable ? <p className="muted">{file.unavailable}</p> : <>
            {file.symlink && <p className="muted">Символическая ссылка. Ниже — её цель; переход по ссылке отключён.</p>}
            {file.lfs && <p className="muted">Git LFS pointer. Большой объект не загружается.</p>}
            <FileContent key={file.sha + file.path} file={file} targetLine={line} endLine={endLine} />
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
function FileContent({ file, targetLine, endLine }: { file: File; targetLine?: number; endLine?: number }) {
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
    <div className="repository-source" ref={root}><pre>{lines.slice(start, start + 500).map((text, i) => <div className="repository-source-line" key={i} data-target={targetLine !== undefined && start + i + 1 >= targetLine && start + i + 1 <= (endLine ?? targetLine)}>
      <span className="repository-line-number">{start + i + 1}</span><code>{tokens[start + i]?.length ? tokens[start + i].map((token, j) => <span className={token.className} key={j}>{token.text}</span>) : text || " "}</code>
    </div>)}</pre></div>
  </>;
}
