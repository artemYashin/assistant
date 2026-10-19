import { randomUUID } from "node:crypto";
import { AppError } from "./store.js";
// Read only a bounded prefix, including when an upstream streams a large error page.
async function htmlPreview(response: Response, init: RequestInit) {
  const reader = response.body?.getReader();
  if (!reader) return "(пустой ответ)";
  const decoder = new TextDecoder();
  let html = "",
    bytes = 0;
  try {
    while (bytes < 65536) {
      const { value, done } = await reader.read();
      if (done) break;
      const part = value.subarray(0, 65536 - bytes);
      html += decoder.decode(part, { stream: true });
      bytes += part.length;
    }
    html += decoder.decode();
  } catch {
    // Keep the available prefix if the response stream fails.
  } finally {
    void reader.cancel().catch(() => {});
  }
  let text = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(
      /<(script|style|noscript|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,
      "",
    )
    .replace(/<[^>]*(?:>|$)/g, " ")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, code: string) => {
      const value =
        code[0].toLowerCase() === "x"
          ? parseInt(code.slice(1), 16)
          : Number(code);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
  const authorization = new Headers(init.headers).get("authorization") || "";
  const credential = authorization.replace(/^(Basic|Bearer)\s+/i, "");
  const secrets = [authorization, credential];
  if (/^Basic /i.test(authorization)) {
    const decoded = Buffer.from(credential, "base64").toString("utf8");
    secrets.push(decoded, decoded.slice(decoded.indexOf(":") + 1));
  }
  for (const secret of secrets
    .filter(Boolean)
    .sort((a, b) => b.length - a.length))
    text = text.split(secret).join("[REDACTED]");
  text = text
    .replace(/https?:\/\/[^\s<>"']+/gi, (url) => url.split(/[?#]/)[0])
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(
      /\b(access_token|refresh_token|id_token|password|client_secret|token|code)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[REDACTED]",
    )
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const truncated = bytes >= 65536 || text.length > 6000;
  return (
    (text.slice(0, 6000) || "(нет видимого текста)") +
    (truncated ? " [обрезано]" : "")
  );
}
export async function requestJson(
  url: string,
  init: RequestInit = {},
  service = "Сервис",
): Promise<any> {
  let pageText: string | undefined;
  const fail = (
    kind: string,
    message: string,
    response?: Response,
    code?: string,
  ): never => {
    const reference = randomUUID();
    // Never log raw headers, bodies or exception messages; only sanitized HTML text.
    console.error(
      "[upstream]",
      JSON.stringify({
        reference,
        service,
        host: new URL(url).hostname,
        kind,
        status: response?.status,
        pageText,
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
  const contentType = response.headers.get("content-type") || "";
  if (contentType.toLowerCase().includes("text/html"))
    pageText = await htmlPreview(response, init);
  if (!response.ok) {
    return fail(
      "http",
      `HTTP ${response.status}. Проверьте URL организации/коллекции, имя проекта, права PAT и версию API.`,
      response,
    );
  }
  if (pageText !== undefined) {
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
