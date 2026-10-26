import test from "node:test";
import assert from "node:assert/strict";
import { gitDiagnostic } from "./diagnostics.mjs";
test("diagnostics classify Git failure and redact credentials and URLs", () => {
  const token = "private-PAT-123456",
    encoded = Buffer.from(":" + token).toString("base64");
  const message = gitDiagnostic(
    `Receiving objects: 40%\rfatal: RPC failed https://user:${token}@azure.test/repo\nAuthorization: Basic ${encoded}\n${token}`,
    { GIT_CONFIG_VALUE_0: `Authorization: Basic ${encoded}` },
    "fetch",
    128,
    null,
  );
  assert.match(message, /оборвалась/);
  assert.match(message, /fetch; код: 128/);
  for (const secret of [token, encoded, "azure.test", "Receiving objects"])
    assert.ok(!message.includes(secret));
});
test("diagnostics distinguish certificate and memory errors", () => {
  assert.match(gitDiagnostic("fatal: SSL certificate problem", {}, "fetch", 128), /TLS/);
  assert.match(gitDiagnostic("index-pack died of signal 9", {}, "fetch", 128), /памяти/);
});
