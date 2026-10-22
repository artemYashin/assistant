import { StatusBadge } from "./TicketControls.js";
import { useEffect, useRef, useState } from "react";
import { GitMerge, LoaderCircle, X, Ticket, ArrowRight, ShieldAlert } from "lucide-react";
import { api } from "./api.js";
import { SingleSelect } from "./SingleSelect.js";

type Plan = {
  id: string;
  title: string;
  head: string;
  target: string;
  tickets: { id: number; title?: string; state: string; states: string[] }[];
};
export function PrMergeDialog({
  pr,
  statusColors,
  onClose,
}: {
  pr: any;
  statusColors?: Record<string, string>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [moveTickets, setMoveTickets] = useState(false);
  const [bypassPolicy, setBypassPolicy] = useState(false);
  const [bypassReason, setBypassReason] = useState("");
  const [linkedIds, setLinkedIds] = useState<number[] | null>(null);
  const [linksError, setLinksError] = useState("");
  const [retry, setRetry] = useState(0);
  const [linksRetry, setLinksRetry] = useState(0);
  const [plan, setPlan] = useState<Plan | null>(null),
    [states, setStates] = useState<Record<number, string>>({});
  const [strategy, setStrategy] = useState("noFastForward"),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const [result, setResult] = useState<any>(null),
    [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let live = true;
    setLinkedIds(null);
    setLinksError("");
    api("/pr/merge/tickets", "POST", {
      monitor: pr.monitor,
      repo: pr.repo,
      number: pr.number,
    })
      .then((value) => {
        if (live) setLinkedIds(value.ids);
      })
      .catch((e) => {
        if (live) setLinksError(e.message);
      });
    return () => {
      live = false;
    };
  }, [pr.monitor, pr.repo, pr.number, linksRetry]);
  useEffect(() => {
    let live = true;
    setBusy(true);
    setPlan(null);
    setError("");
    api("/pr/merge/prepare", "POST", {
      monitor: pr.monitor,
      repo: pr.repo,
      number: pr.number,
      moveTickets,
    })
      .then((p) => {
        if (!live) return;
        setPlan(p);
        setStates(Object.fromEntries(p.tickets.map((t: any) => [t.id, ""])));
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [pr.monitor, pr.repo, pr.number, moveTickets, retry]);
  async function submit() {
    if (!plan || submitted || busy || (bypassPolicy && !bypassReason.trim()))
      return;
    setBusy(true);
    setError("");
    setSubmitted(true);
    try {
      setResult(
        await api(`/pr/merge/${plan.id}`, "POST", {
          strategy,
          bypassPolicy,
          bypassReason: bypassPolicy ? bypassReason.trim() : "",
          tickets: plan.tickets.map((t) => ({
            id: t.id,
            state: states[t.id] || null,
          })),
        }),
      );
    } catch (e: any) {
      setError(
        e.message +
          " Повторный merge не отправлен. Проверьте результат операции.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    if (!plan) return;
    setBusy(true);
    try {
      setResult(await api(`/pr/merge/${plan.id}`));
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const common = plan?.tickets.length
    ? plan.tickets[0].states.filter((s) =>
        plan.tickets.every((t) => t.states.includes(s)),
      )
    : [];
  return (
    <dialog
      ref={dialog}
      className="developer-dialog pr-merge-dialog"
      aria-labelledby="pr-merge-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="developer-dialog-heading">
        <strong id="pr-merge-title">
          <GitMerge size={18} /> Merge · PR #{pr.number}
        </strong>
        <button
          className="icon-button"
          aria-label="Закрыть"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="pr-merge-name">
        <span id="pr-merge-name-label">Название pull request</span>
        <div className="pr-merge-name-value" aria-labelledby="pr-merge-name-label">
          {plan?.title || pr.title || ""}
        </div>
      </div>
      <p className="muted">
        {moveTickets
          ? "После подтверждённого merge выбранные статусы изменятся в Azure DevOps."
          : "Будет выполнен только merge. Статусы связанных тикетов останутся без изменений."}{" "}
        Исходная ветка сохранится.{" "}
        {bypassPolicy
          ? "Запрошен обход политик репозитория."
          : "Политики репозитория применяются."}
      </p>
      {busy && (
        <p role="status">
          <LoaderCircle className="spin" size={16} />{" "}
          {submitted ? "Выполняется операция…" : "Загрузка…"}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {plan && !submitted && (
        <SingleSelect
          label="Способ слияния"
          searchable={false}
          value={strategy}
          onChange={setStrategy}
          disabled={busy}
          options={[
            { value: "noFastForward", label: "Merge commit" },
            { value: "squash", label: "Squash" },
            { value: "rebase", label: "Rebase и fast-forward" },
            { value: "rebaseMerge", label: "Rebase с merge commit" },
          ]}
        />
      )}
      {!submitted && (
        <div className="pr-merge-options">
          <section className="pr-merge-option-block">
            <label className="pr-merge-toggle">
              <input
                type="checkbox"
                checked={bypassPolicy}
                disabled={busy}
                onChange={(event) => setBypassPolicy(event.target.checked)}
              />
              <span>
                <strong><ShieldAlert size={16} />Обойти проверки и политики Azure</strong>
                <small>
                  Требуется право Bypass policies when completing pull requests.
                  CI должен пройти успешно; конфликты кода тоже нужно разрешить.
                </small>
              </span>
            </label>
            {bypassPolicy && (
              <label className="pr-bypass-reason">
                Причина обхода политик
                <textarea
                  aria-label="Причина обхода политик"
                  rows={3}
                  maxLength={2000}
                  required
                  value={bypassReason}
                  disabled={busy}
                  onChange={(event) => setBypassReason(event.target.value)}
                  placeholder="Почему PR нужно завершить без прохождения проверок"
                />
              </label>
            )}
          </section>
          <section className="pr-merge-option-block">
            <label
              className={`pr-merge-toggle ${!linkedIds?.length ? "is-disabled" : ""}`}
              title={
                linkedIds?.length === 0
                  ? "Привяжите сначала тикет"
                  : linksError
                    ? "Не удалось проверить связанные тикеты"
                    : linkedIds === null
                      ? "Проверяем связанные тикеты…"
                      : ""
              }
            >
              <input
                type="checkbox"
                checked={moveTickets}
                disabled={busy || !linkedIds?.length}
                onChange={(e) => {
                  setMoveTickets(e.target.checked);
                  setPlan(null);
                  setBusy(true);
                }}
              />
              <span>
                <strong><Ticket size={16} />Сменить статусы связанных тикетов</strong>
                <small>
                  {linkedIds?.length
                    ? `Связано тикетов: ${linkedIds.length}`
                    : linkedIds?.length === 0
                      ? "Привяжите сначала тикет"
                      : "Проверка связей с Azure…"}
                </small>
              </span>
            </label>
            {linksError && (
              <p className="error" role="alert">
                {linksError}{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setLinksRetry((v) => v + 1)}
                >
                  Повторить проверку связей
                </button>
              </p>
            )}
            {moveTickets && plan && (
              <section className="pr-merge-tickets">
                <h3>
                  <Ticket size={18} /> Связанные тикеты · {plan.tickets.length}
                </h3>
                {!!common.length && (
                  <SingleSelect
                    label="Применить статус ко всем"
                    value=""
                    onChange={(s) =>
                      setStates(
                        Object.fromEntries(plan.tickets.map((t) => [t.id, s])),
                      )
                    }
                    disabled={busy}
                    options={[
                      { value: "", label: "Не менять статус" },
                      ...common.map((s) => ({ value: s, label: s })),
                    ]}
                  />
                )}
                {!plan.tickets.length && (
                  <p className="muted">
                    Связанных тикетов нет — будет выполнен только merge.
                  </p>
                )}
                <ul className="pr-merge-ticket-list">
                  {plan.tickets.map((t) => (
                    <li className="pr-merge-ticket" key={t.id}>
                      <div className="pr-merge-ticket-heading">
                        <span className="pr-merge-ticket-id"><Ticket size={14} aria-hidden="true" />#{t.id}</span>
                        <strong>{t.title || "Тикет"}</strong>
                      </div>
                      <p className="pr-merge-current-state">
                        <span>Сейчас:</span>
                        <StatusBadge state={t.state} colors={statusColors} />
                        <ArrowRight size={15} aria-hidden="true" />
                        {states[t.id] ? <StatusBadge state={states[t.id]} colors={statusColors} /> : <span className="muted">Без изменений</span>}
                      </p>
                      <SingleSelect
                        label={`Новый статус #${t.id}`}
                        value={states[t.id] || ""}
                        onChange={(s) =>
                          setStates((old) => ({ ...old, [t.id]: s }))
                        }
                        disabled={busy}
                        options={[
                          { value: "", label: "Не менять статус" },
                          ...t.states.map((s) => ({ value: s, label: s })),
                        ]}
                      />
                    </li>
                  ))}
                </ul>
                <p className="muted">
                  По умолчанию статусы не меняются. Выберите новый статус только
                  для нужных тикетов. Перед слиянием проверяются коммиты и
                  список тикетов.
                </p>
              </section>
            )}
          </section>
        </div>
      )}
      {!busy && !plan && !submitted && (
        <button className="secondary" onClick={() => setRetry((v) => v + 1)}>
          Повторить подготовку
        </button>
      )}
      {plan && !submitted && (
        <>
          <button
            className="primary"
            disabled={busy || (bypassPolicy && !bypassReason.trim())}
            onClick={() => void submit()}
          >
            <GitMerge size={17} />{" "}
            {bypassPolicy
              ? "Подтвердить merge с обходом политик"
              : "Подтвердить merge"}
            {plan.tickets.some((t) => !!states[t.id])
              ? " и смену выбранных статусов"
              : ""}
          </button>
        </>
      )}
      {result && (
        <section role="status" className="pr-merge-result">
          <h3>
            {result.status === "completed"
              ? moveTickets && plan?.tickets.some((t) => !!states[t.id])
                ? "Готово: merge и статусы подтверждены"
                : "Готово: merge подтверждён"
              : result.status === "rejected"
                ? "Merge отклонён: после исправления прав можно повторить"
                : result.status === "partial"
                  ? "PR смержен, часть статусов не обновлена"
                  : result.status === "prepared"
                    ? "Запрос не был выполнен. Закройте диалог и откройте заново."
                    : result.merged
                      ? "Merge подтверждён, обработка тикетов"
                      : "Merge пока не подтверждён"}
          </h3>
          {result.message && <p>{result.message}</p>}
          {result.tickets?.map((t: any) => (
            <p key={t.id}>
              #{t.id} ·{" "}
              {t.skipped
                ? "Статус не менялся"
                : `${t.state}: ${t.success ? "подтверждено" : t.error || "не подтверждено"}`}
            </p>
          ))}
          {result.status === "rejected" && result.retryable && (
            <button className="secondary" onClick={onClose}>
              Закрыть диалог
            </button>
          )}
          {result.status === "partial" && (
            <p>
              Повторный merge не нужен. Исправьте оставшиеся статусы через
              карточки тикетов.
            </p>
          )}
        </section>
      )}
      {submitted && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void check()}
        >
          Проверить результат операции
        </button>
      )}
    </dialog>
  );
}
