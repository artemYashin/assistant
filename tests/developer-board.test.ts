import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { LocalDevelopers } from "../server/local-developers.js";

test("developer notes and completed states stay local and scoped to project", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-board-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Must not call Azure");
  });
  const { app } = createApp(store);
  const context = { client: "Customer", project: "One" },
    other = { ...context, project: "Two" };
  const people = new LocalDevelopers(store);
  const global = people.add(["Global Dev"], { client: "", project: "" })[0];
  const project = people
    .add(["Project Dev"], context)
    .find((person) => person.name === "Project Dev")!;
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
  await request(app)
    .put(`/api/developer-board/${global.id}/notes`)
    .set(auth)
    .send({ context, notes: "Private project note" })
    .expect(200);
  await request(app)
    .put("/api/developer-board/states")
    .set(auth)
    .send({ context, states: ["Resolved"] })
    .expect(200);
  const read = await request(app)
    .get("/api/developer-board")
    .query(context)
    .set(auth)
    .expect(200);
  assert.equal(
    read.body.developers.find((person: any) => person.id === global.id).notes,
    "Private project note",
  );
  assert.deepEqual(read.body.completedStates, ["Resolved"]);
  const second = await request(app)
    .get("/api/developer-board")
    .query(other)
    .set(auth)
    .expect(200);
  assert.equal(second.body.developers[0].notes, "");
  assert.ok(!second.body.completedStates.includes("Resolved"));
  await request(app)
    .put(`/api/developer-board/${project.id}/notes`)
    .set(auth)
    .send({ context: other, notes: "Wrong scope" })
    .expect(404);
  await request(app)
    .put(`/api/developer-board/${global.id}/notes`)
    .set(headers)
    .send({ context, notes: "Unauthorized" })
    .expect(401);
});
