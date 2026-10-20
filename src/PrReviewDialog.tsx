import { ModelOverride } from "./ModelOverride.js";
import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { SingleSelect } from "./SingleSelect.js";
import { api } from "./api.js";

export function PrReviewDialog({
  pr,
  onClose,
  onStarted,
}: {
  pr: any;
  onClose: () => void;
  onStarted: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [model, setModel] = useState("");
  const [frequency, setFrequency] = useState("medium");
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
        <p className="muted">
          {frequency === "none"
            ? "Ревью без вопросов; нехватка данных будет отмечена в отчёте."
            : frequency === "medium"
              ? "Только важные уточнения, без которых нельзя оценить риск. До 3 вопросов."
              : "Более подробные уточнения требований и граничных случаев. До 8 вопросов."}
        </p>
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
        <label className="review-question-field">
          <strong>Комментарий ревьюеру</strong>
          <textarea
            rows={4}
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
