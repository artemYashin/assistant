import { ExternalLink, LoaderCircle } from "lucide-react";

export function LoginCode({ flow }: any) {
  if (!flow) return null;
  if (flow.status === "pending" && !flow.userCode)
    return <p role="status">Запрашиваем код входа…</p>;
  if (flow.status === "pending")
    return (
      <div className="device-code">
        <p>Откройте страницу авторизации и введите код:</p>
        <strong>{flow.userCode}</strong>
        <a
          href={flow.verificationUri?.startsWith("https://") ? flow.verificationUri : undefined}
          target="_blank"
          rel="noreferrer"
        >
          Открыть авторизацию <ExternalLink size={15} />
        </a>
        <small>
          <LoaderCircle className="spin" size={13} />
          Ожидаем завершения входа…
        </small>
      </div>
    );
  return (
    <div className={flow.status === "connected" ? "success-note" : "error"}>
      {flow.status === "connected"
        ? "Вход выполнен."
        : flow.error || "Код истёк. Запустите вход заново."}
    </div>
  );
}
