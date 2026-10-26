import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { Connectors } from "../services/backend/src/connectors.js";

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
        .run(source, 42, "Bug", "Active", "Previous", "Bug", "https://ado.test/42", "", "");
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
    store.db.prepare("INSERT INTO ticket_cards(id,data) VALUES (?,?)").run(
      "saved-detail",
      JSON.stringify({
        id: 42,
        source,
        fields: { "System.State": "Old" },
        comments: [],
        markdownFields: ["System.Description"],
      }),
    );
    store.db
      .prepare("INSERT INTO ticket_content_cache VALUES (?,?,?,?,?,?)")
      .run(source, 42, "criteria", "Deleted criteria", "deleted criteria", "old");
    let reads = 0,
      writes = 0;
    t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
      if (String(url).includes("/states?"))
        return Response.json({
          value: [{ name: "Active" }, { name: "Resolved" }],
        });
      if (init.method === "PATCH") {
        writes++;
        fields["System.Description"] = `<p>Updated description ${writes}</p>`;
        fields["System.ChangedDate"] = `2026-10-22T10:00:0${writes}Z`;
        for (const patch of JSON.parse(init.body)) {
          if (patch.path === "/fields/System.State") fields["System.State"] = patch.value;
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
    const service = new Connectors(store);
    assert.equal((await service.changeTicketStatus(42, "Resolved")).success, true);
    const cachedCard = () =>
      JSON.parse(
        (store.db.prepare("SELECT data FROM ticket_cards WHERE id='saved-detail'").get() as any)
          .data,
      );
    assert.equal(cachedCard().fields["System.State"], "Resolved");
    assert.equal(cachedCard().fields["System.Description"], "<p>Updated description 1</p>");
    assert.equal(cachedCard().markdownFields, undefined);
    assert.equal(
      (
        store.db
          .prepare(
            "SELECT body FROM ticket_content_cache WHERE source=? AND id=42 AND section='criteria'",
          )
          .get(source) as any
      ).body,
      "",
    );
    assert.equal((await service.assignTicket(42, source, person.id)).verified, true);
    assert.equal(cachedCard().fields["System.AssignedTo"].displayName, person.name);
    assert.equal(cachedCard().fields["System.Description"], "<p>Updated description 2</p>");
    assert.match(
      (
        store.db
          .prepare(
            "SELECT body FROM ticket_content_cache WHERE source=? AND id=42 AND section='description'",
          )
          .get(source) as any
      ).body,
      /Updated description 2/,
    );
    assert.equal(reads, 4);
    assert.equal(writes, 2);
    assert.equal((store.db.prepare("SELECT COUNT(*) n FROM tickets").get() as any).n, 0);
    if (trash) {
      const row = store.ticketTrash()[0];
      assert.equal(row.state, "Resolved");
      assert.equal(row.assigned, person.name);
      assert.equal(row.removedAt, originalRemoval);
      store.restoreLocalTicket(42, source);
      assert.equal(
        (store.db.prepare("SELECT assigned FROM tickets WHERE id=42").get() as any).assigned,
        person.name,
      );
    } else assert.equal(store.ticketTrash().length, 0);
  });
}
