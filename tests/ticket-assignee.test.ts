import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Connectors } from "../server/connectors.js";
import { IntegrationsAuth } from "../server/auth.js";

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
    const connectors = new Connectors(store, new IntegrationsAuth(store));
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
    else assert.equal((await result).verified, true);
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
  });
}
