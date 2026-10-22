import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Connectors } from "../server/connectors.js";
import { IntegrationsAuth } from "../server/auth.js";

test("status cache lasts one day, persists, shares concurrent requests and separates credentials/projects", async t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-states-cache-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  store.set("settings", { ...store.settings(), azureUrl: "https://ado.test", azureProject: "P" });
  store.setSecret("azure.pat", "first");
  store.db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)").run(store.source(), 1, "Title", "Active", "", "Bug", "", "", "");
  let time = Date.now(), calls = 0, fail = false;
  t.mock.method(Date, "now", () => time);
  const make = () => {
    const c = new Connectors(store, new IntegrationsAuth(store));
    (c as any).azure = async (path: string) => {
      calls++;
      if (fail) throw Error("offline");
      if (path === "workitemtypes") return { value: [{ name: "Bug", states: [{ name: "Active" }, { name: "Closed" }] }] };
      assert.match(path, /workitemtypes\/Bug\/states/);
      return { value: [{ name: "Active" }, { name: "Closed" }] };
    };
    return c;
  };
  let c = make();
  await Promise.all([c.ticketStates(1), c.ticketStates(1)]);
  assert.equal(calls, 1);
  c = make(); // A new service instance still uses the persisted cache.
  assert.deepEqual((await c.ticketStatesBatch([1])).results[0].states, ["Active", "Closed"]);
  assert.equal(calls, 1);
  time += 86400000 - 1;
  await c.ticketStates(1); assert.equal(calls, 1);
  time++;
  fail = true;
  await assert.rejects(c.ticketStates(1), /offline/);
  fail = false;
  await c.ticketStates(1); assert.equal(calls, 3);
  store.setSecret("azure.pat", "second");
  await c.ticketStates(1); assert.equal(calls, 4);
  await c.ticketOptions(); await c.ticketOptions(); assert.equal(calls, 5);
  store.set("settings", { ...store.settings(), azureProject: "Other" });
  await c.ticketOptions(); assert.equal(calls, 6);
});
