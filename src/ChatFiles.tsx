import { useEffect, useRef, useState, type ReactNode, type DragEvent } from "react";
import { File as FileIcon, Plus, X, Upload, TriangleAlert } from "lucide-react";
import { api } from "./api.js";

export type PendingChatFile = {
  localId: string;
  file: File;
  preview?: string;
  uploadedId?: string;
  mime: string;
};
export const CHAT_FILE_ACCEPT =
  ".png,.jpg,.jpeg,.gif,.webp,.txt,.md,.markdown,.json,.csv";
export function useChatFiles(scope: string) {
  const drafts = useRef(new Map<string, PendingChatFile[]>());
  const urls = useRef(new Set<string>());
  const [, render] = useState(0);
  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    },
    [],
  );
  const files = drafts.current.get(scope) || [];
  const update = (value: PendingChatFile[]) => {
    drafts.current.set(scope, value);
    render((n) => n + 1);
  };
  return {
    files,
    add(selected: File[]) {
      const next = [...(drafts.current.get(scope) || [])];
      for (const file of selected) {
        if (
          !/\.(png|jpe?g|gif|webp|txt|md|markdown|json|csv)$/i.test(file.name)
        )
          throw new Error(
            `Формат файла «${file.name}» не поддерживается.`,
          );
        if (!file.size) throw new Error(`Файл «${file.name}» пустой.`);
        if (file.size > 10 * 1024 * 1024)
          throw new Error(`Файл «${file.name}» слишком большой. Максимальный размер одного файла — 10 МБ.`);
      }
      if (
        next.length + selected.length > 6 ||
        next.reduce((n, f) => n + f.file.size, 0) +
          selected.reduce((n, f) => n + f.size, 0) >
          30 * 1024 * 1024
      )
        throw new Error(
          "Можно прикрепить до 6 файлов общим размером до 30 МБ.",
        );
      for (const file of selected) {
        const image = /\.(png|jpe?g|gif|webp)$/i.test(file.name);
        const preview = image ? URL.createObjectURL(file) : undefined;
        if (preview) urls.current.add(preview);
        next.push({
          localId: crypto.randomUUID(),
          file,
          mime: image
            ? "image/" +
              (/\.jpe?g$/i.test(file.name)
                ? "jpeg"
                : file.name.split(".").pop()!.toLowerCase())
            : /\.csv$/i.test(file.name)
              ? "text/csv"
              : "text/plain",
          preview,
        });
      }
      update(next);
    },
    remove(id: string) {
      const removed = files.find((f) => f.localId === id);
      if (removed?.preview) {
        URL.revokeObjectURL(removed.preview);
        urls.current.delete(removed.preview);
      }
      update(files.filter((f) => f.localId !== id));
    },
    take() {
      const snapshot = drafts.current.get(scope) || [];
      update([]);
      return snapshot;
    },
    restore(snapshot: PendingChatFile[]) {
      update([...snapshot, ...(drafts.current.get(scope) || [])]);
    },
    release(snapshot: PendingChatFile[]) {
      for (const f of snapshot)
        if (f.preview) {
          URL.revokeObjectURL(f.preview);
          urls.current.delete(f.preview);
        }
    },
  };
}
export async function uploadChatFiles(
  files: PendingChatFile[],
  context: { client: string; project: string },
  sessionId: string,
  signal: AbortSignal,
) {
  for (const file of files) {
    if (file.uploadedId) continue;
    const form = new FormData();
    form.append("file", file.file);
    form.append("name", file.file.name);
    form.append("sessionId", sessionId);
    form.append("client", context.client);
    form.append("project", context.project);
    const result = await api("/conversation/files", "POST", form, signal);
    file.uploadedId = result.id;
  }
  return files.map((file) => file.uploadedId!);
}
export function ChatFileRows({
  files,
  onRemove,
}: {
  files: PendingChatFile[];
  onRemove: (id: string) => void;
}) {
  if (!files.length) return null;
  return (
    <div className="chat-file-list" aria-label="Вложения следующего сообщения">
      {files.map((item, index) => (
        <div className="chat-file-item" key={item.localId}>
          <small>Вложение {index + 1}</small>
          <div className="chat-file-row">
            <FileIcon size={15} />
            {item.preview && <img src={item.preview} alt="" />}
            <span className="chat-file-name" title={item.file.name} dir="rtl">
              {item.file.name}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label={`Убрать вложение ${index + 1}`}
              onClick={() => onRemove(item.localId)}
            >
              <X size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
export function ChatFilePicker({
  disabled,
  onFiles,
  onError,
}: {
  disabled: boolean;
  onFiles: (files: File[]) => void;
  onError: (message: string) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="icon-button chat-file-add"
        title="Добавить вложения: картинки и текстовые файлы"
        aria-label="Добавить вложения"
        disabled={disabled}
        onClick={() => picker.current?.click()}
      >
        <Plus size={18} />
      </button>
      <input
        hidden
        ref={picker}
        type="file"
        accept={CHAT_FILE_ACCEPT}
        multiple
        onChange={(event) => {
          try {
            onFiles(Array.from(event.target.files || []));
          } catch (error: any) {
            onError(error.message);
          }
          event.target.value = "";
        }}
      />
    </>
  );
}

// The drop target covers the whole composer, including its toolbar.
export function ChatFileDropArea({ children, disabled, onFiles, onError }: {
  children: ReactNode;
  disabled: boolean;
  onFiles: (files: File[]) => void;
  onError: (message: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const depth = useRef(0);
  const reset = () => { depth.current = 0; setHover(false); };
  useEffect(() => {
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
      window.removeEventListener("blur", reset);
    };
  }, []);
  useEffect(() => { if (disabled) reset(); }, [disabled]);
  const isFile = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
  return <div className="chat-file-drop-area"
    onPaste={event => {
      if (!(event.target instanceof HTMLTextAreaElement)) return;
      const images = Array.from(event.clipboardData.files).filter(file =>
        file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name),
      );
      if (!images.length) return;
      // Let the textarea insert accompanying plain text at the current selection.
      if (!event.clipboardData.getData("text/plain")) event.preventDefault();
      if (disabled) return;
      try { onFiles(images); }
      catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    }}
    onDragEnter={event => {
      if (!isFile(event)) return;
      event.preventDefault();
      depth.current++;
      if (!disabled) setHover(true);
    }}
    onDragOver={event => {
      if (!isFile(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = disabled ? "none" : "copy";
    }}
    onDragLeave={event => {
      if (!isFile(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setHover(false);
    }}
    onDrop={event => {
      if (!isFile(event)) return;
      event.preventDefault();
      event.stopPropagation();
      reset();
      if (disabled) return;
      try { onFiles(Array.from(event.dataTransfer.files)); }
      catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    }}>
    {children}
    {hover && <div className="chat-file-drop-overlay" role="status"><Upload size={28}/><strong>Drop your files here</strong><small>До 6 файлов · 10 МБ на файл · 30 МБ всего</small></div>}
  </div>;
}

export function ChatFileErrorDialog({ message, onClose }: {
  message: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (message) { if (!dialog.current?.open) dialog.current?.showModal(); }
    else dialog.current?.close();
  }, [message]);
  return <dialog ref={dialog} className="developer-dialog action-confirm-dialog chat-file-error-dialog"
    aria-label="Не удалось добавить вложения" onCancel={onClose}>
    <div className="section-heading"><h2><TriangleAlert size={20}/>Не удалось добавить вложения</h2>
      <button type="button" className="icon-button" aria-label="Закрыть" onClick={onClose}><X size={17}/></button></div>
    <p role="alert">{message}</p>
    <p className="muted">Поддерживаемые расширения: {CHAT_FILE_ACCEPT.split(",").join(", ")}.</p>
    <p className="muted">До 6 непустых файлов, не больше 10 МБ каждый и 30 МБ суммарно. Текст — в UTF-8. Весь выбранный набор отклонён; ранее прикреплённые файлы сохранены.</p>
    <div className="dialog-actions"><button type="button" className="secondary" autoFocus onClick={onClose}>Понятно</button></div>
  </dialog>;
}
