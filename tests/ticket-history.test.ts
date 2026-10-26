import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { Connectors } from "../services/backend/src/connectors.js";

test("history pages preserve Azure values, pagination and stored cards; stale sources are rejected", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-history-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/Collection",
    azureProject: "Project",
  });
  store.setSecret("azure.pat", "fixture");
  const card = {
    id: 42,
    source: store.source(),
    fields: { "System.Title": "Saved" },
    comments: [],
  };
  store.db.prepare("INSERT INTO ticket_cards VALUES (?,?)").run("history", JSON.stringify(card));
  const connectors = new Connectors(store);
  let calls = 0;
  let invalid = false;
  let changeSource = false;
  t.mock.method(globalThis, "fetch", async (input: any) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.pathname, "/Collection/Project/_apis/wit/workitems/42/updates");
    assert.equal(url.searchParams.get("$top"), "21");
    if (changeSource) store.set("settings", { ...store.settings(), azureProject: "Other" });
    if (invalid) return Response.json({ value: "bad" });
    const skip = Number(url.searchParams.get("$skip"));
    return Response.json({
      value: Array.from({ length: skip ? 1 : 21 }, (_, index) => ({
        id: skip + index + 1,
        rev: skip + index + 1,
        revisedBy: { displayName: "Reviewer" },
        revisedDate: "9999-01-01T00:00:00Z",
        fields: {
          "System.ChangedDate": { newValue: "2026-10-27T00:00:00Z" },
          "Custom.Field": { oldValue: false, newValue: 0 },
        },
      })),
    });
  });
  const first = await connectors.ticketHistory("history");
  assert.equal(first.items.length, 20);
  assert.equal(first.nextSkip, 20);
  assert.deepEqual(first.items[0].fields["Custom.Field"], { oldValue: false, newValue: 0 });
  assert.equal(first.items[0].date, "2026-10-27T00:00:00Z");
  assert.equal(first.items[0].author, "Reviewer");
  const second = await connectors.ticketHistory("history", 20);
  assert.equal(second.items[0].id, 21);
  assert.equal(second.nextSkip, null);
  assert.deepEqual(connectors.ticketCard("history"), card);
  await assert.rejects(() => connectors.ticketHistory("history", -1), /страница/);
  invalid = true;
  await assert.rejects(() => connectors.ticketHistory("history"), /ответ истории/);
  invalid = false;
  changeSource = true;
  await assert.rejects(() => connectors.ticketHistory("history"), /Подключение Azure изменилось/);
  const before = calls;
  await assert.rejects(() => connectors.ticketHistory("history"), /Подключение Azure изменилось/);
  assert.equal(calls, before);
});
