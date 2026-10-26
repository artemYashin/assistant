import { useRef, useState } from "react";
import { Download, FileText, X } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
import { memoryMarkdownFiles, type ExportMemory, type MemoryScope } from "../lib/memory-export.js";

export function ExportMemoryButton({ context }: { context: { client: string; project: string } }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<ExportMemory[]>([]);
  const [selected, setSelected] = useState<MemoryScope[]>([
    "general",
    "client",
    "project",
    "project_review",
  ]);
  const [separate, setSeparate] = useState(false),
    [includeContext, setIncludeContext] = useState(true);
  const [splitDetails, setSplitDetails] = useState(false);
  const [packing, setPacking] = useState(false),
    [downloadError, setDownloadError] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const files = memoryMarkdownFiles(
    rows,
    selected,
    separate,
    context,
    includeContext,
    splitDetails,
  );
  async function open() {
    dialog.current?.showModal();
    setBusy(true);
    setError("");
    setDownloadError("");
    setRows([]);
    try {
      setRows(await api(`/memories/export?${new URLSearchParams(context)}`));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function download(file: { name: string; text: string }) {
    saveBlob(file.name, new Blob([file.text], { type: "text/markdown;charset=utf-8" }));
  }
  function saveBlob(name: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function downloadArchive() {
    if (packing || !files.length) return;
    setPacking(true);
    setDownloadError("");
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const file of files) zip.file(file.name, file.text);
      saveBlob(
        "orbit-memory.zip",
        await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
      );
    } catch {
      setDownloadError("Не удалось создать архив. Попробуйте скачать ещё раз.");
    } finally {
      setPacking(false);
    }
  }
  return (
    <>
      <button className="secondary" type="button" onClick={() => void open()}>
        <Download size={16} />
        Экспорт памяти
      </button>
      <dialog
        className="developer-dialog memory-export-dialog"
        ref={dialog}
        aria-label="Экспорт памяти"
      >
        <div className="section-heading">
          <h2>
            <FileText size={20} />
            Экспорт памяти
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <p className="muted">
          Общая память и записи выбранного заказчика и проекта. Только сохранённые записи, без
          неподтверждённых предложений.
        </p>
        {busy ? (
          <p role="status">Загрузка записей…</p>
        ) : error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <>
            <fieldset>
              <legend>Разделы памяти</legend>
              {(["general", "client", "project", "project_review"] as MemoryScope[]).map(
                (scope) => {
                  const count = rows.filter((row) => row.scope === scope).length;
                  const label =
                    scope === "general"
                      ? "Общая память"
                      : scope === "client"
                        ? `Заказчик: ${context.client || "не выбран"}`
                        : `${scope === "project_review" ? "Ревью проекта" : "Проект"}: ${context.project || "не выбран"}`;
                  return (
                    <label className="check-option" key={scope}>
                      <input
                        type="checkbox"
                        checked={selected.includes(scope)}
                        disabled={!count}
                        onChange={(event) =>
                          setSelected((previous) =>
                            event.target.checked
                              ? [...previous, scope]
                              : previous.filter((item) => item !== scope),
                          )
                        }
                      />
                      <span>{label}</span>
                      <small>{count} записей</small>
                    </label>
                  );
                },
              )}
            </fieldset>
            <fieldset>
              <legend>Формат файлов</legend>
              <label className="check-option">
                <input
                  type="radio"
                  name="memory-export-format"
                  checked={!separate}
                  onChange={() => setSeparate(false)}
                />
                Один MD-файл со всеми выбранными разделами
              </label>
              <label className="check-option">
                <input
                  type="radio"
                  name="memory-export-format"
                  checked={separate}
                  onChange={() => setSeparate(true)}
                />
                Отдельный MD-файл для каждого раздела
              </label>
              <label className="check-option">
                <input
                  type="checkbox"
                  checked={includeContext}
                  onChange={(event) => setIncludeContext(event.target.checked)}
                />
                Добавить названия заказчика и проекта в заголовки разделов
              </label>
              <label className="check-option">
                <input
                  type="checkbox"
                  checked={splitDetails}
                  onChange={(event) => setSplitDetails(event.target.checked)}
                />
                Названия в оглавлении, описания в отдельных файлах (ZIP)
              </label>
            </fieldset>
            <section className="memory-export-downloads" aria-label="Файлы">
              <h3>
                <FileText size={15} />
                Файлы
              </h3>
              {files.length > 0 ? (
                <div className="memory-export-files">
                  {splitDetails ? (
                    <button
                      className="secondary"
                      type="button"
                      disabled={packing}
                      onClick={() => void downloadArchive()}
                    >
                      <Download size={15} />
                      {packing ? "Создаю архив…" : "Скачать orbit-memory.zip"}
                    </button>
                  ) : (
                    files.map((file) => (
                      <button
                        className="secondary"
                        type="button"
                        key={file.name}
                        onClick={() => download(file)}
                      >
                        <Download size={15} />
                        {file.name}
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <p className="muted">Выберите раздел с сохранёнными записями.</p>
              )}
              {splitDetails && files.length > 0 && (
                <small className="muted">
                  В архиве:{" "}
                  {files
                    .filter((file) => !file.name.startsWith("details/"))
                    .map((file) => file.name)
                    .join(", ")}{" "}
                  и папка details с описаниями (
                  {files.filter((file) => file.name.startsWith("details/")).length}). После
                  распаковки ссылки из оглавления ведут к нужным файлам.
                </small>
              )}
              {!splitDetails && separate && files.length > 0 && (
                <small className="muted">
                  Нажмите на имя файла, чтобы скачать его. Пустые разделы не экспортируются.
                </small>
              )}
              {downloadError && (
                <p className="error" role="alert">
                  {downloadError}
                </p>
              )}
            </section>
          </>
        )}
      </dialog>
    </>
  );
}
