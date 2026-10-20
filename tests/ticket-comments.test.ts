import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Connectors } from "../server/connectors.js";
import { IntegrationsAuth } from "../server/auth.js";

test("ticket comments escape plain text, update cached cards and reject stale sources", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-comments-"));
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
  store.setSecret("azure.pat", "pat");
  const source = store.source();
  for (const ref of ["one", "two"])
    store.db
      .prepare("INSERT INTO ticket_cards VALUES (?,?)")
      .run(ref, JSON.stringify({ id: 42, source, comments: [] }));
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    const u = new URL(String(url));
    calls.push(init.method || "GET");
    if (init.method === "POST") {
      assert.equal(
        u.pathname,
        "/Collection/Project/_apis/wit/workitems/42/comments",
      );
      assert.equal(u.searchParams.get("format"), "html");
      assert.equal(u.searchParams.get("api-version"), "7.1-preview.4");
      assert.equal(
        JSON.parse(init.body).text,
        "<p>&lt;b&gt;Hello&lt;/b&gt;<br>Next &amp; last</p>",
      );
      return Response.json({
        id: 17,
        createdBy: { displayName: "Anna" },
        createdDate: "2026-10-20T00:00:00Z",
      });
    }
    return Response.json({
      id: 42,
      fields: { "System.TeamProject": "Project" },
    });
  });
  const connectors = new Connectors(store, new IntegrationsAuth(store));
  const result = await connectors.addTicketComment(
    "one",
    "<b>Hello</b>\nNext & last",
  );
  assert.equal(result.comment.author, "Anna");
  assert.deepEqual(calls, ["GET", "POST"]);
  for (const ref of ["one", "two"])
    assert.equal(connectors.ticketCard(ref).comments[0].id, 17);
  await assert.rejects(() => connectors.addTicketComment("one", "  "), /10000/);
  store.set("settings", { ...store.settings(), azureProject: "Other" });
  await assert.rejects(
    () => connectors.addTicketComment("one", "Text"),
    /Подключение Azure изменилось/,
  );
  assert.deepEqual(calls, ["GET", "POST"]);
});
