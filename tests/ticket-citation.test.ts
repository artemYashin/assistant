import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { ticketCitationTool } from "../server/ticket-citation.js";
import { chatTicketCitation } from "../src/shared/config/routes/index.js";

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-cite-review-"));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return store;
}
test("review verifies supplied ticket evidence without import or a cache fallback", async t => {
  const store = fixture(t), source = store.source();
  const tool = ticketCitationTool(store, () => {}, { source, tickets: [{ id: 42, description: "The title must be unique.", criteria: "Показывать ошибку при пустом имени.", repro: "Open the editor." }] });
  const result = await tool.handler!({ id: 42, section: "criteria", quote: "Показывать ошибку при пустом имени." }, {} as any) as any;
  assert.deepEqual(chatTicketCitation(result.originalUrl), { id: 42, source, section: "criteria", quote: result.quote });
  assert.equal(store.hasLocalTicket(42), false);
  await assert.rejects(async () => tool.handler!({ id: 42, section: "description", quote: "Показывать ошибку при пустом имени." }, {} as any), /не найдена/);
  store.db.prepare("INSERT INTO ticket_content_cache VALUES (?,?,?,?,?,?)").run(source, 99, "description", "Unrelated text", "unrelated text", "now");
  await assert.rejects(async () => tool.handler!({ id: 99, section: "description", quote: "Unrelated text" }, {} as any), /не найдена/);
});
test("chat citations continue to verify local cached text", async t => {
  const store = fixture(t), source = store.source();
  store.db.prepare("INSERT INTO ticket_content_cache VALUES (?,?,?,?,?,?)").run(source, 1, "description", "Existing requirement", "existing requirement", "now");
  const result: any = await ticketCitationTool(store, () => {}).handler!({ id: 1, section: "description", quote: "Existing requirement" }, {} as any);
  assert.equal(chatTicketCitation(result.originalUrl)?.id, 1);
});
