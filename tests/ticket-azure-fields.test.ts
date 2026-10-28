import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { Connectors } from "../services/backend/src/connectors.js";
import { saveTicketMetadata, ticketMetadata } from "../services/backend/src/ticket-metadata.js";

function setup(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-azure-fields-"));
  const store = new Store(dir);
  store.set("settings", {
    ...store.rawSettings(),
    azureUrl: "https://ado.test/Org",
    azureProject: "P",
  });
  store.setSecret("azure.pat", "test-pat");
  const previous = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previous;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, service: new Connectors(store), source: store.source() };
}
for (const membership of ["imported", "trash", "unimported"]) {
  test(`Azure priority/tags read-back updates caches and preserves ${membership} membership and local metadata`, async (t) => {
    const { store, service, source } = setup(t);
    if (membership !== "unimported") {
      store.db
        .prepare("INSERT INTO tickets VALUES (?,42,'Title','New','','Bug','','','')")
        .run(source);
      saveTicketMetadata(
        store,
        42,
        source,
        { client: "", project: "" },
        { priority: 8, tags: ["local"] },
      );
    }
    if (membership === "trash") store.removeLocalTicket(42);
    const removal = store.ticketTrash()[0]?.removedAt;
    const fields: Record<string, any> = {
      "System.TeamProject": "P",
      "System.Title": "Title",
      "System.State": "New",
      "System.WorkItemType": "Bug",
      "Microsoft.VSTS.Common.Priority": 2,
      "System.Tags": "Old",
    };
    store.db.prepare("INSERT INTO ticket_cards(id,data) VALUES (?,?)").run(
      "card",
      JSON.stringify({
        id: 42,
        source,
        fields: { ...fields },
        comments: [{ id: 1, text: "keep" }],
      }),
    );
    let writes = 0,
      reads = 0;
    globalThis.fetch = async (_url, init) => {
      if (init?.method === "PATCH") {
        writes++;
        const patch = JSON.parse(String(init.body));
        assert.deepEqual(patch[0], { op: "test", path: "/rev", value: 5 });
        for (const entry of patch.slice(1)) {
          const key = entry.path.slice("/fields/".length);
          if (entry.op === "remove") delete fields[key];
          else fields[key] = entry.value;
        }
      } else reads++;
      return Response.json({ id: 42, rev: 5, fields });
    };
    const result = await service.editAzureFields(42, source, {
      azurePriority: 1,
      azureTags: ["Ready", "ready", "New"],
    });
    assert.equal(result.verified, true);
    assert.equal(reads, 2);
    assert.equal(writes, 1);
    const card = JSON.parse(
      (store.db.prepare("SELECT data FROM ticket_cards WHERE id='card'").get() as any).data,
    );
    assert.equal(card.fields["Microsoft.VSTS.Common.Priority"], 1);
    assert.equal(card.fields["System.Tags"], "ready; New");
    assert.equal(card.comments[0].text, "keep");
    assert.equal(
      !!store.db.prepare("SELECT 1 FROM tickets WHERE id=42").get(),
      membership === "imported",
    );
    if (membership === "trash") assert.equal(store.ticketTrash()[0].removedAt, removal);
    if (membership !== "unimported") assert.deepEqual(ticketMetadata(store, 42).tags, ["local"]);
    await service.editAzureFields(42, source, { azureTags: [] });
    assert.equal(fields["System.Tags"], undefined);
    assert.equal(fields["Microsoft.VSTS.Common.Priority"], 1);
  });
}
test("Azure field writes reject wrong projects, stale connections and invalid values; conflicting writes are not reported as success", async (t) => {
  const { service, source } = setup(t);
  let writes = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "PATCH") {
      writes++;
      return Response.json({ message: "Conflict" }, { status: 409 });
    }
    return Response.json({
      id: 42,
      rev: 5,
      fields: { "System.TeamProject": "P", "Microsoft.VSTS.Common.Priority": 2 },
    });
  };
  await assert.rejects(
    service.editAzureFields(42, source + "other", { azurePriority: 1 }),
    /Подключение/,
  );
  await assert.rejects(service.editAzureFields(42, source, { azurePriority: 0 }));
  await assert.rejects(service.editAzureFields(42, source, { azureTags: ["a;b"] }));
  assert.equal(writes, 0);
  await assert.rejects(
    service.editAzureFields(42, source, { azurePriority: 1 }),
    /не подтверждено/,
  );
  assert.equal(writes, 1);
  globalThis.fetch = async () =>
    Response.json({ id: 42, rev: 5, fields: { "System.TeamProject": "Other" } });
  await assert.rejects(
    service.editAzureFields(42, source, { azurePriority: 1 }),
    /другому проекту/,
  );
});

test("tag edits replace existing sets, remove the last tag, and add only when the field is absent", async (t) => {
  const { service, source } = setup(t);
  const fields: Record<string, unknown> = {
    "System.TeamProject": "P",
    "System.Tags": "Keep; Delete",
  };
  const operations: string[] = [];
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "PATCH") {
      const patch = JSON.parse(String(init.body));
      assert.deepEqual(patch[0], { op: "test", path: "/rev", value: 7 });
      for (const entry of patch.slice(1)) {
        assert.equal(entry.path, "/fields/System.Tags");
        operations.push(entry.op);
        if (entry.op === "replace") {
          assert.ok(Object.hasOwn(fields, "System.Tags"));
          fields["System.Tags"] = entry.value;
        } else if (entry.op === "remove") {
          assert.ok(Object.hasOwn(fields, "System.Tags"));
          assert.ok(!Object.hasOwn(entry, "value"));
          delete fields["System.Tags"];
        } else {
          assert.equal(entry.op, "add");
          assert.ok(!Object.hasOwn(fields, "System.Tags"), "an existing tag set must be replaced");
          fields["System.Tags"] = entry.value;
        }
      }
    }
    return Response.json({ id: 42, rev: 7, fields });
  };
  assert.equal((await service.editAzureFields(42, source, { azureTags: ["Keep"] })).verified, true);
  assert.equal(fields["System.Tags"], "Keep");
  await service.editAzureFields(42, source, { azureTags: [] });
  assert.ok(!Object.hasOwn(fields, "System.Tags"));
  await service.editAzureFields(42, source, { azureTags: [] });
  await service.editAzureFields(42, source, { azureTags: ["New"] });
  assert.equal(fields["System.Tags"], "New");
  assert.deepEqual(operations, ["replace", "remove", "add"]);
});
