import { useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";
import { CommentEditor } from "./CommentEditor.js";
import { api } from "./api.js";
const marker = (id: string) => `https://orbit.invalid/ticket-note-image/${id}`;
export function TicketNoteForm({
  ticket,
  onSaved,
  onClose,
  onBusy,
}: {
  ticket: any;
  onSaved: () => void;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [text, setText] = useState(""),
    [original, setOriginal] = useState(""),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const images = useRef<{ id: string; file: File; preview: string }[]>([]);
  useEffect(() => {
    let live = true;
    api(
      `/ticket-notes/${ticket.id}?${new URLSearchParams({ source: ticket.source })}`,
    )
      .then((v) => {
        if (live) {
          setText(v.notes);
          setOriginal(v.notes);
          setReady(true);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      images.current.forEach((i) => URL.revokeObjectURL(i.preview));
    };
  }, [ticket.id, ticket.source]);
  async function save() {
    if (!ready || busy) return;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const used = images.current.filter((i) => text.includes(marker(i.id))),
        form = new FormData();
      form.append("source", ticket.source);
      form.append("notes", text);
      form.append("expectedNotes", original);
      form.append("uploadIds", JSON.stringify(used.map((i) => i.id)));
      used.forEach((i) => form.append("images", i.file));
      const saved = await api("/ticket-notes/" + ticket.id, "PUT", form);
      window.dispatchEvent(
        new CustomEvent("orbit:ticket-metadata", {
          detail: {
            id: ticket.id,
            source: ticket.source,
            value: { notes: saved.notes },
          },
        }),
      );
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message + " Черновик остаётся в открытом окне.");
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div className="ticket-note-form">
      <CommentEditor
        text={text}
        disabled={!ready || busy}
        onChange={setText}
        resolveImage={(src) =>
          images.current.find((i) => marker(i.id) === src)?.preview || src
        }
        onImages={(files) => {
          const added: { src: string; alt: string }[] = [];
          setError("");
          for (const file of files) {
            if (
              !/^image\/(png|jpeg|gif|webp)$/.test(file.type) ||
              !file.size ||
              file.size > 10 * 1024 * 1024
            ) {
              setError("Поддерживаются PNG, JPEG, GIF и WebP до 10 МБ.");
              continue;
            }
            if (
              images.current.length >= 10 ||
              images.current.reduce((n, i) => n + i.file.size, 0) + file.size >
                30 * 1024 * 1024
            ) {
              setError("До 10 новых картинок общим размером до 30 МБ.");
              break;
            }
            const id = crypto.randomUUID();
            images.current.push({
              id,
              file,
              preview: URL.createObjectURL(file),
            });
            added.push({ src: marker(id), alt: "Изображение" });
          }
          return added;
        }}
      />
      <p className="muted">
        До 20 000 символов и 10 картинок. Удалённые картинки очищаются после
        сохранения.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="card-actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onClose}
        >
          Отмена
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !ready || text.length > 20000}
          onClick={() => void save()}
        >
          <Save size={16} />
          {busy ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
