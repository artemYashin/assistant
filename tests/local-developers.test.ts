import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import {
  LocalDevelopers,
  localDeveloperTools,
} from "../server/local-developers.js";
const context = { client: "Customer", project: "Project" };
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-local-dev-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
function ticket(store: Store) {
  store.db
    .prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)")
    .run(
      store.source(),
      42,
      "Ticket",
      "Active",
      "Azure person",
      "Bug",
      "url",
      "",
      "",
    );
}
test("local developers support scoped multi-assignment, renaming and retired names without Azure", (t) => {
  const store = fixture(t),
    service = new LocalDevelopers(store);
  ticket(store);
  assert.throws(
    () => service.add(["Global"], { client: "", project: "" }),
    /проект/,
  );
  assert.throws(
    () => service.add(["Customer dev"], { ...context, project: "" }),
    /проект/,
  );
  store.db
    .prepare("INSERT INTO local_developers VALUES (?,?,?,?,1)")
    .run("legacy-global", "Global", "", "");
  service.add(["Project dev", "Anna", "Boris"], context);
  assert.throws(
    () => service.assign(42, ["legacy-global"], context),
    /недоступен/,
  );
  assert.equal(service.list(context).length, 3);
  assert.equal(service.list({ client: "Other", project: "Other" }).length, 0);
  const ids = service.list(context).map((d) => d.id);
  assert.equal(service.assign(42, ids, context).developers.length, 3);
  assert.equal(service.assign(42, ids, context).azureChanged, false);
  service.edit(ids[0], "Renamed");
  service.remove(ids[0]);
  assert.equal(
    service.assigned(42).find((d) => d.id === ids[0])?.name,
    "Renamed",
  );
  assert.equal(service.assigned(42).find((d) => d.id === ids[0])?.active, 0);
  assert.equal(service.list(context).length, 2);
  service.assign(42, [], context);
  assert.equal(service.assigned(42).length, 0);
  assert.throws(() => service.assign(42, ["unknown"], context), /недоступен/);
  assert.throws(
    () => service.assign(42, [], context, "other-source"),
    /Подключение/,
  );
});
test("chat assignment requires current user intent and preserves selected people", async (t) => {
  const store = fixture(t),
    service = new LocalDevelopers(store);
  ticket(store);
  const people = service.add(["Anna", "Boris"], context);
  const tool = (prompt: string) =>
    localDeveloperTools(store, context, prompt, () => {}).find(
      (t) => t.name === "set_local_ticket_developers",
    )!;
  await assert.rejects(
    async () =>
      tool("Show ticket 42").handler!(
        { ticketId: 42, developerIds: people.map((p) => p.id) },
        {} as any,
      ),
    /явная команда/,
  );
  await assert.rejects(
    async () =>
      tool("Назначь Anna на 42").handler!(
        { ticketId: 42, developerIds: people.map((p) => p.id) },
        {} as any,
      ),
    /точные имена/,
  );
  const result: any = await tool("Назначь Anna и Boris на тикет 42").handler!(
    { ticketId: 42, developerIds: people.map((p) => p.id) },
    {} as any,
  );
  assert.equal(result.developers.length, 2);
  assert.equal(result.azureChanged, false);
});
test("legacy Azure-based assignments are migrated into the local directory once", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-local-migrate-"));
  let store = new Store(dir);
  try {
    store.db
      .prepare(
        "INSERT INTO ticket_local(source,id,developer_id,developer_name) VALUES (?,?,?,?)",
      )
      .run("source", 42, "azure-id", "Existing person");
    store.set("migration.localDevelopers", false);
    store.close();
    store = new Store(dir);
    assert.equal(
      new LocalDevelopers(store).assigned(42, "source")[0].name,
      "Existing person",
    );
    store.close();
    store = new Store(dir);
    assert.equal(new LocalDevelopers(store).assigned(42, "source").length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
