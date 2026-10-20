import test from "node:test";
import assert from "node:assert/strict";
import {
  azureLookupConsent,
  azureLookupQuestion,
  azureLookupSchema,
} from "../server/azure-ticket-consent.js";
import { Store } from "../server/store.js";
import { Connectors } from "../server/connectors.js";
import { IntegrationsAuth } from "../server/auth.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("lookup consent binds mode, criteria and source to the previous question", () => {
  const plan = { ids: [42, 43] },
    source = "https://ado.test|Project";
  const history = [
    { role: "assistant", body: azureLookupQuestion(plan, source, 0) },
  ];
  assert.deepEqual(azureLookupConsent("Только показать", history, source), {
    plan,
    add: false,
  });
  assert.deepEqual(
    azureLookupConsent("Запросить и добавить", history, source),
    { plan, add: true },
  );
  for (const reply of ["Да", "Нет", "Покажи #99", "Запросить и добавить #99"])
    assert.equal(azureLookupConsent(reply, history, source), undefined);
  assert.equal(
    azureLookupConsent("Только показать", history, "other"),
    undefined,
  );
  assert.equal(
    azureLookupConsent(
      "Только показать",
      [...history, { role: "assistant", body: "Готово" }],
      source,
    ),
    undefined,
  );
  assert.equal(
    azureLookupSchema.safeParse({ ids: [42], search: "different" }).success,
    false,
  );
});

test("Azure lookup reads basic fields; read-only leaves SQLite untouched and add stores locally", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-lookup-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/Collection",
    azureProject: "Project",
  });
  store.setSecret("azure.pat", "pat");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    calls++;
    const url = new URL(String(raw));
    assert.equal(init.method, "POST");
    if (url.pathname.endsWith("/wiql")) {
      assert.equal(url.searchParams.get("$top"), "51");
      assert.match(JSON.parse(init.body).query, /CONTAINS 'O''Brien'/);
      return Response.json({ workItems: [{ id: 42 }] });
    }
    assert.ok(url.pathname.endsWith("/workitemsbatch"));
    const body = JSON.parse(init.body);
    assert.deepEqual(body.ids, [42]);
    assert.ok(!body.fields.includes("System.Description"));
    return Response.json({
      value: [
        {
          id: 42,
          fields: {
            "System.TeamProject": "Project",
            "System.Title": "Title",
            "System.State": "Active",
            "System.WorkItemType": "Bug",
          },
        },
      ],
    });
  });
  const connectors = new Connectors(store, new IntegrationsAuth(store));
  const read = await connectors.lookupTickets(
    { search: "O'Brien" },
    false,
    () => {},
  );
  assert.deepEqual(read.added, []);
  assert.equal(
    store.db.prepare("SELECT count(*) n FROM tickets").get() &&
      (store.db.prepare("SELECT count(*) n FROM tickets").get() as any).n,
    0,
  );
  const add = await connectors.lookupTickets({ ids: [42] }, true, () => {});
  assert.deepEqual(add.added, [42]);
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM tickets").get() as any).n,
    1,
  );
  assert.equal(calls, 3);
});
