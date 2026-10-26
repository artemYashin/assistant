import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { createApp } from "../services/backend/src/app.js";
test("image source returns Azure URL without downloading and checks attachment and connection", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-image-source-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.rawSettings(),
    azureUrl: "https://dev.azure.com/example",
    azureProject: "Project One",
  });
  const { app } = createApp(store),
    id = "11111111-1111-4111-8111-111111111111";
  store.db.prepare("INSERT INTO ticket_cards VALUES (?,?)").run(
    "ref",
    JSON.stringify({
      source: store.source(),
      base: "https://dev.azure.com/example",
      project: "Project One",
      attachments: [{ id }],
    }),
  );
  const path = `/api/ticket-cards/ref/attachments/${id}/source`;

  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  await request(app).get(path).set(headers).expect(401);
  const setup = await request(app)
    .post("/api/auth/setup")
    .set(headers)
    .send({ password: "long-test-password" })
    .expect(200);
  const auth = { ...headers, Cookie: setup.headers["set-cookie"][0].split(";")[0] };
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Must not download image");
  });
  const response = await request(app).get(path).set(auth).expect(200);
  assert.equal(
    response.body.url,
    `https://dev.azure.com/example/Project%20One/_apis/wit/attachments/${id}`,
  );
  await request(app)
    .get(path.replace(id, "22222222-2222-4222-8222-222222222222"))
    .set(auth)
    .expect(404);
  store.set("settings", { ...store.rawSettings(), azureProject: "Other" });
  await request(app).get(path).set(auth).expect(409);
});
