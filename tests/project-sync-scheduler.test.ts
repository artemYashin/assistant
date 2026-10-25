import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, AZURE_API_VERSION } from "../server/store.js";
import { ProjectSyncScheduler } from "../server/project-sync-scheduler.js";
const a = { client: "C", project: "A" },
  b = { client: "C", project: "B" };
test("populated migration copies global schedule, preserves explicit project choices and fixes API version without losing data", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-project-sync-"));
  let store = new Store(dir);
  try {
    store.addContext(a);
    store.addContext(b);
    const schedule = {
      mode: "scheduled",
      days: [2, 4],
      start: "11:00",
      end: "16:00",
      timeZone: "Asia/Bishkek",
    };
    // Write a representative old settings row, bypassing the new writer.
    store.db
      .prepare("UPDATE kv SET value=? WHERE key='settings'")
      .run(
        JSON.stringify({
          ...store.rawSettings(),
          azureVersion: "7.0",
          syncSeconds: 420,
          syncSchedule: schedule,
          reviewMaxToolCalls: 19,
        }),
      );
    store.set(store.ticketImportKey(a), {
      azureAutoImport: true,
      azureTypes: ["Bug"],
      azureStates: ["New"],
      azureImportAssignees: [
        { id: "a", name: "A", email: "a@example.invalid" },
      ],
    });
    store.set(store.ticketImportKey(b), {
      syncSeconds: 120,
      azureAutoImport: false,
    });
    store.set("migration.projectSyncSchedule", false);
    store.set("migration.fixedAzureApiVersion", false);
    for (let i = 0; i < 2; i++) {
      store.close();
      store = new Store(dir);
      assert.equal(store.settings(a).syncSeconds, 420);
      assert.deepEqual(store.settings(a).syncSchedule, schedule);
      assert.equal(store.settings(a).azureImportAssignees[0].id, "a");
      assert.equal(store.settings(b).syncSeconds, 120);
      assert.equal(store.settings().reviewMaxToolCalls, 19);
      assert.equal(store.settings().azureVersion, AZURE_API_VERSION);
      assert.equal("azureVersion" in store.get<any>("settings", {}), false);
    }
    store.set("settings", {
      ...store.rawSettings(),
      azureVersion: "6.0",
      syncSchedule: { ...schedule, timeZone: "UTC" },
    });
    assert.equal(store.settings(a).syncSchedule.timeZone, "UTC");
    assert.equal(store.settings().azureVersion, "7.1");
    assert.equal("azureVersion" in store.get<any>("settings", {}), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("independent project intervals and windows apply regardless of active header context", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-project-timer-"));
  const store = new Store(dir);
  try {
    store.addContext(a);
    store.addContext(b);
    store.set(store.ticketImportKey(a), { syncSeconds: 60 });
    store.set(store.ticketImportKey(b), { syncSeconds: 120 });
    let now = Date.parse("2026-10-26T12:00:00Z");
    const timer = new ProjectSyncScheduler(store, () => now);
    const calls: any[] = [];
    const run = async (contexts: any) => {
      calls.push(contexts);
      now += 1000;
    };
    await timer.run(run);
    assert.equal(calls[0].length, 2);
    now += 59000;
    await timer.run(run);
    assert.equal(calls.length, 1);
    now += 1000;
    await timer.run(run);
    assert.deepEqual(calls[1], [a]);
    now += 60000;
    await timer.run(run);
    assert.equal(calls[2].length, 2);
    store.set(store.ticketImportKey(a), {
      syncSeconds: 60,
      syncSchedule: {
        ...store.rawSettings().syncSchedule,
        mode: "scheduled",
        days: [],
      },
    });
    now += 121000;
    await timer.run(run);
    assert.deepEqual(calls[3], [b]);
    store.set(store.ticketImportKey(a), { syncSeconds: 60 });
    await timer.run(run);
    assert.deepEqual(calls[4], [a]);
    now += 121000;
    await assert.rejects(
      () =>
        timer.run(async () => {
          throw Error("offline");
        }),
      /offline/,
    );
    await timer.run(run);
    assert.equal(calls.length, 5, "failure still schedules next attempt");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("project settings save schedule locally and old clients do not reset it", async () => {
  const { default: request } = await import("supertest");
  const { createApp } = await import("../server/app.js");
  const dir = mkdtempSync(join(tmpdir(), "orbit-project-sync-api-"));
  const store = new Store(dir);
  try {
    store.addContext(a);
    store.addContext(b);
    const { app } = createApp(store);
    const headers = {
      Host: "localhost:43871",
      Origin: "http://localhost:43871",
      "X-Orbit-Request": "1",
    };
    const setup = await request(app)
      .post("/api/auth/setup")
      .set(headers)
      .send({ password: "correct-password-long" })
      .expect(200);
    const auth = {
      ...headers,
      Cookie: setup.headers["set-cookie"][0].split(";")[0],
      "X-CSRF-Token": setup.body.csrf,
    };
    const input = {
      context: a,
      azureAutoImport: false,
      azureImportAssignees: [],
      azureTypes: [],
      azureStates: [],
      typeColors: {},
      statusColors: {},
    };
    const schedule = {
      ...store.rawSettings().syncSchedule,
      mode: "scheduled",
      days: [1],
      start: "09:00",
      end: "12:00",
    };
    await request(app)
      .put("/api/context/ticket-import")
      .set(auth)
      .send({ ...input, syncSeconds: 180, syncSchedule: schedule })
      .expect(200);
    await request(app)
      .put("/api/context/ticket-import")
      .set(auth)
      .send(input)
      .expect(200);
    assert.equal(store.settings(a).syncSeconds, 180);
    assert.equal(store.settings(b).syncSeconds, 600);
    assert.deepEqual(store.settings(a).syncSchedule, schedule);
    await request(app)
      .put("/api/context/ticket-import")
      .set(auth)
      .send({ ...input, syncSeconds: 0 })
      .expect(400);
    assert.equal(store.settings(a).syncSeconds, 180);
    await request(app)
      .put("/api/settings")
      .set(auth)
      .send({ ...store.settings(a), azureVersion: "6.0" })
      .expect(200);
    assert.equal(store.settings().azureVersion, "7.1");
    assert.equal("azureVersion" in store.get<any>("settings", {}), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("background pass synchronizes only due project PRs and forwards project ticket context", async () => {
  const {createApp}=await import("../server/app.js");
  const dir=mkdtempSync(join(tmpdir(),"orbit-due-pass-"));
  const store=new Store(dir);
  try {
    store.addContext(a);store.addContext(b);store.setSecret("azure.pat","test-pat");
    const {sync,connectors,pullRequests}=createApp(store);
    const tickets:any[]=[];const prs:any[]=[];
    connectors.syncTickets=async (_import,_automatic,context)=>{tickets.push(context);return {count:0};};
    pullRequests.monitors=()=>[{id:"a",...a,enabled:1},{id:"b",...b,enabled:1}] as any;
    pullRequests.sync=async id=>{prs.push(id);};
    await sync([a]);
    assert.deepEqual(tickets,[a]);assert.deepEqual(prs,["a"]);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
