import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";

const headers = { Host: "localhost:43871", Origin: "http://localhost:43871", "X-Orbit-Request": "1" };

test("new installation opens without a password but retains session and request protection", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-local-login-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const { app } = createApp(store);
  const session = await request(app).get("/api/auth/session").set(headers).expect(200);
  assert.equal(session.body.passwordless, true);
  assert.equal(session.body.setupRequired, false);
  await request(app).get("/api/settings").set(headers).expect(401);
  await request(app).post("/api/auth/local").set({ ...headers, Origin: "https://other.invalid" }).expect(403);
  await request(app).post("/api/auth/local").set({ Host: headers.Host }).expect(403);
  await request(app).post("/api/auth/local").set({ ...headers, Host: "other.invalid" }).expect(403);
  const login = await request(app).post("/api/auth/local").set(headers).send({}).expect(200);
  const cookie = login.headers["set-cookie"][0].split(";")[0];
  const authenticated = { ...headers, Cookie: cookie, "X-CSRF-Token": login.body.csrf };
  assert.equal(store.secret("password"), undefined);
  await request(app).get("/api/settings").set(authenticated).expect(200);
  await request(app).post("/api/auth/logout").set({ ...headers, Cookie: cookie }).send({}).expect(403);
  const again = await request(app).post("/api/auth/local").set(authenticated).send({}).expect(200);
  assert.equal(again.body.csrf, login.body.csrf);
  await request(app).post("/api/auth/logout").set(authenticated).send({}).expect(200);
  await request(app).get("/api/settings").set(authenticated).expect(401);
  await request(app).post("/api/auth/local").set(headers).send({}).expect(200);
});

test("populated installations discard only the retired password and revoke sessions once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-legacy-login-"));
  let store = new Store(dir);
  try {
    store.addContext({ client: "Example", project: "Existing" });
    store.setSecret("azure.pat", "test-pat-preserved");
    store.setSecret("github.token", "test-github-preserved");
    // Reproduce a populated installation from before the migration.
    store.db.prepare("DELETE FROM kv WHERE key=?").run("migration.passwordlessAccess");
    store.setSecret("password", "old-salt:old-hash");
    store.db.prepare("INSERT INTO sessions VALUES (?,?,?)").run("old-token", "old-csrf", Date.now() + 86400000);
    const contexts = store.contexts();
    for (let i = 0; i < 2; i++) {
      store.close();
      store = new Store(dir);
      const { app } = createApp(store);
      assert.equal(store.secret("password"), undefined);
      assert.equal(store.get("migration.passwordlessAccess", false), true);
      assert.equal(store.secret("azure.pat"), "test-pat-preserved");
      assert.equal(store.secret("github.token"), "test-github-preserved");
      assert.deepEqual(store.contexts(), contexts);
      assert.equal(store.db.prepare("SELECT * FROM sessions WHERE token='old-token'").get(), undefined);
      if (i === 1) assert.ok(store.db.prepare("SELECT * FROM sessions WHERE token='new-token'").get());
      const session = await request(app).get("/api/auth/session").set(headers).expect(200);
      assert.equal(session.body.passwordless, true);
      await request(app).post("/api/auth/local").set(headers).send({}).expect(200);
      await request(app).post("/api/auth/setup").set(headers).send({ password: "ignored-password" }).expect(200);
      assert.equal(store.secret("password"), undefined);
      if (i === 0) store.db.prepare("INSERT INTO sessions VALUES (?,?,?)").run("new-token", "new-csrf", Date.now() + 86400000);
    }
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("password removal rolls back if recording migration completion fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-login-rollback-"));
  const store = new Store(dir);
  const originalSet = Store.prototype.set;
  let failedStore: Store | undefined;
  try {
    store.db.prepare("DELETE FROM kv WHERE key=?").run("migration.passwordlessAccess");
    store.setSecret("password", "legacy-password-hash");
    store.db.prepare("INSERT INTO sessions VALUES (?,?,?)").run("legacy", "csrf", Date.now() + 86400000);
    Store.prototype.set = function (key, value) {
      if (key === "migration.passwordlessAccess") {
        failedStore = this;
        throw new Error("simulated migration failure");
      }
      return originalSet.call(this, key, value);
    };
    assert.throws(() => new Store(dir), /simulated migration failure/);
    assert.equal(store.secret("password"), "legacy-password-hash");
    assert.ok(store.db.prepare("SELECT * FROM sessions WHERE token='legacy'").get());
    assert.equal(store.get("migration.passwordlessAccess", false), false);
  } finally {
    Store.prototype.set = originalSet;
    failedStore?.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
