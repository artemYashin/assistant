import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { Store } from "../services/backend/src/store.js";
import { createApp } from "../services/backend/src/app.js";

test("legacy populated settings default to inline; explicit action survives old clients and restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-click-"));
  let store = new Store(dir);
  try {
    const { ticketClickAction: _, ...legacy } = store.settings();
    store.set("settings", { ...legacy, memoryLanguage: "Russian" });
    store.db
      .prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)")
      .run(store.source(), 42, "Saved", "Active", "", "Bug", "url", "", "");
    assert.equal(store.settings().ticketClickAction, "inline");
    const { app } = createApp(store);
    const headers = {
      Host: "localhost:43871",
      Origin: "http://localhost:43871",
      "X-Orbit-Request": "1",
    };
    const setup = await request(app)
      .post("/api/auth/setup")
      .set(headers)
      .send({ password: "correct-password-long" })
      .expect(200);
    const auth = {
      ...headers,
      Cookie: setup.headers["set-cookie"][0].split(";")[0],
      "X-CSRF-Token": setup.body.csrf,
    };
    for (const action of ["popup", "select", "inline", "popup"]) {
      await request(app)
        .put("/api/settings")
        .set(auth)
        .send({ ...store.settings(), ticketClickAction: action })
        .expect(200);
      assert.equal(store.settings().ticketClickAction, action);
    }
    const { ticketClickAction: omitted, ...oldClient } = store.settings();
    await request(app).put("/api/settings").set(auth).send(oldClient).expect(200);
    assert.equal(store.settings().ticketClickAction, "popup");
    await request(app)
      .put("/api/settings")
      .set(auth)
      .send({ ...store.settings(), ticketClickAction: "invalid" })
      .expect(400);
    store.close();
    store = new Store(dir);
    assert.equal(store.settings().ticketClickAction, "popup");
    assert.equal(store.settings().memoryLanguage, "Russian");
    assert.equal(
      (store.db.prepare("SELECT title FROM tickets WHERE id=42").get() as any).title,
      "Saved",
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
