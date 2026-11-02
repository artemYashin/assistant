export const prImageReasons = {
  empty_source: "В описании PR у картинки нет адреса.",
  invalid_url: "Не удалось разобрать адрес картинки или подключения Azure.",
  unsupported_protocol:
    "Адрес картинки не использует HTTPS. Локальное превью разрешено только для вложений Azure.",
  credentials_in_url:
    "В адресе картинки или подключения указаны имя пользователя или пароль. Такой адрес не используется для загрузки.",
  different_origin:
    "Сервер картинки не совпадает с подключением PR или его точным адресом через MCAS. Проверьте подключение репозитория.",
  different_collection:
    "Коллекция в пути картинки не совпадает с подключением этого PR. Проверьте подключение репозитория.",
  invalid_path: "Путь картинки содержит недопустимые символы или сегменты.",
  unsupported_path:
    "Путь не распознан как вложение Azure Work Item или pull request. Передайте код причины для проверки этого формата ссылки.",
  different_project: "Изображение является вложением PR из другого проекта.",
  different_repository: "Изображение является вложением PR из другого репозитория.",
  different_pr: "Изображение является вложением другого pull request.",
  temporary_blob:
    "В описании осталась временная ссылка blob из браузера автора. Прикрепите изображение к PR в Azure заново.",
  invalid_inline:
    "Встроенное изображение повреждено, имеет неподдерживаемый формат или превышает допустимый размер.",
  missing_metadata:
    "Сервер не вернул список изображений PR. Обновите приложение и заново откройте описание.",
  unmapped_source:
    "Адрес картинки при отображении не совпал со списком изображений PR. Передайте диагностику для проверки преобразования адреса.",
  missing_diagnostic:
    "Сервер отклонил превью, но не передал причину. Обновите приложение и заново откройте описание PR.",
  invalid_preview:
    "Сервер вернул неподдерживаемый адрес локального превью. Прямая загрузка из Azure не выполняется.",
};

export type PrImageReason = keyof typeof prImageReasons;
export type PrImageDiagnostic = {
  scope: "pr";
  format: 1;
  stage: "before_request";
  reason: PrImageReason;
};

export function safePrImageDiagnostic(value: unknown, fallback: PrImageReason): PrImageDiagnostic {
  const candidate =
    value && typeof value === "object" ? (value as Partial<PrImageDiagnostic>) : null;
  const reason =
    candidate?.scope === "pr" &&
    typeof candidate.reason === "string" &&
    Object.hasOwn(prImageReasons, candidate.reason)
      ? candidate.reason
      : fallback;
  // Explicit allowlist: never spread arbitrary API properties into clipboard reports.
  return { scope: "pr", format: 1, stage: "before_request", reason };
}
