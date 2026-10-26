import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { createApp } from "../services/backend/src/app.js";
test("status editor API requires CSRF and the original Azure source", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-state-ui-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const { app, connectors } = createApp(store);
  let writes = 0;
  t.mock.method(
    connectors,
    "changeTicketStatus",
    async (id: number, state: string, guard: () => void) => {
      guard();
      writes++;
      return {
        id,
        state,
        success: true as const,
        outcome: "changed" as const,
        previousState: "Active",
        verifiedAt: new Date().toISOString(),
      };
    },
  );
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
  };
  await request(app)
    .put("/api/tickets/42/state")
    .set(auth)
    .send({ state: "RFT", source: store.source() })
    .expect(403);
  const csrf = { ...auth, "X-CSRF-Token": setup.body.csrf };
  await request(app)
    .put("/api/tickets/42/state")
    .set(csrf)
    .send({ state: "RFT", source: "other-source" })
    .expect(409);
  assert.equal(writes, 0);
  const response = await request(app)
    .put("/api/tickets/42/state")
    .set(csrf)
    .send({ state: "RFT", source: store.source() })
    .expect(200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.state, "RFT");
  assert.equal(writes, 1);
});
