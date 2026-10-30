import { azureImageUrl, prDescriptionImages } from "../services/backend/src/pr-images.js";
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
const proxy = `/${id}?fileName=image.png`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5X8AAAAASUVORK5CYII=",
  "base64",
);

test("short attachment IDs only accept an exact root-relative UUID", () => {
  assert.equal(ticketAttachmentId(proxy, base), id);
  assert.equal(ticketAttachmentId(`/${id}`, base), id);
  for (const invalidBase of [
    "http://dev.azure.com/example",
    "https://user@dev.azure.com/example",
    "https://user:secret@dev.azure.com/example",
    "file:///example",
    "not a URL",
  ])
    assert.equal(ticketAttachmentId(proxy, invalidBase), undefined, invalidBase);
  assert.equal(ticketAttachmentId(`/${id.toUpperCase()}?fileName=image.png#preview`, base), id);
  for (const invalid of [
    `https://evil.example/${id}?fileName=image.png`,
    `${base}/${id}?fileName=image.png`,
    `https://dev.azure.com/${id}?fileName=image.png`,
    `//evil.example/${id}`,
    `/../${id}`,
    `/folder/${id}`,
    `/%2e%2e/${id}`,
    `/%2f${id}`,
    `/${id}/`,
    `/not-an-attachment?fileName=image.png`,
    `/${id.replace(/1/g, "-")}`,
    `/${id}\\evil`,
  ])
    assert.equal(ticketAttachmentId(invalid, base), undefined, invalid);
});

function fixture(t: any) {
  const directory = mkdtempSync(join(tmpdir(), "orbit-short-images-"));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  store.set("settings", { ...store.settings(), azureUrl: base, azureProject: "Project" });
  store.setSecret("azure.pat", "test-pat");
  return { store, connectors: new Connectors(store) };
}

test("saved HTML and Markdown short URL comments recover read-only and download via original API", async (t) => {
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

test("fresh short URL comments and cached ticket content discover the same attachment", async (t) => {
  const { store, connectors } = fixture(t);
  const fields = {
    "System.Title": "Example",
    "System.TeamProject": "Project",
    "System.Description": `<img src="${proxy}">`,
    "Microsoft.VSTS.Common.AcceptanceCriteria": `![image](${proxy})`,
    "Microsoft.VSTS.TCM.ReproSteps": `<img src="${proxy}">`,
    "Microsoft.VSTS.TCM.SystemInfo": `![image](${proxy})`,
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
    .prepare("SELECT section, body FROM ticket_content_cache WHERE source=? AND id=?")
    .all(store.source(), 42) as any[];
  assert.equal(content.length, 4);
  for (const section of content)
    assert.match(
      section.body,
      new RegExp(`/api/ticket-cards/cache-[a-f0-9]+-42/attachments/${id}`),
    );
});

test("PR shorthand uses canonical WIT API and preserves raw descriptions", () => {
  const raw = `<div><img src="${proxy}"></div>`;
  const images = prDescriptionImages(raw);
  assert.deepEqual(images.sources, [proxy]);
  assert.match(images.description, /!\[Изображение\]/);
  const prUrl = `${base}/Project/_git/repo/pullrequest/42`;
  assert.equal(
    azureImageUrl(proxy, base, prUrl, "repo", 42, "7.1"),
    `${base}/_apis/wit/attachments/${id}?api-version=7.1`,
  );
  assert.equal(azureImageUrl(`https://evil.example/${id}`, base, prUrl, "repo", 42, "7.1"), null);
  assert.equal(azureImageUrl(`${base}/${id}`, base, prUrl, "repo", 42, "7.1"), null);
});
