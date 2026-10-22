import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, AppError } from "../server/store.js";
import { Approvals } from "../server/approvals.js";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-test-"));
  const store = new Store(dir);
  store.db
    .prepare("INSERT INTO chats(id,name) VALUES (?,?)")
    .run("chat-1", "Test team");
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, dir };
}

test("draft never sends; concurrent approval sends the frozen text exactly once", async (t) => {
  const { store } = fixture(t);
  let sends: any[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const approvals = new Approvals(store, async (id, body) => {
    sends.push({ id, body });
    await gate;
    return { id: "remote-1" };
  });
  const draft = approvals.propose("chat-1", "Approved content");
  assert.equal(sends.length, 0);
  const first = approvals.approve(draft.id);
  await assert.rejects(
    approvals.approve(draft.id),
    (e: any) => e.status === 409,
  );
  release();
  await first;
  assert.deepEqual(sends, [{ id: "chat-1", body: "Approved content" }]);
  await assert.rejects(approvals.approve(draft.id));
  assert.equal(sends.length, 1);
  assert.equal((approvals.list()[0] as any).status, "sent");
});
test("rejected and expired drafts cannot send", async (t) => {
  const { store } = fixture(t);
  let count = 0;
  const approvals = new Approvals(store, async () => {
    count++;
    return { id: "remote" };
  });
  const rejected = approvals.propose("chat-1", "reject");
  approvals.reject(rejected.id);
  await assert.rejects(approvals.approve(rejected.id));
  const expired = approvals.propose("chat-1", "expired");
  store.db
    .prepare("UPDATE approvals SET expires_at=? WHERE id=?")
    .run("2000-01-01T00:00:00.000Z", expired.id);
  await assert.rejects(approvals.approve(expired.id));
  assert.equal(count, 0);
});
test("timeout becomes unknown and is never retried", async (t) => {
  const { store } = fixture(t);
  let count = 0;
  const approvals = new Approvals(store, async () => {
    count++;
    throw new Error("timeout after server accepted");
  });
  const { id } = approvals.propose("chat-1", "Hello");
  await assert.rejects(approvals.approve(id));
  await assert.rejects(approvals.approve(id));
  assert.equal(count, 1);
  assert.equal((approvals.list()[0] as any).status, "unknown");
});
test("restart leaves interrupted sends unknown; encrypted secrets survive restart", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-restart-"));
  let store = new Store(dir);
  store.setSecret("token", "super-secret-token");
  store.db
    .prepare("INSERT INTO chats(id,name) VALUES (?,?)")
    .run("chat-1", "Test");
  const draft = new Approvals(store, async () => ({ id: "remote" })).propose(
    "chat-1",
    "body",
  );
  store.db
    .prepare("UPDATE approvals SET status='sending' WHERE id=?")
    .run(draft.id);
  store.close();
  store = new Store(dir);
  try {
    assert.equal(store.secret("token"), "super-secret-token");
    assert.equal(
      (
        store.db
          .prepare("SELECT status FROM approvals WHERE id=?")
          .get(draft.id) as any
      ).status,
      "unknown",
    );
    assert.equal(
      readFileSync(join(dir, "orbit.sqlite")).includes(
        Buffer.from("super-secret-token"),
      ),
      false,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("memory isolates project and client context but includes general memory", (t) => {
  const { store } = fixture(t);
  store.addMemory("general", "general", { client: "", project: "" });
  store.addMemory("client", "client A", { client: "A", project: "" });
  store.addMemory("project", "project A1", { client: "A", project: "One" });
  store.addMemory("project", "project B1", { client: "B", project: "One" });
  assert.deepEqual(
    new Set(
      (store.memories({ client: "A", project: "One" }) as any[]).map(
        (m) => m.body,
      ),
    ),
    new Set(["general", "client A", "project A1"]),
  );
  assert.deepEqual(
    (store.memories({ client: "", project: "" }) as any[]).map((m) => m.body),
    ["general"],
  );
  assert.throws(
    () => store.addMemory("project", "bad", { client: "A", project: "" }),
    AppError,
  );
});

test("clearing confirmations removes all drafts but preserves saved memory and never sends", async t => {
  const { store } = fixture(t);
  const { MemoryProposals } = await import("../server/memory-proposals.js");
  const proposals = new MemoryProposals(store);
  const context = { client: "C", project: "P" };
  const proposal = proposals.propose({ scope: "project", summary: "Fact", body: "Saved fact", reason: "Useful" }, context);
  proposals.decide(proposal.id!, true);
  proposals.propose({ scope: "general", body: "Pending fact", reason: "Useful" }, context);
  let sends = 0;
  const approvals = new Approvals(store, async () => { sends++; return { id: "remote" }; });
  approvals.propose("chat-1", "Pending message");
  const old = approvals.propose("chat-1", "Rejected message");
  approvals.reject(old.id);
  assert.deepEqual(approvals.clearAll(), { proposals: 2, messages: 2 });
  assert.equal(proposals.list().length, 0);
  assert.equal(approvals.list().length, 0);
  assert.equal(store.memoryCatalog(context).length, 1);
  assert.equal(sends, 0);
});

test("clearing confirmations is atomic and blocked during message delivery", async t => {
  const { store } = fixture(t);
  const { MemoryProposals } = await import("../server/memory-proposals.js");
  const proposals = new MemoryProposals(store);
  proposals.propose({ scope: "general", body: "Keep draft", reason: "Useful" }, { client: "", project: "" });
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const approvals = new Approvals(store, async () => { await gate; return { id: "remote" }; });
  const draft = approvals.propose("chat-1", "Sending message");
  const sending = approvals.approve(draft.id);
  assert.throws(() => approvals.clearAll(), /Дождитесь завершения/);
  assert.equal(proposals.list().length, 1);
  assert.equal(approvals.list().length, 1);
  finish(); await sending;
  assert.deepEqual(approvals.clearAll(), { proposals: 1, messages: 1 });
});
