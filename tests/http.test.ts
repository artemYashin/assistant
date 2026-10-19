import test from "node:test";
import assert from "node:assert/strict";
import { requestJson } from "../server/http.js";

test("upstream failures provide diagnostics without exposing credentials or bodies", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) =>
    logs.push(JSON.stringify(args)),
  );
  for (const [response, expected] of [
    [
      new Response("<html>SECRET</html>", {
        headers: { "Content-Type": "text/html" },
      }),
      /HTML/,
    ],
    [
      new Response("SECRET", {
        headers: { "Content-Type": "application/json" },
      }),
      /JSON/,
    ],
    [new Response("SECRET", { status: 403 }), /HTTP 403/],
  ] as const) {
    t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(
      requestJson(
        "https://ado.test/Collection?token=SECRET",
        {
          headers: { Authorization: "Basic SECRET" },
        },
        "Azure DevOps",
      ),
      (error: any) => {
        assert.equal(error.status, 502);
        assert.match(error.message, expected);
        assert.match(error.message, /Код диагностики:/);
        assert.ok(!error.message.includes("SECRET"));
        return true;
      },
    );
  }
  t.mock.method(globalThis, "fetch", async () => {
    throw Object.assign(new Error("SECRET"), { cause: { code: "ENOTFOUND" } });
  });
  await assert.rejects(requestJson("https://ado.test"), /Нет соединения/);
  assert.equal(logs.length, 4);
  assert.ok(logs.some((line) => line.includes("ENOTFOUND")));
  assert.ok(logs.every((line) => !line.includes("SECRET")));
});
test("JSON API responses still load normally", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ value: [] }));
  assert.deepEqual(await requestJson("https://ado.test"), { value: [] });
});
