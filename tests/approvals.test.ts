import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, AppError } from "../services/backend/src/store.js";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-test-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, dir };
}

test("memory isolates project and client context but includes general memory", (t) => {
  const { store } = fixture(t);
  store.addMemory("general", "general", { client: "", project: "" });
  store.addMemory("client", "client A", { client: "A", project: "" });
  store.addMemory("project", "project A1", { client: "A", project: "One" });
  store.addMemory("project", "project B1", { client: "B", project: "One" });
  assert.deepEqual(
    new Set((store.memories({ client: "A", project: "One" }) as any[]).map((m) => m.body)),
    new Set(["general", "client A", "project A1"]),
  );
  assert.deepEqual(
    (store.memories({ client: "", project: "" }) as any[]).map((m) => m.body),
    ["general"],
  );
  assert.throws(() => store.addMemory("project", "bad", { client: "A", project: "" }), AppError);
});
