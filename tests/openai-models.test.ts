import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { llmSelection, loadOpenaiModels } from "../services/backend/src/llm-provider.js";

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-model-catalogue-"));
  const store = new Store(dir);
  store.set("settings", { ...store.settings(), openaiBaseUrl: "http://localhost:1234/custom/v1/" });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

test("explicit catalogue load uses saved external connection even with Copilot selected and no model configured", async (t) => {
  const store = fixture(t);
  store.setSecret("github.token", "never-send-github");
  store.setSecret("openai.apiKey", "external-test-key");
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "http://localhost:1234/custom/v1/models");
    assert.deepEqual(options.headers, { Authorization: "Bearer external-test-key" });
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    return Response.json({
      data: [
        { id: " first ", name: " First model " },
        { id: "first" },
        { id: "second" },
        { id: "" },
        { id: 123 },
        { id: "x".repeat(201) },
        null,
      ],
    });
  });
  const before = store.settings();
  assert.deepEqual(await loadOpenaiModels(store), {
    models: [
      { id: "first", name: "First model" },
      { id: "second", name: "second" },
    ],
    connectionId: llmSelection({ ...before, assistantProvider: "openai" }, "chat").connectionId,
  });
  assert.deepEqual(store.settings(), before);
});

test("keyless catalogues, empty lists and oversized lists retain manual settings", async (t) => {
  const store = fixture(t);
  store.set("settings", { ...store.settings(), openaiModel: "manual-only" });
  let data: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    assert.deepEqual(options.headers, {});
    return Response.json({ data });
  });
  assert.deepEqual((await loadOpenaiModels(store)).models, []);
  data = Array.from({ length: 5001 }, (_, i) => ({ id: `model-${i}` }));
  assert.equal((await loadOpenaiModels(store)).models.length, 5000);
  assert.equal(store.settings().openaiModel, "manual-only");
});

test("catalogue errors never expose upstream response, endpoint or key, and oversized streams fail", async (t) => {
  const store = fixture(t);
  const responses = [
    () => new Response("secret upstream body", { status: 401 }),
    () => Response.json({ invalid: [] }),
    () => new Response("not JSON"),
    () => new Response("{}", { headers: { "content-length": String(1024 * 1024 + 1) } }),
    () => new Response("x".repeat(1024 * 1024 + 1)),
    () => {
      throw new Error("secret key and endpoint in network error");
    },
  ];
  let next = responses[0];
  t.mock.method(globalThis, "fetch", async () => next());
  for (next of responses) {
    await assert.rejects(loadOpenaiModels(store), (error: any) => {
      assert.equal(error.status, 502);
      assert.ok(!error.message.includes("secret"));
      assert.ok(!error.message.includes("localhost"));
      return true;
    });
  }
});

test("a catalogue arriving after endpoint, key or protocol change is rejected", async (t) => {
  const store = fixture(t);
  let change = () => {};
  t.mock.method(globalThis, "fetch", async () => {
    change();
    return Response.json({ data: [{ id: "stale-model" }] });
  });
  const changes = [
    () => store.set("settings", { ...store.settings(), openaiBaseUrl: "http://localhost:5678/v1" }),
    () => store.setSecret("openai.apiKey", "new-key"),
    () => store.set("settings", { ...store.settings(), openaiWireApi: "responses" }),
  ];
  for (change of changes) {
    await assert.rejects(loadOpenaiModels(store), (error: any) => error.status === 409);
  }
});
