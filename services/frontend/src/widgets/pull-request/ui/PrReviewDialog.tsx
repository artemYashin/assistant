import { NumberInput } from "../../../shared/ui/number-input/index.js";
import { requestFieldDictation } from "../../../features/voice-input/index.js";
import { ModelOverride } from "../../../entities/llm/index.js";
import { useEffect, useId, useRef, useState } from "react";
import {
  Sparkles,
  X,
  Mic,
  Globe,
  Users,
  FolderOpen,
  Code2,
  Ticket,
  CircleCheck,
  TriangleAlert,
} from "lucide-react";
import { SingleSelect } from "../../../shared/ui/single-select/index.js";
import { api } from "../../../shared/api/http/index.js";

export function PrReviewDialog({
  pr,
  defaultMaxTokens = 1_000_000,
  defaultMaxToolCalls = 30,
  onClose,
  onStarted,
}: {
  pr: any;
  defaultMaxTokens?: number;
  defaultMaxToolCalls?: number;
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
  const commentId = useId();
  const [model, setModel] = useState("");
  const [frequency, setFrequency] = useState("medium");
  const [memoryScopes, setMemoryScopes] = useState([
    "general",
    "client",
    "project",
    "project_review",
  ]);
  const [readCode, setReadCode] = useState(true);
  const [codeDepth, setCodeDepth] = useState("below_medium");
  const [maxTokens, setMaxTokens] = useState(defaultMaxTokens);
  const [maxToolCalls, setMaxToolCalls] = useState(defaultMaxToolCalls);
  const [tickets] = useState<{ id: number; title?: string }[]>(() =>
    (pr.tickets || []).filter((ticket: { disabled?: boolean }) => !ticket.disabled),
  );
  const [readTickets, setReadTickets] = useState(() => tickets.length > 0);
  const [ticketIds, setTicketIds] = useState<number[]>(() =>
    (pr.tickets || [])
      .filter((ticket: { disabled?: boolean }) => !ticket.disabled)
      .map((ticket: { id: number }) => ticket.id),
  );
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
        <button className="icon-button" aria-label="Закрыть" disabled={busy} onClick={onClose}>
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
                ticketIds: readTickets ? ticketIds : [],
                memoryScopes,
                readCode,
                codeDepth,
                maxTokens,
                maxToolCalls,
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
        <p className="muted">
          {readCode
            ? "Сначала проверим и при необходимости загрузим source-ветку до коммита PR. Ревью начнётся после подготовки Git."
            : "Ревью использует diff PR и выбранный контекст без подготовки локального Git."}
        </p>
        <fieldset className="review-settings-block">
          <legend>Параметры ревью</legend>
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
          <div className="review-run-limits">
            <label className="review-token-limit">
              Максимум токенов на ревью
              <NumberInput
                min={1000}
                max={100000000}
                step={1}
                required
                disabled={busy}
                value={maxTokens || ""}
                onChange={(event) => setMaxTokens(Number(event.target.value))}
              />
            </label>
            <label className="review-token-limit">
              Максимум инструментов на ревью
              <NumberInput
                min={1}
                max={1000}
                step={1}
                required
                disabled={busy}
                value={maxToolCalls || ""}
                onChange={(event) => setMaxToolCalls(Number(event.target.value))}
              />
            </label>
          </div>
          <small className="muted">
            Количество вызовов инструментов за всё ревью, включая продолжения после вопросов. Лимиты
            в этой форме действуют только на этот запуск.
          </small>
          <div className="review-parameter-hints">
            <p className="muted">
              {frequency === "none"
                ? "Ревью без вопросов; нехватка данных будет отмечена в отчёте."
                : frequency === "medium"
                  ? "Только важные уточнения, без которых нельзя оценить риск. До 3 вопросов."
                  : "Более подробные уточнения требований и граничных случаев. До 8 вопросов."}
            </p>
            <small className="muted">
              Входящие + исходящие за всё ревью, включая продолжения после ответов. Остановка по
              отчётам модели.
            </small>
          </div>
        </fieldset>
        <fieldset className="review-settings-block">
          <legend>Контекст ревью</legend>
          <label className="pr-review-ticket-option review-code-option review-choice">
            <input
              type="checkbox"
              checked={readCode}
              disabled={busy}
              onChange={(event) => setReadCode(event.target.checked)}
            />
            <Code2 size={17} aria-hidden="true" />
            <span>Разрешить поиск и чтение кода репозитория</span>
            <span
              className={`review-code-info ${sourceReady ? "is-ready" : "is-warning"}`}
              tabIndex={0}
              aria-label={
                sourceReady ? "Локальная ветка готова" : "Требуется подготовка локальной ветки"
              }
              aria-describedby="review-code-info-tooltip"
              onClick={(event) => event.preventDefault()}
            >
              {sourceReady ? (
                <CircleCheck size={15} aria-hidden="true" />
              ) : (
                <TriangleAlert size={15} aria-hidden="true" />
              )}
              <span role="tooltip" id="review-code-info-tooltip">
                {sourceHint}
              </span>
            </span>
          </label>
          {readCode && (
            <div className="review-code-depth">
              <SingleSelect
                label="Глубина изучения кода"
                value={codeDepth}
                onChange={setCodeDepth}
                disabled={busy}
                searchable={false}
                options={[
                  { value: "low", label: "Низкая" },
                  { value: "below_medium", label: "Ниже среднего" },
                  { value: "medium", label: "Средняя" },
                  { value: "high", label: "Высокая" },
                ]}
              />
              <small className={codeDepth === "high" ? "review-depth-warning" : "muted"}>
                {codeDepth === "high" && <TriangleAlert size={14} aria-hidden="true" />}
                {codeDepth === "low"
                  ? "Сначала diff. Код читается только для проверки конкретного существенного риска; самостоятельные изменения обычно не требуют поиска."
                  : codeDepth === "below_medium"
                    ? "Выборочная проверка изменённой логики и ближайшего контекста, без обхода всех зависимостей и вспомогательных примеров."
                    : codeDepth === "medium"
                      ? "Проверка контрактов, связанных вызовов и граничных случаев; дополнительный контекст — по конкретным вопросам."
                      : "Более широкий контекст, косвенные зависимости и вспомогательные примеры. Может потребовать много токенов; общий лимит сохраняется."}
              </small>
            </div>
          )}
          <label className="pr-review-ticket-option review-choice">
            <input
              type="checkbox"
              checked={readTickets}
              disabled={busy}
              onChange={(e) => setReadTickets(e.target.checked)}
            />
            <Ticket size={17} aria-hidden="true" />
            <span>Прочитать связанные тикеты, комментарии и локальные заметки</span>
          </label>
          {readTickets && (
            <div className="review-ticket-selection" role="group" aria-label="Тикеты для ревью">
              {pr.ticket_links_error && (
                <small className="error">
                  Не удалось обновить связи тикетов. Ниже — сохранённый список; для актуализации
                  синхронизируйте PR.
                </small>
              )}
              {tickets.length ? (
                <>
                  <div className="review-ticket-selection-heading">
                    <small>
                      Выбрано {ticketIds.length} из {tickets.length}
                    </small>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        setTicketIds(
                          ticketIds.length === tickets.length
                            ? []
                            : tickets.map((ticket) => ticket.id),
                        )
                      }
                    >
                      {ticketIds.length === tickets.length ? "Снять все" : "Выбрать все"}
                    </button>
                  </div>
                  <div className="review-ticket-selection-list">
                    {tickets.map((ticket) => (
                      <label
                        className="review-ticket-row"
                        key={ticket.id}
                        title={ticket.title || `Тикет #${ticket.id}`}
                      >
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={ticketIds.includes(ticket.id)}
                          onChange={(event) =>
                            setTicketIds((previous) =>
                              event.target.checked
                                ? [...previous, ticket.id]
                                : previous.filter((id) => id !== ticket.id),
                            )
                          }
                        />
                        <Ticket size={14} aria-hidden="true" />
                        <b>#{ticket.id}</b>
                        <span>{ticket.title || "Название не загружено"}</span>
                      </label>
                    ))}
                  </div>
                  {ticketIds.length > 20 && (
                    <small className="error">Выберите не более 20 тикетов.</small>
                  )}
                  {!ticketIds.length && (
                    <small className="muted">
                      Тикеты не выбраны — ревью пройдёт без их содержимого.
                    </small>
                  )}
                </>
              ) : (
                <small className="muted">Связанных тикетов нет.</small>
              )}
            </div>
          )}
          <p className="muted">
            Сравнить код с описанием, критериями приёмки, обсуждением и заметками из Orbit.
            Изображения и файлы не анализируются. Если данные недоступны или превышают лимит, ревью
            остановится с объяснением.
          </p>
          <div className="review-memory-heading">Используемая память</div>
          <div className="review-memory-options" role="group" aria-label="Используемая память">
            {[
              { value: "general", label: "Общая", Icon: Globe },
              { value: "client", label: "Заказчика", Icon: Users },
              { value: "project", label: "Проекта", Icon: FolderOpen },
              { value: "project_review", label: "Ревью проекта", Icon: Sparkles },
            ].map(({ value, label, Icon }) => (
              <label className="check-option review-choice" key={value}>
                <input
                  type="checkbox"
                  checked={memoryScopes.includes(value)}
                  disabled={busy}
                  onChange={(event) =>
                    setMemoryScopes((previous) =>
                      event.target.checked
                        ? [...previous, value]
                        : previous.filter((scope) => scope !== value),
                    )
                  }
                />
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <small className="muted">
            Сначала передаются только названия; подробности ревьюер читает по необходимости. Память
            «Ревью проекта» используется только для ревью и не добавляется автоматически в чат.
            Можно отключить все разделы.
          </small>
        </fieldset>
        <div className="review-question-field">
          <div className="review-comment-heading">
            <label htmlFor={commentId}>
              <strong>Комментарий ревьюеру</strong>
            </label>
            <button
              type="button"
              className="icon-button review-comment-mic"
              disabled={busy}
              title="Продиктовать комментарий"
              aria-label="Продиктовать комментарий"
              onClick={() => requestFieldDictation(commentRef.current)}
            >
              <Mic size={16} />
            </button>
          </div>
          <textarea
            id={commentId}
            ref={commentRef}
            rows={3}
            maxLength={4000}
            value={reviewerComment}
            disabled={busy}
            onChange={(e) => setReviewerComment(e.target.value)}
            placeholder="Например: удели внимание обработке ошибок и обратной совместимости"
          />
          <small>Необязательно. Сохранится для повторной проверки после ответов на вопросы.</small>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button
            className="pr-review-launch"
            disabled={busy || (readTickets && ticketIds.length > 20)}
          >
            <Sparkles size={17} />
            {busy ? "Запускаю…" : "Запустить ревью"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
