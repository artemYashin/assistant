import { randomUUID } from "node:crypto";
import { AppError } from "./store.js";
export async function requestJson(
  url: string,
  init: RequestInit = {},
  service = "Сервис",
): Promise<any> {
  const fail = (
    kind: string,
    message: string,
    response?: Response,
    code?: string,
  ): never => {
    const reference = randomUUID();
    // Never log request headers, query strings, response bodies or exception messages.
    console.error(
      "[upstream]",
      JSON.stringify({
        reference,
        service,
        host: new URL(url).hostname,
        kind,
        status: response?.status,
        format: response?.headers.get("content-type")?.includes("json")
          ? "json"
          : response?.headers.get("content-type")?.includes("html")
            ? "html"
            : "other",
        code: code && /^[A-Z_0-9]{1,60}$/.test(code) ? code : undefined,
      }),
    );
    throw new AppError(
      502,
      `${service}: ${message} Код диагностики: ${reference}`,
    );
  };
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: init.signal || AbortSignal.timeout(30000),
    });
  } catch (error) {
    const code = (error as any)?.cause?.code || (error as any)?.code;
    return fail(
      "connection",
      "Нет соединения или сервер требует перенаправление. Проверьте API-адрес, VPN, сертификаты и корпоративный прокси.",
      undefined,
      typeof code === "string" ? code : undefined,
    );
  }
  if (!response.ok) {
    return fail(
      "http",
      `HTTP ${response.status}. Проверьте URL организации/коллекции, имя проекта, права PAT и версию API.`,
      response,
    );
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.toLowerCase().includes("text/html")) {
    return fail(
      "html",
      "Вместо JSON API вернул HTML (возможно, страницу входа или корпоративного прокси). Проверьте API-адрес и способ доступа.",
      response,
    );
  }
  try {
    return await response.json();
  } catch {
    return fail(
      "invalid_json",
      "Сервер вернул некорректный JSON. Проверьте API-адрес и корпоративный прокси.",
      response,
    );
  }
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
