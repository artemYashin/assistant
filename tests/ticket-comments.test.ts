import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { Connectors } from "../services/backend/src/connectors.js";

test("ticket comments escape plain text, update cached cards and reject stale sources", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-comments-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/Collection",
    azureProject: "Project",
  });
  store.setSecret("azure.pat", "pat");
  const source = store.source();
  for (const ref of ["one", "two"])
    store.db
      .prepare("INSERT INTO ticket_cards VALUES (?,?)")
      .run(ref, JSON.stringify({ id: 42, source, comments: [] }));
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    const u = new URL(String(url));
    calls.push(init.method || "GET");
    if (init.method === "POST") {
      assert.equal(u.pathname, "/Collection/Project/_apis/wit/workitems/42/comments");
      assert.equal(u.searchParams.get("format"), "html");
      assert.equal(u.searchParams.get("api-version"), "7.1-preview.4");
      assert.equal(
        JSON.parse(init.body).text,
        "<p>&lt;b&gt;Hello&lt;/b&gt;<br>Next &amp; last</p>",
      );
      return Response.json({
        id: 17,
        createdBy: { displayName: "Anna" },
        createdDate: "2026-10-20T00:00:00Z",
      });
    }
    return Response.json({
      id: 42,
      fields: { "System.TeamProject": "Project" },
    });
  });
  const connectors = new Connectors(store);
  const result = await connectors.addTicketComment("one", "<b>Hello</b>\nNext & last");
  assert.equal(result.comment.author, "Anna");
  assert.deepEqual(calls, ["GET", "POST"]);
  for (const ref of ["one", "two"]) assert.equal(connectors.ticketCard(ref).comments[0].id, 17);
  await assert.rejects(() => connectors.addTicketComment("one", "  "), /10000/);
  store.set("settings", { ...store.settings(), azureProject: "Other" });
  await assert.rejects(
    () => connectors.addTicketComment("one", "Text"),
    /Подключение Azure изменилось/,
  );
  assert.deepEqual(calls, ["GET", "POST"]);
});

test("Markdown images reuse completed uploads and comment receipts after a retry", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-comment-images-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/Collection",
    azureProject: "Project",
  });
  store.setSecret("azure.pat", "pat");
  store.db
    .prepare("INSERT INTO ticket_cards VALUES (?,?)")
    .run("one", JSON.stringify({ id: 42, source: store.source(), comments: [] }));
  const connectors = new Connectors(store);
  let uploads = 0,
    posts = 0;
  const imageId = "12345678-1234-1234-1234-123456789012";
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    if (String(url).includes("/attachments?")) {
      uploads++;
      assert.equal(init.headers["Content-Type"], "application/octet-stream");
      assert.ok(init.body instanceof Uint8Array);
      return Response.json({ id: imageId });
    }
    if (init.method === "POST") {
      posts++;
      const html = JSON.parse(init.body).text;
      assert.match(html, /<strong>Hello<\/strong>/);
      assert.match(html, /<img src="https:\/\/ado.test/);
      if (posts === 1) return Response.json({ message: "temporary failure" }, { status: 400 });
      return Response.json({
        id: 19,
        createdBy: { displayName: "Anna" },
        createdDate: "2026-10-23T00:00:00Z",
      });
    }
    return Response.json({
      id: 42,
      fields: { "System.TeamProject": "Project" },
    });
  });
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const image = await connectors.uploadCommentImage("one", bytes, "photo.png", "upload-1");
  assert.deepEqual(
    await connectors.uploadCommentImage("one", bytes, "photo.png", "upload-1"),
    image,
  );
  assert.equal(uploads, 1);
  await assert.rejects(
    () => connectors.uploadCommentImage("one", Buffer.from("bad"), "fake.png", "upload-2"),
    /Поддерживаются/,
  );
  const text = `**Hello**\n\n![Photo](${image.url})`;
  const options = {
    markdown: true,
    imageUploads: ["upload-1"],
    requestId: "request-1",
  };
  await assert.rejects(() => connectors.addTicketComment("one", text, options));
  const result = await connectors.addTicketComment("one", text, options);
  assert.deepEqual(await connectors.addTicketComment("one", text, options), result);
  assert.equal(posts, 2);
  assert.equal(uploads, 1);
  assert.equal(connectors.ticketCard("one").attachments[0].id, imageId);
  assert.equal(connectors.ticketCard("one").comments.length, 1);
});

test("Markdown rendering strips unsafe HTML and links", async () => {
  const { commentMarkdown, commentImageType } =
    await import("../services/backend/src/comment-markdown.js");
  const html = await commentMarkdown(
    "**bold**\n\n```js\nconst a = 1;\n```\n\n<script>alert(1)</script>\n\n[x](javascript:alert%281%29)",
  );
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<pre><code/);
  assert.doesNotMatch(html, /<script|href="javascript:/);
  assert.throws(() => commentImageType(Buffer.alloc(10 * 1024 * 1024 + 1)), /10 МБ/);
});
