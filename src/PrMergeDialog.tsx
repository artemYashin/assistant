import { useEffect, useRef, useState } from "react";
import { GitMerge, LoaderCircle, X } from "lucide-react";
import { api } from "./api.js";
import { SingleSelect } from "./SingleSelect.js";

type Plan = {
  id: string;
  title: string;
  head: string;
  target: string;
  tickets: { id: number; state: string; states: string[] }[];
};
export function PrMergeDialog({
  pr,
  moveTickets,
  onClose,
}: {
  pr: any;
  moveTickets: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [plan, setPlan] = useState<Plan | null>(null),
    [states, setStates] = useState<Record<number, string>>({});
  const [strategy, setStrategy] = useState("noFastForward"),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const [result, setResult] = useState<any>(null),
    [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    let live = true;
    api("/pr/merge/prepare", "POST", {
      monitor: pr.monitor,
      repo: pr.repo,
      number: pr.number,
      moveTickets,
    })
      .then((p) => {
        if (!live) return;
        setPlan(p);
        setStates(
          Object.fromEntries(
            p.tickets.map((t: any) => [
              t.id,
              t.states.find((s: string) => s.toLowerCase() === "resolved") ||
                "",
            ]),
          ),
        );
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
  }, [pr.monitor, pr.repo, pr.number, moveTickets]);
  async function submit() {
    if (!plan || submitted) return;
    setBusy(true);
    setError("");
    setSubmitted(true);
    try {
      setResult(
        await api(`/pr/merge/${plan.id}`, "POST", {
          strategy,
          tickets: plan.tickets.map((t) => ({ id: t.id, state: states[t.id] })),
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
          <GitMerge size={18} />{" "}
          {moveTickets ? "Merge и смена статусов" : "Merge"} · PR #{pr.number}
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
      <p>{plan?.title || pr.title}</p>
      <p className="muted">
        {moveTickets
          ? "После подтверждённого merge выбранные статусы изменятся в Azure DevOps."
          : "Будет выполнен только merge. Статусы связанных тикетов останутся без изменений."}{" "}
        Исходная ветка сохранится. Политики репозитория применяются.
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
        <>
          <SingleSelect
            label="Способ слияния"
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
          {moveTickets && (
            <>
              <h3>Связанные тикеты · {plan.tickets.length}</h3>
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
                  options={common.map((s) => ({ value: s, label: s }))}
                />
              )}
              {!plan.tickets.length && (
                <p className="muted">
                  Связанных тикетов нет — будет выполнен только merge.
                </p>
              )}
              {plan.tickets.map((t) => (
                <div className="pr-merge-ticket" key={t.id}>
                  <strong>
                    #{t.id} <small>Сейчас: {t.state}</small>
                  </strong>
                  <SingleSelect
                    label={`Новый статус #${t.id}`}
                    value={states[t.id] || ""}
                    onChange={(s) =>
                      setStates((old) => ({ ...old, [t.id]: s }))
                    }
                    disabled={busy}
                    options={t.states.map((s) => ({ value: s, label: s }))}
                  />
                </div>
              ))}
              <p className="muted">
                Resolved предлагается только там, где этот статус существует.
                Перед слиянием проверяются коммиты и список тикетов.
              </p>
            </>
          )}
          <button
            className="primary"
            disabled={busy || plan.tickets.some((t) => !states[t.id])}
            onClick={() => void submit()}
          >
            <GitMerge size={17} /> Подтвердить merge
            {plan.tickets.length ? " и смену статусов" : ""}
          </button>
        </>
      )}
      {result && (
        <section role="status" className="pr-merge-result">
          <h3>
            {result.status === "completed"
              ? moveTickets && plan?.tickets.length
                ? "Готово: merge и статусы подтверждены"
                : "Готово: merge подтверждён"
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
              #{t.id} → {t.state}:{" "}
              {t.success ? "подтверждено" : t.error || "не подтверждено"}
            </p>
          ))}
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
