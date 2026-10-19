import { useEffect, useRef, useState } from "react";
import { GitPullRequest, X } from "lucide-react";
import { SingleSelect } from "./SingleSelect.js";
import { api } from "./api.js";
function BranchSelect({
  monitor,
  label,
  value,
  onChange,
  disabled,
}: {
  monitor: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<{ branches: string[]; more: boolean }>({
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
      void api(`/pr/branches?${new URLSearchParams({ monitor, q: query })}`)
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
  }, [monitor, query]);
  return (
    <div>
      <SingleSelect
        label={label}
        value={value}
        options={[
          ...new Set([...data.branches, ...(value ? [value] : [])]),
        ].map((v) => ({ value: v, label: v.replace(/^refs\/heads\//, "") }))}
        onChange={onChange}
        onSearch={setQuery}
        disabled={disabled}
      />
      {loading && <small role="status">Поиск веток…</small>}
      {data.more && <small>Первые 100 веток. Уточните поиск.</small>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function PrCreateDialog({
  monitors,
  onClose,
}: {
  monitors: any[];
  onClose: () => void;
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
        <button
          className="icon-button"
          aria-label="Закрыть"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {result ? (
        <div>
          <p role="status">
            {result.existing ? "Уже существует открытый" : "Создан"} PR #
            {result.number}.
          </p>
          <p className="muted">
            Список обновится при синхронизации. Фильтр «Только required
            reviewer» может скрывать ваш PR.
          </p>
          <button onClick={onClose}>Готово</button>
        </div>
      ) : (
        <form
          className="pr-create-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (submitting.current) return;
            submitting.current = true;
            setBusy(true);
            setError("");
            try {
              setResult(
                await api("/pr/create", "POST", {
                  monitor,
                  source,
                  target,
                  title,
                  description,
                  draft,
                }),
              );
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
              submitting.current = false;
            }
          }}
        >
          {!monitors.length && (
            <p>Сначала добавьте Git-репозиторий в «Заказчики и проекты».</p>
          )}
          <SingleSelect
            label="Репозиторий"
            value={monitor}
            options={monitors.map((m) => ({
              value: m.id,
              label: `${m.client} / ${m.project} · ${m.repository}`,
            }))}
            disabled={busy}
            onChange={(v) => {
              setMonitor(v);
              setSource("");
              setTarget("");
            }}
          />
          {selected && (
            <div className="pr-create-branches" key={monitor}>
              <BranchSelect
                monitor={monitor}
                label="Source · откуда"
                value={source}
                onChange={setSource}
                disabled={busy}
              />
              <BranchSelect
                monitor={monitor}
                label="Target · куда"
                value={target}
                onChange={setTarget}
                disabled={busy}
              />
            </div>
          )}
          {source && source === target && (
            <p className="error">
              Исходная и целевая ветки должны различаться.
            </p>
          )}
          <label>
            Название
            <input
              required
              maxLength={400}
              value={title}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Описание
            <textarea
              rows={6}
              maxLength={20000}
              value={description}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.checked)}
            />{" "}
            Черновик
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
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
              !title.trim()
            }
          >
            {busy ? "Создаём…" : "Создать PR в Azure"}
          </button>
        </form>
      )}
    </dialog>
  );
}
