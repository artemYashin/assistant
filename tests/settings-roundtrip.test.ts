import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { Store } from "../services/backend/src/store.js";
import { createApp } from "../services/backend/src/app.js";

test("settings roundtrip accepts old clients without overwriting project Kanban or secrets", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-settings-roundtrip-"));
  let store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const context = { client: "C", project: "P" };
  store.addContext(context);
  store.set("settings", { ...store.rawSettings(), ...context, reviewMaxTokens: 76543 });
  store.setSecret("github.token", "test-token");
  const group = {
    id: "group:12345678-1234-1234-1234-123456789012",
    name: "Работа",
    states: ["Active", "Review"],
    defaultState: "Active",
  };
  const kanban = {
    order: ["New", group.id],
    groups: [group],
    hiddenStates: ["Closed"],
    filterColumnsByStatus: true,
    hideEmptyColumns: true,
  };
  store.set(store.kanbanKey(context), kanban);
  const { app } = createApp(store);
  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  const setup = await request(app).post("/api/auth/setup").set(headers).send({}).expect(200);
  const auth = {
    ...headers,
    Cookie: setup.headers["set-cookie"][0].split(";")[0],
    "X-CSRF-Token": setup.body.csrf,
  };
  const snapshot = (await request(app).get("/api/settings").set(auth).expect(200)).body;
  await request(app)
    .put("/api/settings")
    .set(auth)
    .send({
      ...snapshot,
      kanbanGroups: [],
      kanbanStateOrder: [],
      llmTimeoutSeconds: 301,
      githubConnected: false,
    })
    .expect(200);
  assert.deepEqual(store.get(store.kanbanKey(context), null), kanban);
  assert.equal(store.secret("github.token"), "test-token");
  assert.equal(store.settings().llmTimeoutSeconds, 301);
  assert.equal(store.settings().reviewMaxTokens, 76543);
  assert.equal("kanbanGroups" in store.get<any>("settings", {}), false);
  await request(app)
    .put("/api/settings")
    .set(auth)
    .send({ ...snapshot, unexpectedSetting: true })
    .expect(400);
  await request(app)
    .put("/api/settings")
    .set(auth)
    .send({ ...snapshot, llmTimeoutSeconds: 0 })
    .expect(400);
  assert.equal(store.settings().llmTimeoutSeconds, 301);
  for (let i = 0; i < 2; i++) {
    store.close();
    store = new Store(dir);
    assert.deepEqual(store.get(store.kanbanKey(context), null), kanban);
    assert.equal(store.settings().llmTimeoutSeconds, 301);
    assert.equal(store.secret("github.token"), "test-token");
  }
});
