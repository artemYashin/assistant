import { ModelOverride } from "./ModelOverride.js";
import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { SingleSelect } from "./SingleSelect.js";
import { api } from "./api.js";

export function PrReviewDialog({
  pr,
  defaultMaxTokens = 1_000_000,
  onClose,
  onStarted,
}: {
  pr: any;
  defaultMaxTokens?: number;
  onClose: () => void;
  onStarted: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [model, setModel] = useState("");
  const [frequency, setFrequency] = useState("medium");
  const [memoryScopes, setMemoryScopes] = useState(["general", "client", "project", "project_review"]);
  const [readCode, setReadCode] = useState(true);
  const [maxTokens, setMaxTokens] = useState(defaultMaxTokens);
  const [readTickets, setReadTickets] = useState(true);
  const [reviewerComment, setReviewerComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
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
        <h2>Ревью PR #{pr.number}</h2>
        <button
          className="icon-button"
          aria-label="Закрыть"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("/pr/review", "POST", {
              monitor: pr.monitor,
              repo: pr.repo,
              number: pr.number,
              options: {
                model,
                questionFrequency: frequency,
                readTickets,
                memoryScopes,
                readCode,
                maxTokens,
                reviewerComment,
              },
              restart: pr.review_status === "completed",
            });
            onStarted();
          } catch (e: any) {
            setError(e.message);
            setBusy(false);
          }
        }}
      >
        <p className="muted">Сначала проверим и при необходимости загрузим source-ветку до коммита PR. Ревью начнётся после подготовки Git.</p>
        <fieldset className="review-settings-block"><legend>Параметры ревью</legend>
        <div className="review-settings-row">
        <ModelOverride value={model} onChange={setModel} disabled={busy} />
        <SingleSelect
          label="Частота вопросов"
          value={frequency}
          onChange={setFrequency}
          disabled={busy}
          options={[
            { value: "none", label: "Не задавать" },
            { value: "medium", label: "Средняя" },
            { value: "high", label: "Высокая" },
          ]}
        />
        </div>
        <p className="muted">
          {frequency === "none"
            ? "Ревью без вопросов; нехватка данных будет отмечена в отчёте."
            : frequency === "medium"
              ? "Только важные уточнения, без которых нельзя оценить риск. До 3 вопросов."
              : "Более подробные уточнения требований и граничных случаев. До 8 вопросов."}
        </p>
        <label className="review-token-limit">Максимум токенов на ревью
          <input type="number" min={1000} max={100000000} step={1} required disabled={busy} value={maxTokens || ""} onChange={event => setMaxTokens(Number(event.target.value))} />
        </label>
        <small className="muted">Входящие + исходящие за всё ревью, включая продолжения после ответов. Остановка по отчётам модели.</small>
        </fieldset>
        <fieldset className="review-settings-block"><legend>Контекст ревью</legend>
        <label className="pr-review-ticket-option review-code-option"><input type="checkbox" checked={readCode} disabled={busy} onChange={event => setReadCode(event.target.checked)} />Разрешить поиск и чтение кода репозитория</label>
        <label className="pr-review-ticket-option">
          <input
            type="checkbox"
            checked={readTickets}
            disabled={busy}
            onChange={(e) => setReadTickets(e.target.checked)}
          />
          Прочитать связанные тикеты и все комментарии перед ревью
        </label>
        <p className="muted">
          Сравнить код с описанием, критериями приёмки и обсуждением.
          Изображения и файлы не анализируются. Если данные недоступны или
          превышают лимит, ревью остановится с объяснением.
        </p>
        <div className="review-memory-heading">Используемая память</div>
        <div className="review-memory-options" role="group" aria-label="Используемая память">
          {[
            ["general", "Общая"], ["client", "Заказчика"], ["project", "Проекта"], ["project_review", "Ревью проекта"],
          ].map(([value, label]) => <label className="check-option" key={value}>
            <input type="checkbox" checked={memoryScopes.includes(value)} disabled={busy} onChange={event => setMemoryScopes(previous => event.target.checked ? [...previous, value] : previous.filter(scope => scope !== value))} />{label}
          </label>)}
        </div>
        <small className="muted">Сначала передаются только названия; подробности ревьюер читает по необходимости. Память «Ревью проекта» используется только для ревью и не добавляется автоматически в чат. Можно отключить все разделы.</small>
        </fieldset>
        <label className="review-question-field">
          <strong>Комментарий ревьюеру</strong>
          <textarea
            rows={3}
            maxLength={4000}
            value={reviewerComment}
            disabled={busy}
            onChange={(e) => setReviewerComment(e.target.value)}
            placeholder="Например: удели внимание обработке ошибок и обратной совместимости"
          />
          <small>
            Необязательно. Сохранится для повторной проверки после ответов на
            вопросы.
          </small>
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>
          <button className="pr-review-launch" disabled={busy}>
            <Sparkles size={17} />
            {busy ? "Запускаю…" : "Запустить ревью"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
