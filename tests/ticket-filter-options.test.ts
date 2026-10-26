import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { createApp } from "../services/backend/src/app.js";

test("filter options use the full imported Azure catalog without configured priority levels without Azure calls", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-filter-options-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/Org",
    azureProject: "P",
    azureTypes: ["Bug"],
    azureStates: ["Active"],
  });
  store.set("azure.ticket-options:" + store.source(), [
    { name: "Bug", states: ["Active", "Resolved"] },
    { name: "User Story", states: ["New", "Done"] },
  ]);
  store.set('ticket-priorities:["Customer",""]', 4);
  store.set('ticket-priorities:["Customer","Project"]', 6);
  const { app } = createApp(store);
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected Azure request");
  });
  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  const setup = await request(app)
    .post("/api/auth/setup")
    .set(headers)
    .send({ password: "long-enough-password" })
    .expect(200);
  const auth = {
    ...headers,
    Cookie: setup.headers["set-cookie"][0].split(";")[0],
  };
  const result = await request(app)
    .get("/api/tickets/filter-options")
    .query({ client: "Customer", project: "Project" })
    .set(auth)
    .expect(200);
  assert.deepEqual(result.body.types, ["Bug", "User Story"]);
  assert.deepEqual(result.body.states, ["Active", "Resolved", "New", "Done"]);
  assert.equal(result.body.priorityCount, undefined);
  const fallback = await request(app)
    .get("/api/tickets/filter-options")
    .query({ client: "Customer", project: "Other" })
    .set(auth)
    .expect(200);
  assert.equal(fallback.body.priorityCount, undefined);
  store.set("settings", { ...store.settings(), azureProject: "Different" });
  const other = await request(app)
    .get("/api/tickets/filter-options")
    .query({ client: "Other", project: "Other" })
    .set(auth)
    .expect(200);
  assert.deepEqual(other.body.types, []);
  assert.deepEqual(other.body.states, []);
  assert.equal(other.body.priorityCount, undefined);
});
