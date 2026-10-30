import { useState } from "react";
import releases from "../../../shared/config/releases/index.js";
import type { TicketImageDiagnostic, TicketImageReason } from "../lib/ticket-image-preview.js";

const reasons: Record<TicketImageReason, string> = {
  empty_source: "У изображения нет адреса. Проверьте исходный комментарий в Azure.",
  invalid_url:
    "Не удалось разобрать адрес изображения или адрес коллекции. Проверьте подключение Azure и исходный комментарий.",
  temporary_blob:
    "В комментарии осталась временная ссылка blob. Она доступна только в браузере автора: изображение нужно прикрепить в Azure заново.",
  unprocessed_inline:
    "Встроенная картинка data:image не преобразована в локальное вложение. Заново загрузите деталку из Azure; если это не помогло, передайте диагностику.",
  missing_inline_metadata:
    "Встроенная картинка не найдена среди вложений карточки. Заново загрузите деталку из Azure или заново откройте деталку.",
  different_origin:
    "Адрес изображения не совпадает с сервером текущего подключения Azure. Проверьте адрес коллекции в настройках и исходное изображение в Azure.",
  different_collection:
    "Путь изображения не соответствует коллекции карточки. Проверьте подключение Azure; если коллекция верна, передайте диагностику.",
  unsupported_path:
    "Ссылка не распознана как вложение Azure. Откройте исходное изображение в Azure и передайте диагностику.",
  missing_attachment:
    "Ссылка найдена, но вложение отсутствует в метаданных карточки. Заново загрузите деталку из Azure или заново откройте деталку.",
  not_image:
    "Вложение найдено, но не распознано как изображение. Проверьте его формат в Azure и передайте диагностику.",
  unmapped_source:
    "Не удалось сопоставить изображение с метаданными комментария. Заново загрузите деталку из Azure и передайте диагностику, если ошибка повторяется.",
};

export function TicketImageUnavailable({ diagnostic }: { diagnostic: TicketImageDiagnostic }) {
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState("");
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
          <span style={{ display: "block" }}>{reasons[diagnostic.reason]}</span>
          <span style={{ display: "block" }}>
            Причина: <code>{diagnostic.reason}</code>
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
                  JSON.stringify({ ...diagnostic, version: releases[0].version }, null, 2),
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
