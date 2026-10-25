import { noteImageBudget } from "./note-image-budget.js";
import { TicketNotesPage } from "./TicketNotesPage.js";
import { useEffect, useState } from "react";
import { Plus, Save, Trash2, StickyNote } from "lucide-react";
import { CommentEditor } from "./CommentEditor.js";
import { ConfirmButton } from "./ConfirmButton.js";
import { api } from "./api.js";

type Note = {
  id: string;
  title: string;
  body: string;
  revision: number;
  updated_at: string;
};
type Draft = Note & {
  dirty: boolean;
  images: { id: string; file: File; preview: string }[];
};
const drafts = new Map<string, Draft>();
const marker = (id: string) => `https://orbit.invalid/note-image/${id}`;
function release(draft: Draft) {
  draft.images.forEach((image) => URL.revokeObjectURL(image.preview));
}
if (typeof window !== "undefined")
  window.addEventListener("beforeunload", (event) => {
    if ([...drafts.values()].some((d) => d.dirty)) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
export function NotesPage() {
  const [tab, setTab] = useState("free");
  return (
    <>
      <div className="tabs notes-tabs" role="tablist" aria-label="Виды заметок">
        <button
          role="tab"
          aria-selected={tab === "free"}
          className={tab === "free" ? "active" : ""}
          onClick={() => setTab("free")}
        >
          Свободные заметки
        </button>
        <button
          role="tab"
          aria-selected={tab === "tickets"}
          className={tab === "tickets" ? "active" : ""}
          onClick={() => setTab("tickets")}
        >
          Заметки тикетов
        </button>
      </div>
      <div hidden={tab !== "free"}>
        <FreeNotesPage />
      </div>
      <section hidden={tab !== "tickets"} className="panel notes-page">
        <h1>Заметки тикетов</h1>
        <TicketNotesPage />
      </section>
    </>
  );
}
function FreeNotesPage() {
  const [list, setList] = useState<
    { id: string; title: string; snippet: string; updated_at: string }[]
  >([]);
  const [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [, render] = useState(0);
  const draft = drafts.get(selected);
  const refresh = () => render((n) => n + 1);
  async function loadList() {
    setList(await api("/notes"));
  }
  useEffect(() => {
    let live = true;
    api("/notes")
      .then((items) => {
        if (live) setList(items);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  async function open(id: string) {
    if (busy) return;
    setError("");
    if (drafts.get(id)?.dirty) {
      setSelected(id);
      return;
    }
    setBusy(true);
    try {
      const note: Note = await api("/notes/" + id);
      const previous = drafts.get(id);
      if (previous) release(previous);
      drafts.set(id, { ...note, dirty: false, images: [] });
      setSelected(id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function create() {
    setError("");
    const note: Draft = {
      id: crypto.randomUUID(),
      title: "Новая заметка",
      body: "",
      revision: 0,
      updated_at: new Date().toISOString(),
      dirty: true,
      images: [],
    };
    drafts.set(note.id, note);
    setSelected(note.id);
  }
  function change(text: string) {
    if (!draft || busy) return;
    draft.body = text;
    draft.dirty = true;
    refresh();
  }
  function images(files: File[]) {
    if (!draft || busy) return [];
    setError("");
    const added: { src: string; alt: string }[] = [];
    const budget = noteImageBudget(draft.body, draft.images, "free");
    for (const file of files) {
      if (
        !/^image\/(png|jpeg|gif|webp)$/.test(file.type) ||
        !file.size ||
        file.size > 10 * 1024 * 1024
      ) {
        setError("Поддерживаются PNG, JPEG, GIF и WebP до 10 МБ.");
        continue;
      }
      if (budget.count >= 10 || budget.bytes + file.size > 30 * 1024 * 1024) {
        setError(
          "До 10 новых картинок общим размером до 30 МБ. Сохраните заметку перед добавлением следующих.",
        );
        break;
      }
      const image = {
        id: crypto.randomUUID(),
        file,
        preview: URL.createObjectURL(file),
      };
      draft.images.push(image);
      budget.count++;
      budget.bytes += file.size;
      added.push({ src: marker(image.id), alt: "Изображение" });
    }
    return added;
  }
  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      const used = draft.images.filter((i) =>
        draft.body.includes(marker(i.id)),
      );
      const form = new FormData();
      form.append("title", draft.title);
      form.append("body", draft.body);
      form.append("revision", String(draft.revision));
      form.append("uploadIds", JSON.stringify(used.map((i) => i.id)));
      used.forEach((i) => form.append("images", i.file));
      const note: Note = await api("/notes/" + draft.id, "PUT", form);
      release(draft);
      drafts.set(note.id, { ...note, dirty: false, images: [] });
      refresh();
      setList((old) => [
        { ...note, snippet: note.body.slice(0, 160) },
        ...old.filter((n) => n.id !== note.id),
      ]);
      try {
        await loadList();
      } catch {
        setError(
          "Заметка сохранена, но не удалось обновить список. Повторно сохранять не нужно.",
        );
      }
    } catch (e: any) {
      setError(e.message + " Черновик сохранён в этом окне.");
    } finally {
      setBusy(false);
    }
  }
  const visibleList = [
    ...Array.from(drafts.values())
      .filter((d) => d.revision === 0)
      .map((d) => ({ ...d, snippet: d.body.slice(0, 160) })),
    ...list,
  ];
  return (
    <section className="panel notes-page">
      <div className="notes-heading">
        <h1>
          <StickyNote size={22} /> Заметки
        </h1>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void create()}
        >
          <Plus size={16} />
          Новая заметка
        </button>
      </div>
      <p className="muted">
        <small>Свободные заметки недоступны чат-ассистенту.</small>
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="notes-layout">
        <aside className="notes-list" aria-label="Список заметок">
          {!visibleList.length && (
            <p className="muted">Создайте первую заметку.</p>
          )}
          {visibleList.map((note) => (
            <button
              key={note.id}
              className={selected === note.id ? "is-selected" : ""}
              disabled={busy}
              onClick={() => void open(note.id)}
            >
              <strong>
                {drafts.get(note.id)?.title || note.title}
                {drafts.get(note.id)?.dirty ? " · Черновик" : ""}
              </strong>
              <small>{note.snippet || "Пустая заметка"}</small>
            </button>
          ))}
        </aside>
        <div className="notes-content">
          {draft ? (
            <div key={draft.id}>
              <label className="notes-title">
                Название
                <input
                  maxLength={200}
                  value={draft.title}
                  disabled={busy}
                  onChange={(e) => {
                    draft.title = e.target.value;
                    draft.dirty = true;
                    refresh();
                  }}
                />
              </label>
              <div className="notes-body-label">Описание</div>
              <CommentEditor
                notesOnly
                text={draft.body}
                disabled={busy}
                onChange={change}
                onImages={images}
                resolveImage={(src) =>
                  draft.images.find((i) => marker(i.id) === src)?.preview || src
                }
              />
              <div className="notes-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !draft.dirty || !draft.title.trim()}
                  onClick={() => void save()}
                >
                  <Save size={16} />
                  {busy ? "Сохранение…" : "Сохранить"}
                </button>
                <span className="muted" role="status">
                  {draft.dirty ? "Есть несохранённые изменения" : "Сохранено"}
                </span>
                <ConfirmButton
                  className="secondary calendar-delete"
                  disabled={busy}
                  title="Удалить заметку?"
                  message="Заметка и её локальные картинки будут удалены без возможности восстановления."
                  confirmLabel="Удалить"
                  onConfirm={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      if (draft.revision > 0)
                        await api("/notes/" + draft.id, "DELETE", {
                          revision: draft.revision,
                        });
                      release(draft);
                      drafts.delete(draft.id);
                      setSelected("");
                      await loadList();
                    } catch (e: any) {
                      setError(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Trash2 size={16} />
                  Удалить
                </ConfirmButton>
                {draft.dirty && draft.revision > 0 && (
                  <ConfirmButton
                    className="secondary"
                    disabled={busy}
                    title="Отменить изменения?"
                    message="Несохранённый текст и новые картинки будут потеряны. Откроется последняя сохранённая версия."
                    confirmLabel="Открыть сохранённую"
                    onConfirm={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        const note: Note = await api("/notes/" + draft.id);
                        release(draft);
                        drafts.set(note.id, {
                          ...note,
                          dirty: false,
                          images: [],
                        });
                        refresh();
                      } catch (e: any) {
                        setError(e.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Открыть сохранённую версию
                  </ConfirmButton>
                )}
              </div>
              <p className="muted">
                Картинки сохраняются локально вместе с заметкой: до 10 картинок
                по 10 МБ, до 30 МБ новых файлов за сохранение. Удалённые из
                текста картинки очищаются после сохранения.
              </p>
            </div>
          ) : (
            <p className="muted">
              {busy
                ? "Загрузка…"
                : "Выберите заметку слева или создайте новую."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
