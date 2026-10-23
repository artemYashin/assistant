import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Connectors } from "../server/connectors.js";

for (const mode of ["assign", "clear", "mismatch", "patch-error"] as const) {
  test(`Azure assignee ${mode}: revision guard and read-back verification`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "orbit-assignee-"));
    const store = new Store(dir);
    t.after(() => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    });
    store.set("settings", {
      ...store.settings(),
      azureUrl: "https://ado.test/Org",
      azureProject: "P",
    });
    store.setSecret("azure.pat", "pat");
    const source = store.source();
    const person = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Test Person",
      email: "person@example.test",
    };
    store.set("developers:" + source, [person]);
    // Content-cache attachment records share this table but have no fields.
    const attachmentCard = { id: 42, source, attachments: [] };
    const fullCard = { id: 42, source, fields: { "System.AssignedTo": "Previous" } };
    const otherCard = { ...fullCard, source: "other-source" };
    const insert = store.db.prepare("INSERT INTO ticket_cards(id,data) VALUES (?,?)");
    insert.run("attachments", JSON.stringify(attachmentCard));
    insert.run("details", JSON.stringify(fullCard));
    insert.run("other", JSON.stringify(otherCard));
    const recentKey = "azure.assignees.recent:" + source;
    const previousRecent = Array.from({ length: 8 }, (_, i) => ({ id: `old-${i}`, name: `Old ${i}`, email: `old${i}@example.test` }));
    store.set(recentKey, previousRecent);
    store.set("azure.assignees.recent:other-source", [{ id: "other" }]);
    const connectors = new Connectors(store);
    let reads = 0,
      writes = 0;
    t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
      if (init.method === "PATCH") {
        writes++;
        assert.deepEqual(JSON.parse(init.body), [
          { op: "test", path: "/rev", value: 4 },
          {
            op: "add",
            path: "/fields/System.AssignedTo",
            value: mode === "clear" ? "" : person.email,
          },
        ]);
        if (mode === "patch-error")
          return new Response("denied", { status: 403 });
        return Response.json({ id: 42 });
      }
      reads++;
      return Response.json({
        id: 42,
        rev: 4,
        fields: {
          "System.TeamProject": "P",
          "System.AssignedTo":
            reads > 1 && mode !== "mismatch" && mode !== "patch-error"
              ? mode === "clear"
                ? ""
                : { id: person.id, displayName: person.name }
              : { id: "other", displayName: "Previous" },
        },
      });
    });
    const result = connectors.assignTicket(
      42,
      source,
      mode === "clear" ? null : person.id,
    );
    if (mode === "mismatch" || mode === "patch-error")
      await assert.rejects(result, /не подтверждено/);
    else {
      assert.equal((await result).verified, true);
      const readCard = (id: string) => JSON.parse((store.db.prepare("SELECT data FROM ticket_cards WHERE id=?").get(id) as { data: string }).data);
      assert.deepEqual(readCard("attachments"), attachmentCard);
      assert.deepEqual(readCard("other"), otherCard);
      assert.deepEqual(readCard("details").fields["System.AssignedTo"], mode === "clear" ? "" : { id: person.id, displayName: person.name });
    }
    const recent = store.get<any[]>(recentKey, []);
    if (mode === "assign") {
      assert.deepEqual(recent[0], person);
      assert.equal(recent.length, 8);
      assert.equal(recent[1].id, "old-0");
    } else assert.deepEqual(recent, previousRecent);
    assert.deepEqual(store.get("azure.assignees.recent:other-source", []), [{ id: "other" }]);
    assert.equal(reads, 2);
    assert.equal(writes, 1);
    await assert.rejects(
      connectors.assignTicket(42, "other-source", person.id),
      /Подключение/,
    );
    await assert.rejects(
      connectors.assignTicket(42, source, "unknown-user"),
      /Найдите пользователя/,
    );
    assert.equal(writes, 1);
    if (mode === "assign") {
      // Recent users remain assignable after the ordinary search cache expires.
      store.set("developers:" + source, []);
      assert.equal((await connectors.assignTicket(42, source, person.id)).verified, true);
      assert.equal(store.get<any[]>(recentKey, []).filter(p => p.id === person.id).length, 1);
    }
  });
}
