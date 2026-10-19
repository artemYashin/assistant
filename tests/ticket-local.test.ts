import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
test("local assignment and removal never write Azure and survive import", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-local-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test",
    azureProject: "P",
  });
  store.setSecret("azure.pat", "pat");
  const { app, connectors } = createApp(store);
  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  const setup = await request(app)
    .post("/api/auth/setup")
    .set(headers)
    .send({ password: "long-enough-password" })
    .expect(200);
  const auth = {
    ...headers,
    Cookie: setup.headers["set-cookie"][0].split(";")[0],
    "X-CSRF-Token": setup.body.csrf,
  };
  const calls: string[] = [];
  const item = {
    id: 42,
    fields: {
      "System.TeamProject": "P",
      "System.Title": "Bug",
      "System.State": "Active",
      "System.AssignedTo": { displayName: "ADO owner" },
    },
  };
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    const url = new URL(raw);
    calls.push(`${init.method || "GET"} ${url.pathname}`);
    if (url.pathname.endsWith("/teams"))
      return Response.json({ value: [{ id: "team" }] });
    if (url.pathname.endsWith("/members"))
      return Response.json({
        value: [
          { identity: { id: "developer", displayName: "Dev" } },
          { identity: { id: "group", isContainer: true } },
        ],
      });
    if (url.pathname.endsWith("/wiql"))
      return Response.json({ workItems: [{ id: 42 }] });
    if (url.pathname.endsWith("workitemsbatch"))
      return Response.json({ value: [item] });
    return Response.json(item);
  });
  await connectors.trackTicket(42);
  await request(app)
    .post("/api/developers/refresh")
    .set(auth)
    .send({})
    .expect(200);
  const before = calls.length;
  await request(app)
    .put("/api/tickets/42/developer")
    .set(auth)
    .send({ developerId: "forged" })
    .expect(400);
  await request(app)
    .put("/api/tickets/42/developer")
    .set(auth)
    .send({ developerId: "developer" })
    .expect(200);
  assert.equal(calls.length, before);
  await connectors.syncTickets();
  let rows = (await request(app).get("/api/tickets").set(auth).expect(200))
    .body;
  assert.equal(rows[0].developer_name, "Dev");
  assert.equal(rows[0].assigned, "ADO owner");
  await request(app).delete("/api/tickets/42").set(headers).expect(401);
  await request(app).delete("/api/tickets/42").set(auth).expect(200);
  await connectors.syncTickets(true);
  rows = (await request(app).get("/api/tickets").set(auth)).body;
  assert.equal(rows.length, 0);
  await connectors.trackTicket(42);
  rows = (await request(app).get("/api/tickets").set(auth)).body;
  assert.equal(rows[0].developer_name, "Dev");
  assert.ok(
    calls.every((c) => !c.startsWith("PATCH") && !c.startsWith("DELETE")),
  );
  const settings = store.settings();
  await request(app)
    .put("/api/settings")
    .set(auth)
    .send({ ...settings, statusColors: { Active: "red; bad" } })
    .expect(400);
  await request(app)
    .put("/api/settings")
    .set(auth)
    .send({ ...settings, statusColors: { Active: "#123456" } })
    .expect(200);
  assert.deepEqual(store.settings().statusColors, { Active: "#123456" });
});
