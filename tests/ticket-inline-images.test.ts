import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { Connectors } from "../services/backend/src/connectors.js";
import {
  ticketInlineImages,
  withTicketInlineImages,
} from "../services/backend/src/ticket-inline-images.js";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5X8AAAAASUVORK5CYII=";
const source = `data:image/png;base64,${png}`;
test("inline images decode, deduplicate across fields/comments and preserve original snapshot", () => {
  const card = {
    fields: { description: `<img src="${source}">`, steps: source },
    comments: [{ richText: `<img src='${source}'>` }],
    attachments: [],
  };
  const before = JSON.stringify(card);
  const result = withTicketInlineImages<any>(card);
  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0].inline, true);
  assert.match(result.fields.description, /orbit.invalid\/ticket-inline-image\/inline-/);
  assert.equal(JSON.stringify(card), before);
  assert.deepEqual([...ticketInlineImages(card).values()][0].body, Buffer.from(png, "base64"));
});
test("reject malformed, MIME-mismatched, oversized data, SVG and foreign blobs", () => {
  for (const src of [
    "blob:https://ado.test/abc",
    "data:image/svg+xml;base64,PHN2Zz4=",
    `data:image/jpeg;base64,${png}`,
    "data:image/png;base64,====",
    `data:image/png;base64,${"A".repeat(14 * 1024 * 1024)}`,
  ]) {
    assert.equal(ticketInlineImages({ fields: { description: `<img src="${src}">` } }).size, 0);
  }
  const jpeg = Buffer.from([255, 216, 255, 224]).toString("base64");
  assert.equal(
    [
      ...ticketInlineImages({ fields: { description: `data:image/jpeg;base64,${jpeg}` } }).values(),
    ][0].type,
    "image/jpeg",
  );
});
test("old saved cards serve embedded pixels without Azure or extra stored files", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-inline-"));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const card = {
    source: store.source(),
    fields: { description: `<img src="${source}">` },
    comments: [],
    attachments: [],
  };
  const stored = JSON.stringify(card);
  store.db.prepare("INSERT INTO ticket_cards VALUES (?,?)").run("old-card", stored);
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Must not fetch embedded images");
  });
  const connectors = new Connectors(store);
  const first = connectors.ticketCard("old-card");
  const second = connectors.ticketCard("old-card");
  assert.equal(first.attachments[0].id, second.attachments[0].id);
  const image = await connectors.attachment("old-card", first.attachments[0].id);
  assert.equal(image.type, "image/png");
  assert.deepEqual(image.body, Buffer.from(png, "base64"));
  assert.equal(
    (store.db.prepare("SELECT data FROM ticket_cards WHERE id=?").get("old-card") as any).data,
    stored,
  );
});
