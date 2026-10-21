import { useRef, useState } from "react";
import { Download, FileText, X } from "lucide-react";
import { api } from "./api.js";
import { memoryMarkdownFiles, type ExportMemory, type MemoryScope } from "./memory-export.js";

export function ExportMemoryButton({ context }: { context: { client: string; project: string } }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<ExportMemory[]>([]);
  const [selected, setSelected] = useState<MemoryScope[]>(["general", "client", "project"]);
  const [separate, setSeparate] = useState(false), [includeContext, setIncludeContext] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const files = memoryMarkdownFiles(rows, selected, separate, context, includeContext);
  async function open() {
    dialog.current?.showModal(); setBusy(true); setError(""); setRows([]);
    try { setRows(await api(`/memories/export?${new URLSearchParams(context)}`)); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  function download(file: { name: string; text: string }) {
    const url = URL.createObjectURL(new Blob([file.text], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.name;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return <>
    <button className="secondary" type="button" onClick={() => void open()}><Download size={16} />Экспорт в MD</button>
    <dialog className="developer-dialog memory-export-dialog" ref={dialog} aria-label="Экспорт памяти">
      <div className="section-heading"><h2><FileText size={20} />Экспорт памяти</h2><button type="button" className="icon-button" aria-label="Закрыть" onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      <p className="muted">Общая память и записи выбранного заказчика и проекта. Только сохранённые записи, без неподтверждённых предложений.</p>
      {busy ? <p role="status">Загрузка записей…</p> : error ? <p className="error" role="alert">{error}</p> : <>
        <fieldset><legend>Разделы памяти</legend>{(["general", "client", "project"] as MemoryScope[]).map(scope => {
          const count = rows.filter(row => row.scope === scope).length;
          const label = scope === "general" ? "Общая память" : scope === "client" ? `Заказчик: ${context.client || "не выбран"}` : `Проект: ${context.project || "не выбран"}`;
          return <label className="check-option" key={scope}><input type="checkbox" checked={selected.includes(scope)} disabled={!count} onChange={event => setSelected(previous => event.target.checked ? [...previous, scope] : previous.filter(item => item !== scope))} /><span>{label}</span><small>{count} записей</small></label>;
        })}</fieldset>
        <fieldset><legend>Формат файлов</legend>
          <label className="check-option"><input type="radio" name="memory-export-format" checked={!separate} onChange={() => setSeparate(false)} />Один MD-файл со всеми выбранными разделами</label>
          <label className="check-option"><input type="radio" name="memory-export-format" checked={separate} onChange={() => setSeparate(true)} />Отдельный MD-файл для каждого раздела</label>
          <label className="check-option"><input type="checkbox" checked={includeContext} onChange={event => setIncludeContext(event.target.checked)} />Добавить названия заказчика и проекта в заголовки разделов</label>
        </fieldset>
        <div className="memory-export-files">{files.map(file => <button className="secondary" type="button" key={file.name} onClick={() => download(file)}><Download size={15} />{file.name}</button>)}</div>
        {!files.length && <p className="muted">Выберите раздел с сохранёнными записями.</p>}
        {separate && files.length > 0 && <small className="muted">Нажмите на имя файла, чтобы скачать его. Пустые разделы не экспортируются.</small>}
      </>}
    </dialog>
  </>;
}
