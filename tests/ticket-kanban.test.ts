import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { Store } from "../services/backend/src/store.js";
import { createApp } from "../services/backend/src/app.js";
import { deleteContext } from "../services/backend/src/context-delete.js";
import {
  parseTicketView,
  ticketStateColumns,
} from "../services/frontend/src/pages/tickets/model/kanban.js";

test("kanban columns respect state filters and configured order, including empty selected columns", () => {
  const tickets = [
    { id: 1, source: "S", state: "New" },
    { id: 2, source: "S", state: "Active" },
    { id: 3, source: "S", state: "Custom" },
  ];
  const columns = ticketStateColumns(
    tickets,
    ["Active", "Done", "New"],
    ["New", "Active", "Done"],
    ["Done", "New"],
    [],
    true,
  );
  assert.deepEqual(
    columns.map((c) => c.state),
    ["New", "Done"],
  );
  assert.deepEqual(
    columns.map((c) => c.tickets.map((t) => t.id)),
    [[1], []],
  );
  assert.deepEqual(
    ticketStateColumns(tickets, ["Done"], ["New", "Active", "Done"]).map((c) => c.state),
    ["New", "Active", "Done", "Custom"],
  );
  assert.deepEqual(ticketStateColumns(tickets, ["Done", "New"], [], ["New"], ["New"], true), []);
  assert.deepEqual(
    ticketStateColumns(tickets, ["Done"], [], [], ["New", "Active", "Custom"]).map((c) => c.state),
    ["Done"],
  );
  assert.deepEqual(
    ticketStateColumns(tickets, ["Done"], ["New", "Active", "Done"], ["New"]).map((c) => c.state),
    ["New", "Active", "Done", "Custom"],
  );
  assert.deepEqual(
    ticketStateColumns(tickets, ["Done"], ["New", "Active", "Done"], [], [], false, true).map(
      (c) => c.state,
    ),
    ["New", "Active", "Custom"],
  );
  assert.deepEqual(ticketStateColumns([], ["New", "Done"], [], [], [], false, true), []);
  assert.deepEqual(ticketStateColumns(tickets, ["Done"], [], ["Done"], [], true, true), []);
  assert.equal(parseTicketView(null), "table");
  assert.equal(parseTicketView("invalid"), "table");
  assert.equal(parseTicketView("kanban"), "kanban");
});

test("kanban settings upgrade populated storage without changing existing preferences and follow rename/delete", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-kanban-"));
  let store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const first = { client: "C", project: "P" },
    second = { client: "C", project: "Other" };
  store.addContext(first);
  store.addContext(second);
  store.set(store.ticketImportKey(first), {
    azureAutoImport: true,
    azureTypes: ["Bug"],
    azureStates: ["Active"],
  });
  store.set("settings", { ...store.rawSettings(), ...first, llmTimeoutSeconds: 180 });
  store.close();
  store = new Store(dir);
  assert.deepEqual(store.settings(first).kanbanStateOrder, []);
  store.set(store.kanbanKey(first), ["New", "Active"]);
  for (let i = 0; i < 2; i++) {
    store.close();
    store = new Store(dir);
    assert.deepEqual(store.settings(first).kanbanStateOrder, ["New", "Active"]);
  }
  assert.deepEqual(store.settings(first).kanbanHiddenStates, []);
  assert.equal(store.settings(first).kanbanFilterColumnsByStatus, false);
  assert.equal(store.settings(first).kanbanHideEmptyColumns, false);
  store.set(store.kanbanKey(first), { order: ["New", "Active"], hiddenStates: ["Active"] });
  for (let i = 0; i < 2; i++) {
    store.close();
    store = new Store(dir);
    assert.deepEqual(store.settings(first).kanbanHiddenStates, ["Active"]);
    assert.deepEqual(store.settings(first).kanbanStateOrder, ["New", "Active"]);
  }
  assert.equal(store.settings(first).kanbanFilterColumnsByStatus, false);
  assert.equal(store.settings(first).kanbanHideEmptyColumns, false);
  store.set(store.kanbanKey(first), {
    order: ["New", "Active"],
    hiddenStates: ["Active"],
    filterColumnsByStatus: true,
    hideEmptyColumns: true,
  });
  for (let i = 0; i < 2; i++) {
    store.close();
    store = new Store(dir);
    assert.equal(store.settings(first).kanbanFilterColumnsByStatus, true);
    assert.equal(store.settings(first).kanbanHideEmptyColumns, true);
  }
  assert.equal(store.settings(second).kanbanFilterColumnsByStatus, false);
  assert.deepEqual(store.settings(second).kanbanHiddenStates, []);
  assert.deepEqual(store.settings(second).kanbanStateOrder, []);
  assert.equal(store.settings(first).llmTimeoutSeconds, 180);
  assert.deepEqual(store.settings(first).azureStates, ["Active"]);
  store.renameContext(first, "Renamed");
  const renamed = { ...first, project: "Renamed" };
  assert.deepEqual(store.settings(renamed).kanbanStateOrder, ["New", "Active"]);
  store.renameContext({ client: "C", project: "" }, "Customer");
  const moved = { client: "Customer", project: "Renamed" };
  assert.deepEqual(store.settings(moved).kanbanStateOrder, ["New", "Active"]);
  assert.deepEqual(store.settings(moved).kanbanHiddenStates, ["Active"]);
  assert.equal(store.settings(moved).kanbanFilterColumnsByStatus, true);
  assert.equal(store.settings(moved).kanbanHideEmptyColumns, true);
  deleteContext(store, moved, "удалить");
  assert.equal(store.get(store.kanbanKey(moved), null), null);
});

test("kanban API validates project and preserves order after rejected writes", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-kanban-api-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const context = { client: "C", project: "P" };
  store.addContext(context);
  store.set("settings", { ...store.rawSettings(), statusColors: { New: "#112233" } });
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
  await request(app)
    .put("/api/context/kanban")
    .set(auth)
    .send({
      context,
      order: ["New", "Active", "New"],
      hiddenStates: ["Active", "Active"],
      filterColumnsByStatus: true,
      hideEmptyColumns: true,
    })
    .expect(200);
  await request(app)
    .put("/api/context/kanban")
    .set(auth)
    .send({ context, order: [""] })
    .expect(400);
  await request(app)
    .put("/api/context/kanban")
    .set(auth)
    .send({ context: { ...context, project: "Missing" }, order: ["Done"] })
    .expect(400);
  await request(app)
    .put("/api/context/kanban")
    .set(auth)
    .send({ context, order: ["New", "Active"], hiddenStates: [""] })
    .expect(400);
  await request(app)
    .put("/api/context/kanban")
    .set(auth)
    .send({ context, order: ["New", "Active"] })
    .expect(200);
  const read = await request(app).get("/api/context/kanban").query(context).set(auth).expect(200);
  assert.equal(read.body.filterColumnsByStatus, true);
  assert.equal(read.body.hideEmptyColumns, true);
  assert.deepEqual(read.body.hiddenStates, ["Active"]);
  assert.deepEqual(read.body.order, ["New", "Active"]);
  assert.deepEqual(read.body.statusColors, { New: "#112233" });
});
