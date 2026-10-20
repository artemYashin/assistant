import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Connectors } from "../server/connectors.js";
import { IntegrationsAuth } from "../server/auth.js";

for (const trash of [false, true]) {
  test(`verified Azure edits preserve ${trash ? "trash" : "unimported"} membership`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "orbit-untracked-edit-"));
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
    if (trash) {
      store.db
        .prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)")
        .run(
          source,
          42,
          "Bug",
          "Active",
          "Previous",
          "Bug",
          "https://ado.test/42",
          "",
          "",
        );
      store.removeLocalTicket(42);
    }
    const originalRemoval = store.ticketTrash()[0]?.removedAt;
    const person = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "New Owner",
      email: "owner@example.test",
    };
    store.set("developers:" + source, [person]);
    const fields: Record<string, any> = {
      "System.TeamProject": "P",
      "System.Title": "Bug",
      "System.WorkItemType": "Bug",
      "System.State": "Active",
      "System.AssignedTo": { displayName: "Previous" },
    };
    let reads = 0,
      writes = 0;
    t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
      if (String(url).includes("/states?"))
        return Response.json({
          value: [{ name: "Active" }, { name: "Resolved" }],
        });
      if (init.method === "PATCH") {
        writes++;
        for (const patch of JSON.parse(init.body)) {
          if (patch.path === "/fields/System.State")
            fields["System.State"] = patch.value;
          if (patch.path === "/fields/System.AssignedTo")
            fields["System.AssignedTo"] = {
              id: person.id,
              displayName: person.name,
              uniqueName: person.email,
            };
        }
      } else reads++;
      return Response.json({ id: 42, rev: 1 + writes, fields });
    });
    const service = new Connectors(store, new IntegrationsAuth(store));
    assert.equal(
      (await service.changeTicketStatus(42, "Resolved")).success,
      true,
    );
    assert.equal(
      (await service.assignTicket(42, source, person.id)).verified,
      true,
    );
    assert.equal(reads, 4);
    assert.equal(writes, 2);
    assert.equal(
      (store.db.prepare("SELECT COUNT(*) n FROM tickets").get() as any).n,
      0,
    );
    if (trash) {
      const row = store.ticketTrash()[0];
      assert.equal(row.state, "Resolved");
      assert.equal(row.assigned, person.name);
      assert.equal(row.removedAt, originalRemoval);
      store.restoreLocalTicket(42, source);
      assert.equal(
        (
          store.db
            .prepare("SELECT assigned FROM tickets WHERE id=42")
            .get() as any
        ).assigned,
        person.name,
      );
    } else assert.equal(store.ticketTrash().length, 0);
  });
}
