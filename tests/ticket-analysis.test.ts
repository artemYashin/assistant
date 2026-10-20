import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { listTicketAnalysis } from "../server/ticket-analysis.js";
import { listLocalTickets } from "../server/ticket-list.js";
import { allowsFullTicketRead } from "../server/ticket-display.js";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-analysis-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  for (const id of [1, 2, 3, 4])
    store.db
      .prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)")
      .run(
        store.source(),
        id,
        `Title ${id}`,
        "Active",
        "",
        "Bug",
        "",
        "",
        "now",
      );
  return store;
}
test("deep reads require explicit current user intent; summaries are the default", async (t) => {
  const store = fixture(t);
  for (const prompt of [
    "Проведи глубокий анализ этих тикетов",
    "Найди в описаниях слово protocol",
    "Read acceptance criteria",
    "Покажи описание тикета 42",
  ])
    assert.ok(allowsFullTicketRead(prompt), prompt);
  for (const prompt of [
    "Добавь им тег UI",
    "Покажи список тикетов",
    "Не проводи глубокий анализ",
    "Without deep analysis",
    "Да",
  ])
    assert.ok(!allowsFullTicketRead(prompt), prompt);
  let reads = 0;
  const read = async () => {
    reads++;
    return {};
  };
  await assert.rejects(
    listTicketAnalysis(store, { ids: [1], detail: "full" }, false, read),
    /явной просьбы/,
  );
  await assert.rejects(
    listTicketAnalysis(store, { detail: "full" }, true, read),
    /точные ID/,
  );
  assert.equal(reads, 0);
  const summary = listLocalTickets(store, { ids: [1, 2] });
  assert.equal(summary.tickets.length, 2);
  assert.equal(summary.tickets[0].content, undefined);
});
test("full search matches descriptions rather than only titles and advances through nonmatches", async (t) => {
  const store = fixture(t);
  const read = async (id: number) => ({
    fields: {
      "System.Title": `Title ${id}`,
      "System.Description": id === 2 ? "<b>Needle</b>" : "Other",
    },
    comments: [],
  });
  const result = await listTicketAnalysis(
    store,
    { ids: [1, 2, 3, 4], detail: "full", search: "needle" },
    true,
    read,
  );
  assert.deepEqual(
    result.tickets.map((x) => x.id),
    [2],
  );
  assert.equal(result.hasMore, true);
  assert.equal(result.nextAfterId, 3);
  const next = await listTicketAnalysis(
    store,
    { ids: [1, 2, 3, 4], detail: "full", search: "needle", afterId: 3 },
    true,
    read,
  );
  assert.equal(next.tickets.length, 0);
  assert.equal(next.hasMore, false);
});
test("large descriptions are paginated without silently dropping text", async (t) => {
  const store = fixture(t);
  const description = 'quoted "text" '.repeat(4000);
  const read = async () => ({
    fields: { "System.Description": description },
    comments: [],
    warnings: [],
  });
  let afterId = 0,
    contentOffset = 0,
    combined = "",
    finished = false;
  for (let page = 0; page < 20; page++) {
    const result = await listTicketAnalysis(
      store,
      { ids: [1], detail: "full", afterId, contentOffset },
      true,
      read,
    );
    assert.ok(JSON.stringify(result).length < 24000);
    combined += result.tickets.map((x) => x.content).join("");
    if (!result.hasMore) {
      finished = true;
      break;
    }
    assert.ok(result.nextContentOffset > contentOffset);
    afterId = result.nextAfterId!;
    contentOffset = result.nextContentOffset;
  }
  assert.ok(finished);
  assert.ok(combined.includes(description.trim()));
});
