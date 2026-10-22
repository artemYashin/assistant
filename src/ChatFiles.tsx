import { useEffect, useRef, useState } from "react";
import { File as FileIcon, Plus, X } from "lucide-react";
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
            "Поддерживаются PNG, JPEG, GIF, WebP, TXT, Markdown, JSON и CSV.",
          );
        if (!file.size || file.size > 10 * 1024 * 1024)
          throw new Error(
            "Каждое вложение должно быть непустым и не больше 10 МБ.",
          );
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
