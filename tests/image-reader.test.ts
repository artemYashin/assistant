import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { ChatFiles } from "../services/backend/src/chat-files.js";
import {
  readImageUrl,
  imageReadingTool,
  publicImageAddress,
} from "../services/backend/src/image-reader.js";
const context = { client: "C", project: "P" };
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-image-reader-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
test("image reader restricts remote targets and validates actual image bytes", async (t) => {
  const store = fixture(t),
    chat = store.createChat(context);
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "224.1.2.3",
  ])
    assert.equal(publicImageAddress(address), false, address);
  assert.equal(publicImageAddress("8.8.8.8"), true);
  for (const url of [
    "http://example.com/image.png",
    "https://127.0.0.1/image.png",
    "file:///etc/passwd",
    "https://user:secret@example.com/image.png",
  ])
    await assert.rejects(readImageUrl(store, undefined, undefined, context, chat.id, url));
  const connectors = { attachment: async () => ({ body: Buffer.from("<svg></svg>") }) } as any;
  await assert.rejects(
    readImageUrl(
      store,
      connectors,
      undefined,
      context,
      chat.id,
      "/api/ticket-cards/ref/attachments/id",
    ),
    /PNG/,
  );
  connectors.attachment = async () => ({ body: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await assert.rejects(
    readImageUrl(
      store,
      connectors,
      undefined,
      context,
      chat.id,
      "/api/ticket-cards/ref/attachments/id",
    ),
    /10 МБ/,
  );
});
test("image tool loads only on invocation and delivers pixels in the current session", async (t) => {
  const store = fixture(t),
    chat = store.createChat(context),
    other = store.createChat(context);
  const files = new ChatFiles(store),
    saved = files.add(context, chat.id, "screen.png", png);
  const url = "/api/conversation/files/" + saved.id;
  let deliveries = 0;
  const tool = imageReadingTool(
    store,
    undefined,
    undefined,
    context,
    chat.id,
    () => {},
    async (image, source) => {
      deliveries++;
      assert.deepEqual(image.body, png);
      assert.equal(image.mime, "image/png");
      assert.equal(source, url);
    },
  );
  assert.equal(deliveries, 0);
  const result: any = await tool.handler!({ url }, {} as any);
  assert.equal(result.resultType, "success");
  assert.equal(deliveries, 1);
  assert.ok(!JSON.stringify(result).includes(png.toString("base64")));
  await assert.rejects(
    readImageUrl(store, undefined, undefined, context, other.id, url),
    /не найдено/,
  );
});
test("ticket and PR URLs reuse authorized application download methods", async (t) => {
  const store = fixture(t),
    chat = store.createChat(context);
  let ticketArgs: any, prArgs: any;
  const connectors = {
    attachment: async (...args: any[]) => {
      ticketArgs = args;
      return { body: png };
    },
  } as any;
  const prs = {
    image: async (...args: any[]) => {
      prArgs = args;
      return { body: png };
    },
  } as any;
  await readImageUrl(
    store,
    connectors,
    prs,
    context,
    chat.id,
    "/api/ticket-cards/card/attachments/123",
  );
  assert.deepEqual(ticketArgs, ["card", "123"]);
  await readImageUrl(
    store,
    connectors,
    prs,
    context,
    chat.id,
    "/api/pr/image?monitor=M&repo=R&number=42&source=https%3A%2F%2Fexample.com%2Fimage",
  );
  assert.deepEqual(prArgs, ["M", "R", 42, "https://example.com/image"]);
});
