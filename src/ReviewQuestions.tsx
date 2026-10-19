import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api.js";
import { pullRequestPath } from "./routing.js";
export function ReviewQuestionInbox({
  items,
  onChange,
}: {
  items: any[];
  onChange: () => void;
}) {
  return (
    <div className="card-list">
      {items.map((item) => (
        <QuestionBatch key={item.id} item={item} onChange={onChange} />
      ))}
    </div>
  );
}
function QuestionBatch({
  item,
  onChange,
}: {
  item: any;
  onChange: () => void;
}) {
  const [answers, setAnswers] = useState<string[]>(
    item.questions.map((_: any, i: number) => item.answers[i] || ""),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = item.status === "pending";
  async function submit(dismiss = false) {
    setBusy(true);
    setError("");
    try {
      await api(
        `/review-questions/${item.id}/${dismiss ? "dismiss" : "answers"}`,
        "POST",
        dismiss ? {} : { answers },
      );
      onChange();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="panel review-questions">
      <div className="section-heading">
        <h2>Вопросы к PR #{item.number}</h2>
        <span className="ticket-state-badge">
          {pending
            ? "Нужны ответы"
            : item.status === "answered"
              ? "Ответы отправлены"
              : item.status === "outdated"
                ? "Версия PR изменилась"
                : "Вопросы проигнорированы"}
        </span>
      </div>
      <p>
        {item.title} · {item.client} / {item.project}
      </p>
      <Link className="chat-ticket-link" to={pullRequestPath(item)}>
        Перейти к PR #{item.number}
      </Link>
      <p className="muted">
        Ответьте на все вопросы, затем отправьте весь набор. Только после этого
        начнётся повторное ревью. Если ответа нет, напишите «Не знаю». Ответы
        сохраняются для этого ревью. Можно проигнорировать вопросы и завершить
        ревью без нового вызова модели.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {item.questions.map((q: any, i: number) => (
          <label key={i} className="review-question-field">
            <strong>
              {i + 1}. {q.question}
            </strong>
            <small>{q.reason}</small>
            <textarea
              required
              maxLength={2000}
              rows={3}
              value={pending ? answers[i] : item.answers[i] || ""}
              disabled={busy || !pending}
              onChange={(e) =>
                setAnswers((old) =>
                  old.map((v, j) => (i === j ? e.target.value : v)),
                )
              }
            />
          </label>
        ))}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {pending && (
          <div className="card-actions">
            <button
              className="primary"
              disabled={busy || answers.some((a) => !a.trim())}
            >
              {busy ? "Сохраняю…" : "Отправить все ответы и повторить ревью"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void submit(true)}
            >
              Игнорировать вопросы и завершить ревью
            </button>
          </div>
        )}
      </form>
    </article>
  );
}
