import { useEffect, useRef, useState } from "react";
import { GitPullRequest, X } from "lucide-react";
import { SingleSelect } from "../../../shared/ui/single-select/index.js";
import { CommentEditor } from "../../../entities/rich-content/editor/index.js";
import { api } from "../../../shared/api/http/index.js";
function BranchSelect({
  monitor,
  label,
  value,
  onChange,
  disabled,
  personal = false,
}: {
  monitor: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  personal?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<{
    branches: string[];
    more: boolean;
    personalBranches?: string[];
    warning?: string;
  }>({
    branches: [],
    more: false,
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    setData({ branches: [], more: false });
    const timer = setTimeout(() => {
      void api(
        `/pr/branches?${new URLSearchParams({ monitor, q: query, ...(personal ? { personal: "true" } : {}) })}`,
      )
        .then((v) => {
          if (live) setData(v);
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [monitor, query, refresh, personal]);
  return (
    <div>
      <SingleSelect
        label={label}
        value={value}
        options={[...new Set([...data.branches, ...(value ? [value] : [])])].map((v) => ({
          value: v,
          label:
            v.replace(/^refs\/heads\//, "") +
            (data.personalBranches?.includes(v) ? " · мой push" : ""),
        }))}
        onChange={onChange}
        onSearch={setQuery}
        onOpen={() => setRefresh((n) => n + 1)}
        loading={loading}
        loadingLabel="Ищем ветки в Azure…"
        disabled={disabled}
      />
      {data.warning && <small role="status">{data.warning}</small>}
      {data.more && <small>Первые 100 веток. Уточните поиск.</small>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
const imageMarker = (id: string) => `https://orbit.invalid/pr-image/${id}`;
type DraftImage = { id: string; file: File; preview: string };

export function PrCreateDialog({
  monitors,
  onClose,
  onCreated,
}: {
  monitors: any[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [monitor, setMonitor] = useState(monitors[0]?.id || "");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);
  const submitting = useRef(false);
  const titleEdited = useRef(false);
  const [headRefresh, setHeadRefresh] = useState(0);
  const [headLoading, setHeadLoading] = useState(false);
  const [headError, setHeadError] = useState("");
  const images = useRef<DraftImage[]>([]);
  const submission = useRef<FormData | null>(null);
  const locked = busy || submission.current !== null;
  useEffect(() => () => images.current.forEach((image) => URL.revokeObjectURL(image.preview)), []);
  useEffect(() => {
    if (!monitor || !source) {
      setHeadLoading(false);
      setHeadError("");
      return;
    }
    let live = true;
    setHeadLoading(true);
    setHeadError("");
    void api(`/pr/branch-head?${new URLSearchParams({ monitor, source })}`)
      .then((head) => {
        if (live && !titleEdited.current && !submission.current) setTitle(head.title);
      })
      .catch((e) => {
        if (live) setHeadError(e.message);
      })
      .finally(() => {
        if (live) setHeadLoading(false);
      });
    return () => {
      live = false;
    };
  }, [monitor, source, headRefresh]);
  function addImages(files: File[]) {
    if (locked) return [];
    setError("");
    const used = images.current.filter((image) => description.includes(imageMarker(image.id)));
    const added: { src: string; alt: string }[] = [];
    for (const file of files) {
      if (
        !/^image\/(png|jpeg|gif|webp)$/.test(file.type) ||
        !file.size ||
        file.size > 10 * 1024 * 1024
      ) {
        setError("Поддерживаются PNG, JPEG, GIF и WebP до 10 МБ.");
        continue;
      }
      if (used.length + added.length >= 10) {
        setError("В описание можно добавить до 10 изображений.");
        break;
      }
      const image = { id: crypto.randomUUID(), file, preview: URL.createObjectURL(file) };
      images.current.push(image);
      added.push({ src: imageMarker(image.id), alt: "Изображение" });
    }
    return added;
  }
  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (!submission.current) {
        const used = images.current.filter((image) => description.includes(imageMarker(image.id)));
        const body = new FormData();
        body.append(
          "input",
          JSON.stringify({
            monitor,
            source,
            target,
            title,
            description,
            draft,
            requestId: crypto.randomUUID(),
            images: used.map(({ id }) => ({ id })),
          }),
        );
        used.forEach((image) => body.append("images", image.file, image.id));
        submission.current = body;
      }
      const created = await api("/pr/create", "POST", submission.current);
      setResult(created);
      onCreated();
    } catch (e: any) {
      if (e.details?.safeToEdit === true) submission.current = null;
      setError(e.message);
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const selected = monitors.find((m) => m.id === monitor);
  return (
    <dialog
      ref={ref}
      className="developer-dialog pr-review-dialog"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <div className="developer-dialog-heading">
        <h2>
          <GitPullRequest size={22} /> Создать pull request
        </h2>
        <button className="icon-button" aria-label="Закрыть" disabled={busy} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {result ? (
        <div>
          <p role="status">
            {result.existing ? "Уже существует открытый" : "Создан"} PR #{result.number}.
          </p>
          <p className="muted">
            {result.refreshError
              ? `PR подтверждён, но список не обновлён: ${result.refreshError} `
              : "Список обновлён. "}
            Фильтр «Только required reviewer» может скрывать ваш PR.
          </p>
          {result.existing && (
            <p className="muted">Описание и изображения существующего PR не изменены.</p>
          )}
          {result.incomplete && (
            <div className="pr-create-recovery">
              <p className="error" role="alert">
                {result.attachmentError}
              </p>
              <p>
                PR уже создан. Повтор продолжит загрузку скриншотов и сохранение описания в этот же
                PR.
              </p>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy ? "Завершаем…" : "Повторить сохранение описания"}
              </button>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="button" disabled={busy} onClick={onClose}>
            Готово
          </button>
        </div>
      ) : (
        <form
          className="pr-create-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {!monitors.length && <p>Сначала добавьте Git-репозиторий в «Заказчики и проекты».</p>}
          <SingleSelect
            label="Репозиторий"
            value={monitor}
            options={monitors.map((m) => ({
              value: m.id,
              label: `${m.client} / ${m.project} · ${m.repository}`,
            }))}
            disabled={locked}
            onChange={(v) => {
              setMonitor(v);
              setSource("");
              setTarget("");
              if (!titleEdited.current) setTitle("");
            }}
          />
          {selected && (
            <div className="pr-create-branches" key={monitor}>
              <BranchSelect
                monitor={monitor}
                label="Source · откуда"
                value={source}
                onChange={(value) => {
                  setSource(value);
                  if (!titleEdited.current) setTitle("");
                }}
                personal
                disabled={locked}
              />
              <BranchSelect
                monitor={monitor}
                label="Target · куда"
                value={target}
                onChange={setTarget}
                disabled={locked}
              />
            </div>
          )}
          {source && source === target && (
            <p className="error">Исходная и целевая ветки должны различаться.</p>
          )}
          <label>
            Название
            <input
              required
              maxLength={400}
              value={title}
              disabled={locked}
              onChange={(e) => {
                titleEdited.current = true;
                setTitle(e.target.value);
              }}
            />
          </label>
          {headLoading && <small role="status">Читаем последний коммит source…</small>}
          {headError && (
            <p className="error" role="alert">
              {headError}. Название можно указать вручную.
            </p>
          )}
          <button
            type="button"
            className="pr-create-title-refresh"
            disabled={locked || !source || headLoading}
            onClick={() => {
              titleEdited.current = false;
              setHeadRefresh((n) => n + 1);
            }}
          >
            Взять название из коммита
          </button>
          <div className="pr-create-description">
            <span className="multi-select-label">Описание</span>
            <CommentEditor
              label="Описание"
              text={description}
              disabled={locked}
              onChange={setDescription}
              onImages={addImages}
              resolveImage={(src) =>
                images.current.find((image) => imageMarker(image.id) === src)?.preview || src
              }
            />
            <small className="muted">
              Скриншоты будут прикреплены к PR в Azure и доступны участникам с доступом к
              репозиторию. До 10 файлов по 10 МБ.
            </small>
          </div>
          <small className={description.length > 20000 ? "error" : "muted"}>
            {description.length} / 20 000 символов описания
          </small>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft}
              disabled={locked}
              onChange={(e) => setDraft(e.target.checked)}
            />{" "}
            Черновик
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {submission.current && error && (
            <p className="muted">
              Поля сохранены для безопасного повтора. Если ответ потерялся, повторите отправку из
              этого окна, чтобы проверить результат.
            </p>
          )}
          <p className="muted">
            PR будет создан в Azure DevOps. Требуется PAT с Code: Read & Write.
          </p>
          <button
            className="primary"
            disabled={
              busy ||
              !monitor ||
              !source ||
              !target ||
              source === target ||
              !title.trim() ||
              description.length > 20000
            }
          >
            {busy
              ? "Создаём PR и загружаем изображения…"
              : submission.current
                ? "Повторить отправку"
                : "Создать PR в Azure"}
          </button>
        </form>
      )}
    </dialog>
  );
}
