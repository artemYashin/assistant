import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ticketAttachmentId } from "../services/backend/src/ticket-attachment-url.js";
import { Store } from "../services/backend/src/store.js";
import { Connectors } from "../services/backend/src/connectors.js";

const base = "https://dev.azure.com/example";
const id = "11111111-2222-3333-4444-555555555555";
const proxy = `https://dev.azure.com.mcas.ms/example/Project/_apis/wit/attachments/${id}?fileName=image.png&mcasCtx=ignored`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5X8AAAAASUVORK5CYII=",
  "base64",
);

test("MCAS attachment aliases retain configured origin and collection boundaries", () => {
  assert.equal(ticketAttachmentId(proxy, base), id);
  assert.equal(ticketAttachmentId(proxy.replace(".mcas.ms", ""), base), id);
  assert.equal(
    ticketAttachmentId(
      proxy.replace("dev.azure.com", "ado.example.test"),
      base.replace("dev.azure.com", "ado.example.test"),
    ),
    id,
  );
  for (const invalid of [
    proxy.replace(".mcas.ms", ".mcas.ms.evil.test"),
    proxy.replace("dev.azure.com", "foreign.azure.com"),
    proxy.replace("https:", "http:"),
    proxy.replace(".mcas.ms/", ".mcas.ms:8443/"),
    proxy.replace("https://", "https://someone:secret@"),
    proxy.replace("/example/", "/example-other/"),
    proxy.replace("/example/", "/another/"),
    proxy.replace("/example/Project/", "/example/../../another/"),
    proxy.replace("/wit/attachments/", "/wit/workitems/"),
  ])
    assert.equal(ticketAttachmentId(invalid, base), undefined, invalid);
  assert.equal(ticketAttachmentId(proxy, base.replace("https:", "http:")), undefined);
});

function fixture(t: any) {
  const directory = mkdtempSync(join(tmpdir(), "orbit-mcas-images-"));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  store.set("settings", { ...store.settings(), azureUrl: base, azureProject: "Project" });
  store.setSecret("azure.pat", "test-pat");
  return { store, connectors: new Connectors(store) };
}

test("saved HTML and Markdown MCAS comments recover read-only and download via original API", async (t) => {
  const { store, connectors } = fixture(t);
  const original = JSON.stringify({
    id: 42,
    source: store.source(),
    base,
    project: "Project",
    loadedAt: "2026-10-01T00:00:00Z",
    fields: {},
    attachments: [],
    comments: [
      { richText: `<img src="${proxy}">` },
      { richText: `![image](${proxy} "Screenshot")` },
    ],
  });
  store.db.prepare("INSERT INTO ticket_cards VALUES (?,?)").run("old", original);
  const metadata = { id, name: "Saved filename.png", image: false, custom: "preserved" };
  const withMetadata = JSON.stringify({ ...JSON.parse(original), attachments: [metadata] });
  store.db.prepare("INSERT INTO ticket_cards VALUES (?,?)").run("metadata", withMetadata);
  assert.deepEqual(connectors.ticketCard("metadata").attachments, [{ ...metadata, image: true }]);
  assert.equal(
    (store.db.prepare("SELECT data FROM ticket_cards WHERE id=?").get("metadata") as any).data,
    withMetadata,
  );
  for (let i = 0; i < 2; i++) {
    const card = connectors.ticketCard("old");
    assert.deepEqual(
      card.attachments.map((a: any) => a.id),
      [id],
    );
    assert.deepEqual(card.comments, JSON.parse(original).comments);
  }
  t.mock.method(globalThis, "fetch", async (url: any, options: any) => {
    assert.equal(
      String(url),
      `${base}/Project/_apis/wit/attachments/${id}?api-version=${store.settings().azureVersion}`,
    );
    assert.equal(options.redirect, "error");
    assert.equal(
      options.headers.Authorization,
      `Basic ${Buffer.from(":test-pat").toString("base64")}`,
    );
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  });
  assert.deepEqual((await connectors.attachment("old", id)).body, png);
  assert.equal(
    (store.db.prepare("SELECT data FROM ticket_cards WHERE id=?").get("old") as any).data,
    original,
  );
  t.mock.method(globalThis, "fetch", async () => new Response("offline", { status: 503 }));
  await assert.rejects(connectors.attachment("old", id), /Не удалось загрузить/);
  const cached = await connectors.ticketDetails(42, true);
  assert.equal(cached.attachments[0].id, id);
  assert.equal(
    (store.db.prepare("SELECT data FROM ticket_cards WHERE id=?").get("old") as any).data,
    original,
  );
});

test("fresh MCAS comments and cached ticket content discover the same attachment", async (t) => {
  const { store, connectors } = fixture(t);
  const fields = {
    "System.Title": "Example",
    "System.TeamProject": "Project",
    "System.Description": `<img src="${proxy}">`,
  };
  t.mock.method(globalThis, "fetch", async (url: any) => {
    assert.equal(new URL(String(url)).origin, new URL(base).origin);
    if (String(url).includes("/comments"))
      return Response.json({ comments: [{ id: 1, text: `![image](${proxy})` }] });
    return Response.json({ id: 42, fields, relations: [] });
  });
  const card = await connectors.ticketDetails(42);
  assert.deepEqual(
    card.attachments.map((a: any) => a.id),
    [id],
  );
  // Exercise the same caching operation used by synchronization without requiring import setup.
  (connectors as any).cacheTicketContent({ id: 42, fields }, store.settings(), true);
  const content = store.db
    .prepare(
      "SELECT body FROM ticket_content_cache WHERE source=? AND id=? AND section='description'",
    )
    .get(store.source(), 42) as any;
  assert.match(content.body, new RegExp(`/api/ticket-cards/cache-[a-f0-9]+-42/attachments/${id}`));
  assert.equal(content.body.includes("mcas.ms"), false);
});
