import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import {
  ChatFiles,
  inspectChatFile,
  prepareChatFiles,
} from "../services/backend/src/chat-files.js";
import { Agent } from "../services/backend/src/agent.js";
const context = { client: "C", project: "P" };
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-files-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
test("files validate formats and encoding, preserve order and isolate chats", (t) => {
  const store = fixture(t),
    files = new ChatFiles(store),
    chat = store.createChat(context),
    other = store.createChat(context);
  const first = files.add(context, chat.id, "one.png", png),
    csv = files.add(context, chat.id, "two.csv", Buffer.from('id,name\n1,"hello, world"'));
  assert.throws(() => files.read(context, other.id, [first.id]), /не найдено/);
  assert.throws(() => files.read({ client: "Other", project: "P" }, chat.id, [first.id]));
  assert.throws(() => files.read(context, chat.id, [first.id, first.id]), /разных/);
  assert.throws(() => inspectChatFile("fake.pdf", Buffer.from("not pdf")), /не распознан/);
  assert.throws(() => inspectChatFile("file.xlsx", Buffer.from("file")), /не распознан/);
  assert.throws(() => inspectChatFile("file.csv", Buffer.from([255, 254])), /UTF-8/);
  assert.throws(() => inspectChatFile("file.csv", Buffer.from("a".repeat(200001))), /200 000/);
  const prepared = prepareChatFiles(files.read(context, chat.id, [csv.id, first.id]));
  assert.equal(prepared.attachments[0].displayName, "Вложение 2: one.png");
  assert.equal(prepared.attachments[0].data, png.toString("base64"));
  assert.ok(prepared.prompt.includes("hello, world"));
  assert.ok(prepared.prompt.includes("Read ALL attachments now"));
  store.clearHistory(context, chat.id);
  assert.throws(() => files.read(context, chat.id, [first.id]), /не найдено/);
});
test("agent sends images natively and text files in full on the initial request", async (t) => {
  const store = fixture(t),
    files = new ChatFiles(store),
    chat = store.createChat(context);
  store.set("settings", { ...store.settings(), model: "vision-model" });
  const ids = [
    files.add(context, chat.id, "one.png", png),
    files.add(context, chat.id, "two.csv", Buffer.from("a,b\n1,UNIQUE_CSV_VALUE")),
    files.add(context, chat.id, "three.txt", Buffer.from("FULL_TEXT_FILE")),
  ].map((f) => f.id);
  let sent: any;
  const session = {
    sessionId: "runtime",
    on: () => () => {},
    abort: async () => {},
    disconnect: async () => {},
    setTools: async () => {},
    sendAndWait: async (args: any) => {
      sent = args;
      return { data: { content: "Read all files" } };
    },
  };
  const client = {
    start: async () => {},
    stop: async () => {},
    listModels: async () => [{ id: "vision-model", capabilities: { supports: { vision: true } } }],
    createSession: async () => session,
  };
  const agent = new Agent(store, () => client as any);
  await agent.chat(
    "Сравни вложения",
    context,
    false,
    undefined,
    chat.id,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [],
    files.read(context, chat.id, ids),
  );
  assert.deepEqual(
    sent.attachments.map((a: any) => a.mimeType),
    ["image/png"],
  );
  assert.ok(sent.prompt.includes("FULL_TEXT_FILE"));
  assert.ok(sent.prompt.includes("three.txt"));
  assert.ok(sent.prompt.includes("UNIQUE_CSV_VALUE"));
  const user = store.history(context, chat.id).find((m: any) => m.role === "user") as any;
  assert.deepEqual(
    JSON.parse(user.message_context)
      .filter((b: any) => b.kind === "file")
      .map((b: any) => b.number),
    [1, 2, 3],
  );
  store.deleteChat(context, chat.id);
  assert.equal((store.db.prepare("SELECT count(*) AS n FROM chat_files").get() as any).n, 0);
});
test("upload API validates files and binds downloads and conversation requests to the chat", async (t) => {
  const { default: request } = await import("supertest");
  const { createApp } = await import("../services/backend/src/app.js");
  const store = fixture(t);
  store.set("settings", { ...store.settings(), ...context });
  const { app, agent } = createApp(store),
    chat = store.createChat(context);
  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  const setup = await request(app)
    .post("/api/auth/setup")
    .set(headers)
    .send({ password: "long-test-password" })
    .expect(200);
  const auth = {
    ...headers,
    Cookie: setup.headers["set-cookie"][0].split(";")[0],
    "X-CSRF-Token": setup.body.csrf,
  };
  const upload = await request(app)
    .post("/api/conversation/files")
    .set(auth)
    .field("client", context.client)
    .field("project", context.project)
    .field("sessionId", chat.id)
    .field("name", "данные.csv")
    .attach("file", Buffer.from("key,value\n1,complete"), "data.csv")
    .expect(200);
  assert.equal(upload.body.name, "данные.csv");
  const image = new ChatFiles(store).add(context, chat.id, "screen.png", png);
  const attached = await request(app)
    .post("/api/conversation/image")
    .set(auth)
    .send({ ...context, sessionId: chat.id, url: "/api/conversation/files/" + image.id })
    .expect(200);
  assert.notEqual(attached.body.id, image.id);
  assert.equal(attached.body.mime, "image/png");
  assert.deepEqual(new ChatFiles(store).read(context, chat.id, [attached.body.id])[0].bytes, png);
  await request(app)
    .post("/api/conversation/image")
    .set(auth)
    .send({
      ...context,
      sessionId: store.createChat(context).id,
      url: "/api/conversation/files/" + image.id,
    })
    .expect(404);

  await request(app)
    .post("/api/conversation/files")
    .set(auth)
    .field("client", context.client)
    .field("project", context.project)
    .field("sessionId", chat.id)
    .field("name", "test.pdf")
    .attach("file", Buffer.from("%PDF-1.7"), "test.pdf")
    .expect(400);
  const downloaded = await request(app)
    .get(`/api/conversation/files/${upload.body.id}`)
    .set(auth)
    .query({ ...context, sessionId: chat.id })
    .expect(200);
  assert.match(downloaded.headers["content-disposition"], /attachment/);
  let observed: any[] = [];
  t.mock.method(agent, "chat", async (...args: any[]) => {
    observed = args;
    return { body: "Done" } as any;
  });
  await request(app)
    .post("/api/conversation")
    .set(auth)
    .send({
      prompt: "Read this",
      context,
      sessionId: chat.id,
      fileIds: [upload.body.id],
    })
    .expect(200);
  assert.equal(observed.at(-1)[0].bytes.toString(), "key,value\n1,complete");
  await request(app)
    .delete("/api/conversation")
    .set(auth)
    .send({ ...context, sessionId: chat.id })
    .expect(200);
  await request(app)
    .get(`/api/conversation/files/${upload.body.id}`)
    .set(auth)
    .query({ ...context, sessionId: chat.id })
    .expect(404);
});
