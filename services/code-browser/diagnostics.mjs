export function gitDiagnostic(stderr, env = {}, command, code, signal) {
  let detail = stderr;
  const authorization = env.GIT_CONFIG_VALUE_0 || "";
  const encoded = authorization.replace(/^Authorization: Basic /i, "");
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const secrets = [authorization, encoded, decoded, decoded.slice(decoded.indexOf(":") + 1)]
    .filter((s) => s.length > 2)
    .sort((a, b) => b.length - a.length);
  for (const secret of secrets) detail = detail.split(secret).join("[скрыто]");
  detail = detail
    .replace(/https?:\/\/[^\s<>"']+/gi, "[URL скрыт]")
    .replace(/\b(Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [скрыто]")
    .replace(/\b(password|token|pat|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[скрыто]")
    // eslint-disable-next-line no-control-regex -- Remove control bytes from untrusted input/output.
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    // eslint-disable-next-line no-control-regex -- Remove control bytes from untrusted input/output.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .split(/[\r\n]+/)
    .filter(
      (line) =>
        line.trim() &&
        !/^(?:remote: )?(Counting|Compressing|Receiving|Resolving|Unpacking|Enumerating) objects:|^(?:remote: )?Resolving deltas:/.test(
          line,
        ),
    )
    .slice(-8)
    .join("\n")
    .slice(-2000);
  let reason = "Git не выполнил операцию.";
  if (/401|403|authentication failed|could not read Username|access denied/i.test(stderr))
    reason = "Azure отклонил доступ. Проверьте PAT Code Read и право Read на репозиторий.";
  else if (/certificate|SSL peer|unable to get local issuer/i.test(stderr))
    reason =
      "Git не смог проверить TLS-сертификат сервера. Проверьте корпоративный сертификат в контейнере.";
  else if (/could not resolve|failed to connect|connection refused/i.test(stderr))
    reason = "Контейнер не смог подключиться к Azure. Проверьте сеть, VPN и DNS.";
  else if (/redirect|redirection/i.test(stderr))
    reason = "Сервер перенаправляет Git-запрос. Проверьте конечный URL организации/коллекции.";
  else if (/no space left|disk quota/i.test(stderr))
    reason = "В Docker закончилось место для кеша репозитория.";
  else if (
    /out of memory|cannot allocate memory|signal 9|killed/i.test(stderr) ||
    signal === "SIGKILL"
  )
    reason = "Процесс Git был остановлен; возможна нехватка памяти контейнера.";
  else if (/shallow.*not supported|does not support shallow/i.test(stderr))
    reason = "Сервер не поддерживает загрузку ограниченной истории Git.";
  else if (/couldn't find remote ref|not our ref/i.test(stderr))
    reason = "Ветка или её коммит недоступны на сервере. Обновите список веток.";
  else if (/early EOF|RPC failed|unexpected disconnect|remote end hung up/i.test(stderr))
    reason = "Передача Git-данных оборвалась. Проверьте соединение/VPN и ответ сервера ниже.";
  const operation = [
    "fetch",
    "ls-remote",
    "init",
    "rev-parse",
    "update-ref",
    "ls-tree",
    "cat-file",
    "check-ref-format",
    "merge-base",
    "rev-list",
    "rg",
  ].includes(command)
    ? command
    : "Git";
  return `${reason} Операция: ${operation}; код: ${Number.isInteger(code) ? code : "нет"}${signal ? `; сигнал: ${signal}` : ""}.${detail ? `\n${detail}` : ""}`;
}
