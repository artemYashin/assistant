import { AppError } from "./store.js";
export async function requestJson(
  url: string,
  init: RequestInit = {},
  service = "Сервис",
): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: init.signal || AbortSignal.timeout(30000),
    });
  } catch {
    throw new AppError(
      502,
      `${service}: нет соединения. Проверьте адрес, VPN и сертификаты.`,
    );
  }
  if (!response.ok) {
    const retry = response.headers.get("retry-after");
    throw new AppError(
      502,
      `${service}: HTTP ${response.status}${response.status === 429 ? `, повторите через ${retry || "60"} с` : ""}. Проверьте доступ и настройки.`,
    );
  }
  return response.json();
}
export function azureBase(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(400, "Укажите корректный URL Azure DevOps");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new AppError(
      400,
      "Azure DevOps: нужен HTTPS URL организации или коллекции без пароля, query и fragment",
    );
  return url.href.replace(/\/$/, "");
}
