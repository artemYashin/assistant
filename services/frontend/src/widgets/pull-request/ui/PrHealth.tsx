import { useState } from "react";
import { PrCiDialog } from "./PrCiDialog.js";
import { PrInfoPopup } from "../../../shared/ui/info-popup/index.js";
import { AlertTriangle, CheckCircle2, Clock, Workflow } from "lucide-react";
export function PrHealth({
  value,
  inScope,
  pr,
  onUpdated,
}: {
  value?: string;
  inScope: boolean;
  pr?: any;
  onUpdated?: () => void;
}) {
  const [ciOpen, setCiOpen] = useState(false);
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
  const [label, tone] = merge[health?.merge] || ["Конфликты: нет данных", "is-idle"];
  const checks: any[] = Array.isArray(health?.checks) ? health.checks : [];
  const builds = checks.filter((c) => c.build && c.state !== "notApplicable");
  const failed = builds.some((c) => ["rejected", "broken"].includes(c.state));
  const pending = builds.some((c) => ["queued", "running"].includes(c.state));
  const passed = builds.length > 0 && builds.every((c) => c.state === "approved");
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
  return (
    <>
      <PrInfoPopup
        title="Конфликты слияния"
        className="pr-health-trigger"
        trigger={
          <>
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
          </>
        }
      >
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
        <p className={`pr-review-status ${tone}`}>{label}</p>
        <p className="muted">
          Статус возможности слияния веток, полученный из Azure при последней синхронизации.
        </p>
      </PrInfoPopup>
      <button
        type="button"
        className="pr-health-trigger"
        title="Подробности CI"
        aria-label="Подробности CI"
        onClick={() => setCiOpen(true)}
      >
        <span
          className={`pr-review-status ${!inScope || health?.error ? "is-idle" : failed ? "is-error" : pending ? "is-pending" : passed ? "is-ready" : "is-idle"}`}
        >
          <Workflow size={13} />
          {health ? ci : "CI: нет данных"}
        </span>
      </button>
      {ciOpen && pr && (
        <PrCiDialog pr={pr} onClose={() => setCiOpen(false)} onUpdated={onUpdated} />
      )}
    </>
  );
}
