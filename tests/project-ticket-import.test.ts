import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { deleteContext } from "../services/backend/src/context-delete.js";
import { createApp } from "../services/backend/src/app.js";
import request from "supertest";
const first = { client: "C", project: "One" },
  second = { client: "C", project: "Two" };
test("legacy filters migrate once to existing projects, remain isolated and follow rename/delete", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-import-"));
  let store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.addContext(first);
  store.addContext(second);
  store.set("settings", {
    ...store.rawSettings(),
    ...first,
    azureAutoImport: true,
    azureTypes: ["Bug"],
    azureStates: ["Active"],
  });
  store.db.prepare("DELETE FROM kv WHERE key=?").run("migration.projectTicketImport");
  store.close();
  store = new Store(dir);
  assert.equal(store.settings(first).azureAutoImport, true);
  assert.deepEqual(store.settings(second).azureTypes, ["Bug"]);
  assert.equal(store.settings({ client: "C", project: "New" }).azureAutoImport, false);
  store.set(store.ticketImportKey(first), {
    azureAutoImport: true,
    azureTypes: ["Task"],
    azureStates: ["New"],
  });
  store.close();
  store = new Store(dir);
  assert.deepEqual(store.settings(first).azureTypes, ["Task"]);
  assert.deepEqual(store.settings(second).azureTypes, ["Bug"]);
  store.renameContext(first, "Renamed");
  const renamed = { client: "C", project: "Renamed" };
  assert.deepEqual(store.settings(renamed).azureTypes, ["Task"]);
  deleteContext(store, renamed, "удалить");
  assert.equal(store.get(store.ticketImportKey(renamed), null), null);
  assert.deepEqual(store.settings(second).azureTypes, ["Bug"]);
});
test("project import API saves only the selected project and rejects empty enabled filters", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-import-api-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.addContext(first);
  store.addContext(second);
  const { app } = createApp(store);
  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  const setup = await request(app)
    .post("/api/auth/setup")
    .set(headers)
    .send({ password: "long-test-password" })
    .expect(200);
  const auth = {
    ...headers,
    Cookie: setup.headers["set-cookie"][0].split(";")[0],
    "X-CSRF-Token": setup.body.csrf,
  };
  const input = {
    context: first,
    azureAutoImport: true,
    azureImportAssignees: [{ id: "u", name: "Person", email: "person@example.test" }],
    azureTypes: ["Task"],
    azureStates: ["New"],
    typeColors: {},
    statusColors: {},
  };
  await request(app)
    .put("/api/context/ticket-import")
    .set(auth)
    .send({ ...input, azureStates: [] })
    .expect(400);
  await request(app)
    .put("/api/context/ticket-import")
    .set(auth)
    .send({ ...input, azureImportAssignees: [] })
    .expect(400);
  await request(app).put("/api/context/ticket-import").set(auth).send(input).expect(200);
  assert.deepEqual(store.settings(first).azureImportAssignees, input.azureImportAssignees);
  assert.equal((store.db.prepare("SELECT count(*) n FROM local_developers").get() as any).n, 0);
  assert.deepEqual(store.settings(second).azureImportAssignees, []);
  assert.deepEqual(store.settings(first).azureTypes, ["Task"]);
  assert.equal(store.settings(second).azureAutoImport, false);
  const read = await request(app)
    .get("/api/context/ticket-import")
    .query(first)
    .set(auth)
    .expect(200);
  assert.deepEqual(read.body.azureStates, ["New"]);
  assert.equal(read.body.project, "One");
});
