import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";

test("context rename preserves scoped data and rolls back conflicting settings", t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-rename-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const original = { client: "Customer", project: "Portal" };
  store.addContext(original);
  store.set("settings", { ...store.rawSettings(), ...original });
  store.addMemory("project", "Remember requirements", original);
  store.say("user", "History", original);
  store.set('ticket-priorities:["Customer","Portal"]', 4);
  store.set('azure.context:["Customer","Portal"]', { azureProject: "Azure name" });
  store.renameContext(original, "Website");
  const renamed = { client: "Customer", project: "Website" };
  assert.equal(store.settings().project, "Website");
  assert.equal(store.memories(renamed).length, 1);
  assert.equal(store.history(renamed).length, 1);
  assert.equal(store.get('ticket-priorities:["Customer","Website"]', 0), 4);
  assert.equal(store.get('ticket-priorities:["Customer","Portal"]', null), null);
  store.renameContext({ client: "Customer", project: "" }, "New customer");
  const moved = { client: "New customer", project: "Website" };
  assert.equal(store.memories(moved).length, 1);
  assert.equal(store.history(moved).length, 1);
  assert.equal(store.settings().client, moved.client);
  assert.equal(store.settings().azureProject, "Azure name");
  assert.ok(store.contexts().every(c => c.client === moved.client));
  store.set('ticket-priorities:["New customer","Conflict"]', 3);
  assert.throws(() => store.renameContext(moved, "Conflict"));
  assert.equal(store.settings().project, "Website");
  assert.equal(store.memories(moved).length, 1);
  assert.ok(store.contexts().some(c => c.project === "Website"));
  store.addContext({ ...moved, project: "Existing" });
  assert.throws(() => store.renameContext(moved, "Existing"));
});

test("legacy customer rename preserves repository, developers and scoped settings", t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-legacy-rename-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const previous = { client: "Legacy", project: "Portal" };
  store.addMemory("project", "Existing memory", previous); // No standalone registry row.
  store.db.prepare("INSERT INTO local_developers(id,name,client,project) VALUES (?,?,?,?)").run("dev", "Alex", previous.client, previous.project);
  store.db.prepare("INSERT INTO pr_projects(id,client,project,source,azure_project,mode,enabled,repository) VALUES (?,?,?,?,?,?,?,?)")
    .run("monitor", previous.client, previous.project, "https://azure.test", "Azure", "all", 1, "repo");
  const keys = [
    'azure.context:["Legacy",""]',
    'project.azure:["https://azure.test","Legacy","Portal"]',
    'developer-note:["Legacy","Portal","dev"]',
    'developer-status-groups:["source","Legacy","Portal"]',
  ];
  for (const key of keys) store.set(key, { preserved: key });
  store.renameContext({ client: "Legacy", project: "" }, "Renamed");
  store.renameContext({ client: "Renamed", project: "Portal" }, "Site");
  assert.equal(store.memories({ client: "Renamed", project: "Site" }).length, 1);
  assert.deepEqual(store.db.prepare("SELECT client,project,repository FROM pr_projects WHERE id='monitor'").get(), { client: "Renamed", project: "Site", repository: "repo" });
  assert.deepEqual(store.db.prepare("SELECT client,project FROM local_developers WHERE id='dev'").get(), { client: "Renamed", project: "Site" });
  for (const key of keys) {
    const renamed = key.replace('"Legacy"', '"Renamed"').replace('"Portal"', '"Site"');
    assert.deepEqual(store.get(renamed, null), { preserved: key });
    assert.equal(store.get(key, null), null);
  }
});

test("rename preserves unrecognized scoped keys without parsing failures or data loss", t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-rename-legacy-keys-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.addContext({ client: "Customer", project: "Portal" });
  const unknownKeys = [
    'azure.context:legacy',
    'project.azure:["incomplete"',
    'chat.active:null',
    'ticket-priorities:{"0":"Customer","1":"Portal"}',
    'developer-note:["Customer","Portal"]',
    'developer-status-groups:["source","Customer","Portal",null]',
  ];
  for (const key of unknownKeys) store.set(key, { preserve: key });
  store.set('azure.context:["Customer","Portal"]', { azureProject: "Remote project" });
  store.set('ticket-priorities:["Customer","Portal"]', 4);
  store.renameContext({ client: "Customer", project: "" }, "Renamed");
  store.renameContext({ client: "Renamed", project: "Portal" }, "Website");
  assert.ok(store.contexts().some(c => c.client === "Renamed" && c.project === "Website"));
  assert.deepEqual(store.get('azure.context:["Renamed","Website"]', null), { azureProject: "Remote project" });
  assert.equal(store.get('ticket-priorities:["Renamed","Website"]', 0), 4);
  for (const key of unknownKeys) assert.deepEqual(store.get(key, null), { preserve: key });
  assert.equal(store.get('azure.context:["Customer","Portal"]', null), null);
});
