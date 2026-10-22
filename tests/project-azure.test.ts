import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";

test("Azure project bindings follow context and preserve legacy defaults", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-project-azure-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/Org",
    azureProject: "Legacy",
  });
  const a = { client: "Customer", project: "A" };
  const b = { client: "Customer", project: "B" };
  store.addContext(a);
  store.addContext(b);
  const { app } = createApp(store);
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
    "X-CSRF-Token": setup.body.csrf,
    Cookie: setup.headers["set-cookie"][0].split(";")[0],
  };
  await request(app)
    .put("/api/context/azure")
    .set(auth)
    .send({ ...a, azureProject: "RACID" })
    .expect(200);
  await request(app).put("/api/context").set(auth).send(a).expect(200);
  assert.equal(store.settings().azureProject, "RACID");
  assert.equal(store.source(), "https://ado.test/Org|RACID");
  assert.equal(store.rawSettings().azureProject, "Legacy");
  await request(app).put("/api/context").set(auth).send(b).expect(200);
  assert.equal(store.settings().azureProject, "Legacy");
  assert.equal(store.settings(a).azureProject, "RACID");
  await request(app)
    .put("/api/context/azure")
    .set(auth)
    .send({ client: "Unknown", project: "A", azureProject: "Other" })
    .expect(400);
  await request(app)
    .put("/api/context/azure")
    .set(auth)
    .send({
      client: "Customer",
      project: "",
      azureUrl: "https://ado.test/Client",
      azureProject: "ClientProject",
    })
    .expect(200);
  assert.equal(store.settings(b).azureProject, "ClientProject");
  assert.equal(store.settings(b).azureUrl, "https://ado.test/Client");
  assert.equal(store.settings(a).azureProject, "RACID");
  await request(app)
    .put("/api/context/azure")
    .set(auth)
    .send({ ...a, inherit: true })
    .expect(200);
  assert.equal(store.settings(a).azureProject, "Legacy");
  assert.equal(store.rawSettings().azureProject, "Legacy");
  const inherited = await request(app).get("/api/context/azure").query(a).set(auth).expect(200);
  assert.equal(inherited.body.inherit, true);
  assert.equal(inherited.body.parent.azureProject, "Legacy");
  const staleSettings = store.settings();
  await request(app).put("/api/context/azure").set(auth).send({ client: "", project: "", azureUrl: "https://ado.test/tfs/My Collection", azureProject: "Global Project" }).expect(200);
  assert.equal(store.settings(a).azureUrl, "https://ado.test/tfs/My%20Collection");
  assert.equal(store.settings(a).azureProject, "Global Project");
  assert.equal(store.settings(b).azureProject, "ClientProject"); // Existing customer binding is preserved.
  await request(app).put("/api/settings").set(auth).send(staleSettings).expect(200);
  assert.equal(store.rawSettings().azureProject, "Global Project");
  await request(app).put("/api/context/azure").set(auth).send({ client: "", project: "", inherit: true }).expect(400);
});
