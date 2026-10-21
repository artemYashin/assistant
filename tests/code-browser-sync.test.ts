import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { CodeBrowser } from "../server/code-browser.js";

test("Git background checks respect intervals, loaded state, manual mode and schedule", async t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-code-sync-")), store = new Store(dir);
  const previous = process.env.CODE_BROWSER_URL;
  process.env.CODE_BROWSER_URL = "http://code-browser:8010";
  t.after(() => {
    if (previous === undefined) delete process.env.CODE_BROWSER_URL; else process.env.CODE_BROWSER_URL = previous;
    store.close(); rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", { ...store.rawSettings(), azureUrl: "https://ado.test/org", azureProject: "Azure" });
  store.setSecret("azure.pat", "fixture");
  store.db.prepare("INSERT INTO pr_projects(id,client,project,source,azure_project,mode,enabled,repository) VALUES (?,?,?,?,?,?,?,?)")
    .run("monitor", "Customer", "Project", "https://ado.test/org", "Azure", "all", 1, "Repo");
  const browser = new CodeBrowser(store), calls: any[] = [];
  const now = Date.now();
  browser.request = async (input: any) => { calls.push(input); return { checkedAt: new Date(now).toISOString() }; };
  await browser.syncDue(now);
  assert.equal(calls.length, 0); // No first-time clones in the background.
  const state = { repository: "Repo", source: "https://ado.test/org", azureProject: "Azure", branch: "dev", lastChecked: now - 31 * 60000 };
  store.set("code-sync:monitor", state);
  await browser.syncDue(now);
  assert.deepEqual(calls.map(c => c.operation), ["branches", "status"]);
  assert.equal(calls[1].branch, "dev");
  assert.ok(calls.every(c => c.refresh));
  await browser.syncDue(now + 60000);
  assert.equal(calls.length, 2);
  store.db.prepare("UPDATE pr_projects SET code_sync_minutes=0").run();
  await browser.syncDue(now + 60 * 60000);
  assert.equal(calls.length, 2);
  store.db.prepare("UPDATE pr_projects SET code_sync_minutes=30").run();
  store.set("settings", { ...store.rawSettings(), syncSchedule: { mode: "scheduled", days: [], start: "00:00", end: "00:00", timeZone: "UTC" } });
  await browser.syncDue(now + 60 * 60000);
  assert.equal(calls.length, 2);
  store.set("settings", { ...store.rawSettings(), syncSchedule: { ...store.rawSettings().syncSchedule, mode: "always" } });
  browser.request = async () => { calls.push("failure"); throw new Error("offline"); };
  await browser.syncDue(now + 60 * 60000);
  await browser.syncDue(now + 61 * 60000);
  assert.equal(calls.length, 3); // Failures are retried on the interval, not every tick.
  assert.match(store.get<any>("code-sync:monitor", {}).error, /Фоновая проверка/);
});
