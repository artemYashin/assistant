import { useState } from "react";
import releases from "../../../shared/config/releases/index.js";
import type { PrImageReason } from "../lib/pr-image-diagnostic.js";
import { prImageReasons, safePrImageDiagnostic } from "../lib/pr-image-diagnostic.js";

export function PrImageUnavailable({
  diagnostic,
  fallback,
}: {
  diagnostic?: unknown;
  fallback: PrImageReason;
}) {
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState("");
  const safe = safePrImageDiagnostic(diagnostic, fallback);
  return (
    <span style={{ display: "inline-block", maxWidth: "100%" }}>
      <span>Изображение · предпросмотр недоступен </span>
      <button
        type="button"
        className="secondary compact"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Почему не видно?
      </button>
      {open && (
        <span style={{ display: "block", padding: "8px 0", maxWidth: 600 }}>
          <span style={{ display: "block" }}>{prImageReasons[safe.reason]}</span>
          <span style={{ display: "block" }}>
            Причина: <code>{safe.reason}</code>
          </span>
          <span style={{ display: "block", margin: "6px 0" }}>
            Запрос изображения ещё не отправлялся. Это не проверка прав доступа в Azure.
          </span>
          <button
            type="button"
            className="secondary compact"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  JSON.stringify({ ...safe, version: releases[0].version }, null, 2),
                );
                setCopyState("Диагностика скопирована");
              } catch {
                setCopyState("Не удалось скопировать диагностику");
              }
            }}
          >
            Скопировать диагностику
          </button>
          <span role="status" style={{ display: "block" }}>
            {copyState}
          </span>
        </span>
      )}
    </span>
  );
}
