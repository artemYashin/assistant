import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { policyChecks } from "../server/pr-health.js";
import { PrHealth } from "../src/PrHealth.js";
test("health follows evaluation status, not internal build context flags", () => {
  const checks = policyChecks([
    {
      status: "rejected",
      configuration: {
        isBlocking: true,
        type: { displayName: "Build" },
        settings: { buildDefinitionId: 12 },
      },
    },
    {
      status: "approved",
      context: { isExpired: true },
      configuration: { settings: { buildDefinitionId: 13 } },
    },
    {
      status: "rejected",
      configuration: { type: { displayName: "Reviewers" } },
    },
    { status: "rejected", configuration: { isEnabled: false } },
  ]);
  assert.equal(checks.length, 3);
  assert.ok(checks[0].build);
  assert.equal(checks[1].state, "approved");
  assert.equal(checks[2].build, false);
  const html = renderToStaticMarkup(
    createElement(PrHealth, {
      value: JSON.stringify({ merge: "conflicts", checks }),
      inScope: true,
    }),
  );
  assert.ok(html.includes("Конфликты слияния"));
  assert.ok(html.includes("CI: проверка не прошла"));
  const stale = renderToStaticMarkup(
    createElement(PrHealth, {
      value: JSON.stringify({ merge: "succeeded", checks: [checks[1]] }),
      inScope: true,
    }),
  );
  assert.ok(!stale.includes("CI: ожидает / выполняется"));
  assert.ok(stale.includes("CI: проверки пройдены"));
  const missing = renderToStaticMarkup(
    createElement(PrHealth, {
      value: JSON.stringify({ error: "Unavailable", checks: [] }),
      inScope: true,
    }),
  );
  assert.ok(missing.includes("CI: нет данных"));
});

test("cached stale flags do not override approved; only queued/running are pending", () => {
  const render = (checks: any[]) =>
    renderToStaticMarkup(
      createElement(PrHealth, {
        value: JSON.stringify({ checks }),
        inScope: true,
      }),
    );
  const approved = { build: true, state: "approved", stale: true };
  assert.ok(
    render([approved, { build: true, state: "notApplicable" }]).includes(
      "CI: проверки пройдены",
    ),
  );
  assert.ok(
    render([approved, { build: true, state: "queued" }]).includes(
      "CI: ожидает / выполняется",
    ),
  );
  assert.ok(
    render([{ build: true, state: "unknown", stale: true }]).includes(
      "CI: состояние неизвестно",
    ),
  );
  assert.ok(
    render([{ build: true, state: "rejected", stale: true }]).includes(
      "CI: проверка не прошла",
    ),
  );
});
