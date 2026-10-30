import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markdownImageSources as backendSources } from "../services/backend/src/markdown-images.js";
import { markdownImageSources as frontendSources } from "../services/frontend/src/features/render-content/lib/markdown-images.js";
import { Store } from "../services/backend/src/store.js";
import { Connectors } from "../services/backend/src/connectors.js";

const base = "https://dev.azure.com/example";
const attachmentId = "11111111-2222-3333-4444-555555555555";
const url = `${base}/_apis/wit/attachments/${attachmentId}?fileName=image.png&download=true`;
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5X8AAAAASUVORK5CYII=";
const data = `data:image/png;base64,${png}`;

for (const [name, sources] of [
  ["backend", backendSources],
  ["frontend", frontendSources],
] as const) {
  test(`${name} resolves titled, angle and reference images with renderer semantics`, () => {
    const encoded = url.replaceAll("&", "&amp;");
    assert.deepEqual(sources(`![image](${encoded} "Screen shot")`), [url]);
    assert.deepEqual(sources(`![image](<${url}> 'Screen shot')`), [url]);
    assert.deepEqual(sources(`![image][Screenshot]\n\n[screenshot]: <${url}> "Screen shot"`), [
      url,
    ]);
    assert.deepEqual(
      sources(
        `![image][Screenshot]\n\n[screenshot]: ${url}\n[screenshot]: https://evil.test/image`,
      ),
      [url],
    );
    assert.deepEqual(sources(`![image](https://example.test/image(1).png)`), [
      "https://example.test/image(1).png",
    ]);
    assert.deepEqual(
      sources(`\`![image](${url})\`\n\n\`\`\`md\n![image](${url})\n\`\`\`\n\n![missing][none]`),
      [],
    );
    assert.deepEqual(sources(`![image](${data} "Screen shot")`), [data]);
  });
}

test("ticket comment previews discover Markdown attachment URLs and keep snapshot data", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-comment-image-map-"));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  store.set("settings", { ...store.settings(), azureUrl: base, azureProject: "Project" });
  store.setSecret("azure.pat", "test-pat");
  const texts = [
    `![image](${url} "Screen shot")`,
    `![image](<${url}> "Screen shot")`,
    `![image][screen]\n\n[screen]: ${url}`,
    `<img src="${url.replaceAll("&", "&amp;")}">`,
    `<img src="${data}">`,
    `![image](${data} "Screen shot")`,
  ];
  t.mock.method(globalThis, "fetch", async (input: any) => {
    if (String(input).includes("/comments"))
      return Response.json({ comments: texts.map((text, id) => ({ id, text })) });
    return Response.json({
      id: 42,
      fields: { "System.Title": "Example", "System.TeamProject": "Project" },
      relations: [],
    });
  });
  const connectors = new Connectors(store);
  const card = await connectors.ticketDetails(42);
  assert.equal(card.attachments.filter((a: any) => a.id === attachmentId && a.image).length, 1);
  assert.equal(card.attachments.filter((a: any) => a.inline).length, 1);
  assert.equal(card.comments.length, texts.length);
  assert.match(card.comments.at(-1)!.richText, /orbit.invalid\/ticket-inline-image/);
  const stored = (
    store.db.prepare("SELECT data FROM ticket_cards WHERE id=?").get(card.cardId) as any
  ).data;
  assert.equal(JSON.parse(stored).comments.at(-1).richText, texts.at(-1));
  const inline = card.attachments.find((a: any) => a.inline);
  assert.deepEqual(
    (await connectors.attachment(card.cardId, inline.id)).body,
    Buffer.from(png, "base64"),
  );
});

test("old snapshots recover scoped reference images without writes or foreign attachment access", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-comment-image-old-"));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  store.set("settings", { ...store.settings(), azureUrl: base, azureProject: "Project" });
  store.setSecret("azure.pat", "test-pat");
  const original = JSON.stringify({
    id: 42,
    source: store.source(),
    loadedAt: "2026-10-20T10:00:00Z",
    base,
    fields: {},
    attachments: [],
    comments: [{ richText: `![image][screen]\n\n[screen]: ${url}` }],
  });
  store.db.prepare("INSERT INTO ticket_cards VALUES (?,?)").run("old", original);
  const connectors = new Connectors(store);
  const minimal = { id: 43, comments: [] };
  store.db.prepare("INSERT INTO ticket_cards VALUES (?,?)").run("minimal", JSON.stringify(minimal));
  assert.deepEqual(connectors.ticketCard("minimal"), minimal);
  for (let i = 0; i < 2; i++)
    assert.equal(connectors.ticketCard("old").attachments[0].id, attachmentId);
  assert.equal(
    (store.db.prepare("SELECT data FROM ticket_cards WHERE id=?").get("old") as any).data,
    original,
  );
  t.mock.method(globalThis, "fetch", async () => new Response("Offline", { status: 503 }));
  const cached = await connectors.ticketDetails(42, true);
  assert.equal(cached.attachments[0].id, attachmentId);
  assert.equal(cached.comments[0].richText, JSON.parse(original).comments[0].richText);
  assert.equal(
    (store.db.prepare("SELECT data FROM ticket_cards WHERE id=?").get("old") as any).data,
    original,
  );
  for (const invalid of [
    url.replace("dev.azure.com", "foreign.test"),
    url.replace("/example/", "/different/"),
    url.replace("/example/", "/example-other/"),
  ]) {
    store.db.prepare("INSERT OR REPLACE INTO ticket_cards VALUES (?,?)").run(
      "foreign",
      JSON.stringify({
        base,
        fields: {},
        attachments: [],
        comments: [{ richText: `![image](${invalid} "Screen shot")` }],
      }),
    );
    assert.deepEqual(connectors.ticketCard("foreign").attachments, []);
  }
});
