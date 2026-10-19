let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      "X-Orbit-Request": "1",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body === undefined
      ? {}
      : { body: isForm ? body : JSON.stringify(body) }),
  });
  const data = await response
    .json()
    .catch(() => ({ error: "Сервер вернул некорректный ответ" }));
  if (!response.ok)
    throw new Error(
      data.error + (data.fields ? `: ${data.fields.join("; ")}` : ""),
    );
  return data;
}
