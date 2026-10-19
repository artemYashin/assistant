import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
test("context registry migrates existing history, isolates projects and persists selection", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-contexts-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.say("user", "old", { client: "Legacy", project: "Old" });
  const { app } = createApp(store);
  const headers = {
    Host: "localhost:3000",
    Origin: "http://localhost:3000",
    "X-Orbit-Request": "1",
  };
  await request(app).get("/api/contexts").set(headers).expect(401);
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
  const initial = await request(app).get("/api/contexts").set(auth).expect(200);
  assert.ok(
    initial.body.some((c: any) => c.client === "Legacy" && c.project === "Old"),
  );
  await request(app)
    .post("/api/contexts")
    .set(auth)
    .send({ client: "A", project: "One" })
    .expect(200);
  await request(app)
    .post("/api/contexts")
    .set(auth)
    .send({ client: "A", project: "One" })
    .expect(200);
  await request(app)
    .post("/api/contexts")
    .set(auth)
    .send({ client: "B", project: "" })
    .expect(200);
  await request(app)
    .put("/api/context")
    .set(auth)
    .send({ client: "B", project: "One" })
    .expect(400);
  await request(app)
    .put("/api/context")
    .set(auth)
    .send({ client: "A", project: "One" })
    .expect(200);
  assert.equal(store.settings().project, "One");
  const reopened = new Store(dir);
  try {
    assert.equal(reopened.settings().project, "One");
    assert.ok(
      reopened.contexts().some((c) => c.client === "A" && c.project === "One"),
    );
  } finally {
    reopened.close();
  }

  await request(app)
    .put("/api/settings")
    .set(auth)
    .send({ ...store.settings(), client: "", project: "" })
    .expect(200);
  assert.equal(store.settings().client, "A");
  assert.equal(store.settings().project, "One");
  await request(app)
    .post("/api/contexts")
    .set(auth)
    .send({ client: " ", project: "Bad" })
    .expect(400);
  await request(app)
    .put("/api/context")
    .set({ ...headers, Cookie: auth.Cookie })
    .send({ client: "", project: "" })
    .expect(403);
  await request(app)
    .put("/api/context")
    .set(auth)
    .send({ client: "", project: "" })
    .expect(200);
  assert.equal(store.settings().client, "");
  assert.equal(store.contexts().filter((c) => c.client === "A").length, 2);
});

test("Teams stays disabled and new Azure APIs enforce authentication and filter validation", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-azure-api-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("microsoft.connected", true);
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No background Teams calls allowed");
  });
  const { app, sync } = createApp(store);
  assert.equal((await sync()).state, "ok");
  assert.equal(store.settings().syncSeconds, 600);
  const headers = {
    Host: "localhost:3000",
    Origin: "http://localhost:3000",
    "X-Orbit-Request": "1",
  };
  for (const path of [
    "/api/pr",
    "/api/pr/projects",
    "/api/tickets/42/details",
    "/api/ticket-cards/missing",
    "/api/ticket-cards/missing/attachments/missing",
  ])
    await request(app).get(path).set(headers).expect(401);
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
  await request(app)
    .put("/api/settings")
    .set(auth)
    .send({
      ...store.settings(),
      azureAutoImport: true,
      azureTypes: [],
      azureStates: [],
    })
    .expect(400);
  await request(app)
    .post("/api/pr/projects")
    .set({ ...headers, Cookie: auth.Cookie })
    .send({})
    .expect(403);
});
