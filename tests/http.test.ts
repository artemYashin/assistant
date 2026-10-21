import test from "node:test";
import assert from "node:assert/strict";
import { requestJson } from "../server/http.js";

test("upstream failures provide diagnostics without exposing credentials or raw bodies", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) =>
    logs.push(JSON.stringify(args)),
  );
  for (const [response, expected] of [
    [
      new Response("<html><script>SECRET</script>Access blocked</html>", {
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

test("opt-in Azure JSON diagnostics expose only the sanitized message without retrying writes", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logs.push(JSON.stringify(args)));
  const pat = "private-pat-value";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({
      message: `Invalid firstComparingIteration. ${pat} token=secret-query`,
      innerException: { message: "private-inner-detail" },
    }, { status: 400 });
  });
  await assert.rejects(requestJson("https://ado.test", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(":" + pat).toString("base64") },
  }, "Комментарий Azure PR", { includeErrorMessage: true }), (error: any) => {
    assert.equal(error.upstreamStatus, 400);
    assert.match(error.message, /Invalid firstComparingIteration/);
    for (const secret of [pat, "secret-query", "private-inner-detail"])
      assert.ok(!error.message.includes(secret));
    return true;
  });
  assert.equal(calls, 1);
  assert.ok(!logs.join("").includes(pat));
});

test("HTML error logs include readable text and redact secrets", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) =>
    logs.push(JSON.stringify(args)),
  );
  const pat = "private-pat-value";
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        "<html><title>Access denied</title><script>script-secret</script><style>style-secret</style>" +
          '<input value="hidden-secret"><p>Contact your administrator &amp; check VPN.</p>' +
          "<p>" +
          pat +
          " token=other-secret https://login.test/?code=url-secret</p></html>",
        { status: 403, headers: { "Content-Type": "text/html" } },
      ),
  );
  await assert.rejects(
    requestJson("https://ado.test", {
      headers: {
        Authorization: "Basic " + Buffer.from(":" + pat).toString("base64"),
      },
    }),
    /HTTP 403/,
  );
  assert.match(logs[0], /Access denied/);
  assert.match(logs[0], /Contact your administrator & check VPN/);
  for (const secret of [
    pat,
    "script-secret",
    "style-secret",
    "hidden-secret",
    "other-secret",
    "url-secret",
  ])
    assert.ok(!logs[0].includes(secret), secret);
});

test("HTML preview is bounded and marks truncation", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) =>
    logs.push(JSON.stringify(args)),
  );
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response("<p>" + "x".repeat(100000), {
        headers: { "Content-Type": "text/html" },
      }),
  );
  await assert.rejects(requestJson("https://ado.test"), /HTML/);
  assert.match(logs[0], /обрезано/);
  assert.ok(logs[0].length < 7000);
});
