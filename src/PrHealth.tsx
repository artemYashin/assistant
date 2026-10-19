import { ShieldCheck, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
export function PrHealth({
  value,
  inScope,
}: {
  value?: string;
  inScope: boolean;
}) {
  let health: any;
  try {
    health = value ? JSON.parse(value) : null;
  } catch {
    health = null;
  }
  const merge: Record<string, [string, string]> = {
    conflicts: ["Конфликты слияния", "is-error"],
    succeeded: ["Нет конфликтов", "is-ready"],
    queued: ["Проверка конфликтов", "is-pending"],
    rejectedByPolicy: ["Merge отклонён политикой", "is-error"],
    failure: ["Ошибка проверки merge", "is-error"],
  };
  const [label, tone] = merge[health?.merge] || [
    "Конфликты: нет данных",
    "is-idle",
  ];
  const checks: any[] = Array.isArray(health?.checks) ? health.checks : [];
  const builds = checks.filter((c) => c.build && c.state !== "notApplicable");
  const failed = builds.some((c) => ["rejected", "broken"].includes(c.state));
  const pending = builds.some((c) => ["queued", "running"].includes(c.state));
  const passed =
    builds.length > 0 && builds.every((c) => c.state === "approved");
  const ci = health?.error
    ? "CI: нет данных"
    : failed
      ? "CI: проверка не прошла"
      : pending
        ? "CI: ожидает / выполняется"
        : passed
          ? "CI: проверки пройдены"
          : builds.length
            ? "CI: состояние неизвестно"
            : "CI: нет проверок сборки";
  const status: Record<string, string> = {
    approved: "Пройдена",
    rejected: "Не пройдена",
    queued: "Ожидает",
    running: "Выполняется",
    notApplicable: "Не применяется",
    broken: "Ошибка проверки",
  };
  return (
    <details className="pr-content-section pr-health">
      <summary>
        <ShieldCheck size={17} aria-hidden="true" />
        Проверки Azure
        <span className={`pr-review-status ${inScope ? tone : "is-idle"}`}>
          {tone === "is-error" ? (
            <AlertTriangle size={13} />
          ) : tone === "is-ready" ? (
            <CheckCircle2 size={13} />
          ) : (
            <Clock size={13} />
          )}{" "}
          {label}
        </span>
        <span
          className={`pr-review-status ${!inScope || health?.error ? "is-idle" : failed ? "is-error" : pending ? "is-pending" : passed ? "is-ready" : "is-idle"}`}
        >
          {health ? ci : "CI: нет данных"}
        </span>
      </summary>
      {!inScope && (
        <p className="muted">
          PR вне текущей выборки. Здесь показаны последние сохранённые данные.
        </p>
      )}
      {health?.checkedAt && (
        <p className="muted">
          Синхронизация: {new Date(health.checkedAt).toLocaleString("ru-RU")}
        </p>
      )}
      {health?.error && <p className="error">{health.error}</p>}
      <p className="muted">
        CI показывает политики проверки сборки Azure. Успешный CI сам по себе не
        означает, что все условия merge выполнены.
      </p>
      {checks.map((c, i) => (
        <div className="pr-health-check" key={i}>
          <strong>{c.name}</strong>
          <span>
            {status[c.state] || "Неизвестно"}
            {c.required ? " · обязательная" : " · необязательная"}
          </span>
        </div>
      ))}
      {!checks.length && !health?.error && (
        <p>Проверки ещё не загружены или не настроены.</p>
      )}
    </details>
  );
}
