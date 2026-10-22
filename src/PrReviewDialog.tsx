import { requestFieldDictation } from "./FieldDictation.js";
import { ModelOverride } from "./ModelOverride.js";
import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Mic, Globe, Users, FolderOpen, Code2, Ticket, CircleCheck, TriangleAlert } from "lucide-react";
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
  const sourceReady = pr.local_source?.status === "ready";
  const sourceHint = sourceReady
    ? "Локальная source-ветка готова: её коммит совпадает с коммитом PR. Дополнительная загрузка перед ревью не требуется."
    : pr.local_source?.status === "loading"
      ? "Source-ветка сейчас загружается. Ревью с доступом к коду начнётся после её подготовки."
      : pr.local_source?.status === "stale"
        ? "Локальная source-ветка не соответствует коммиту PR. Перед ревью с доступом к коду сначала обновим её."
        : pr.local_source?.status === "error"
          ? "Не удалось подготовить локальную source-ветку. При запуске ревью с доступом к коду повторим подготовку; ревью начнётся только после её завершения."
          : "Готовность локальной source-ветки пока не подтверждена. Перед ревью с доступом к коду сначала проверим и при необходимости загрузим её до коммита PR.";
  const ref = useRef<HTMLDialogElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
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
        <p className="muted">{readCode ? "Сначала проверим и при необходимости загрузим source-ветку до коммита PR. Ревью начнётся после подготовки Git." : "Ревью использует diff PR и выбранный контекст без подготовки локального Git."}</p>
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
        <label className="review-token-limit">Максимум токенов на ревью
          <input type="number" min={1000} max={100000000} step={1} required disabled={busy} value={maxTokens || ""} onChange={event => setMaxTokens(Number(event.target.value))} />
        </label>
        <div className="review-parameter-hints">
        <p className="muted">
          {frequency === "none"
            ? "Ревью без вопросов; нехватка данных будет отмечена в отчёте."
            : frequency === "medium"
              ? "Только важные уточнения, без которых нельзя оценить риск. До 3 вопросов."
              : "Более подробные уточнения требований и граничных случаев. До 8 вопросов."}
        </p>
        <small className="muted">Входящие + исходящие за всё ревью, включая продолжения после ответов. Остановка по отчётам модели.</small>
        </div>
        </fieldset>
        <fieldset className="review-settings-block"><legend>Контекст ревью</legend>
        <label className="pr-review-ticket-option review-code-option review-choice"><input type="checkbox" checked={readCode} disabled={busy} onChange={event => setReadCode(event.target.checked)} /><Code2 size={17} aria-hidden="true" /><span>Разрешить поиск и чтение кода репозитория</span>
          <span className={`review-code-info ${sourceReady ? "is-ready" : "is-warning"}`} tabIndex={0} aria-label={sourceReady ? "Локальная ветка готова" : "Требуется подготовка локальной ветки"} aria-describedby="review-code-info-tooltip" onClick={event => event.preventDefault()}>
            {sourceReady ? <CircleCheck size={15} aria-hidden="true" /> : <TriangleAlert size={15} aria-hidden="true" />}
            <span role="tooltip" id="review-code-info-tooltip">{sourceHint}</span>
          </span>
        </label>
        <label className="pr-review-ticket-option review-choice">
          <input
            type="checkbox"
            checked={readTickets}
            disabled={busy}
            onChange={(e) => setReadTickets(e.target.checked)}
          />
          <Ticket size={17} aria-hidden="true" /><span>Прочитать связанные тикеты, комментарии и локальные заметки</span>
        </label>
        <p className="muted">
          Сравнить код с описанием, критериями приёмки, обсуждением и заметками из Orbit.
          Изображения и файлы не анализируются. Если данные недоступны или
          превышают лимит, ревью остановится с объяснением.
        </p>
        <div className="review-memory-heading">Используемая память</div>
        <div className="review-memory-options" role="group" aria-label="Используемая память">
          {[
            { value: "general", label: "Общая", Icon: Globe },
            { value: "client", label: "Заказчика", Icon: Users },
            { value: "project", label: "Проекта", Icon: FolderOpen },
            { value: "project_review", label: "Ревью проекта", Icon: Sparkles },
          ].map(({ value, label, Icon }) => <label className="check-option review-choice" key={value}>
            <input type="checkbox" checked={memoryScopes.includes(value)} disabled={busy} onChange={event => setMemoryScopes(previous => event.target.checked ? [...previous, value] : previous.filter(scope => scope !== value))} /><Icon size={17} aria-hidden="true" /><span>{label}</span>
          </label>)}
        </div>
        <small className="muted">Сначала передаются только названия; подробности ревьюер читает по необходимости. Память «Ревью проекта» используется только для ревью и не добавляется автоматически в чат. Можно отключить все разделы.</small>
        </fieldset>
        <label className="review-question-field">
          <span className="review-comment-heading"><strong>Комментарий ревьюеру</strong>
          <button type="button" className="icon-button review-comment-mic" disabled={busy} title="Продиктовать комментарий" aria-label="Продиктовать комментарий" onClick={() => requestFieldDictation(commentRef.current)}><Mic size={16} /></button></span>
          <textarea
            ref={commentRef}
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
