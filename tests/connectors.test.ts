import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractTicketIds,
  Connectors,
  plainText,
} from "../server/connectors.js";
import { Store } from "../server/store.js";
import { IntegrationsAuth } from "../server/auth.js";
import { azureBase } from "../server/http.js";

test("ticket recognition handles Azure links, Russian, AB# and deduplication", () => {
  assert.deepEqual(
    extractTicketIds(
      "AB#123, #123, тикет №456, bug 789, https://ado/Collection/P/_workitems/edit/987",
    ),
    [123, 456, 789, 987],
  );
  assert.deepEqual(
    extractTicketIds("2026-10-19 meeting at 12345, release 2026, &#123;"),
    [],
  );
  assert.equal(plainText("<p>Hello &amp; <b>world</b></p>"), "Hello & world");
});
test("ticket mentions are idempotent and tracked IDs are not suggested", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-ingest-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const connectors = new Connectors(store, new IntegrationsAuth(store));
  store.db
    .prepare("INSERT INTO chats(id,name) VALUES (?,?)")
    .run("chat-1", "Team");
  const message = {
    id: "m1",
    body: { content: "Новый тикет #123, AB#123" },
    createdDateTime: "2026-01-01T00:00:00Z",
    from: { user: { displayName: "Person" } },
  };
  connectors.ingest("chat-1", message);
  connectors.ingest("chat-1", message);
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM suggestions").get() as any).n,
    1,
  );
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM messages").get() as any).n,
    1,
  );
  store.db
    .prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)")
    .run(
      store.source(),
      456,
      "title",
      "New",
      "",
      "Task",
      "https://ado/item/456",
      null,
      new Date().toISOString(),
    );
  connectors.ingest("chat-1", {
    ...message,
    id: "m2",
    body: { content: "#456" },
  });
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM suggestions").get() as any).n,
    1,
  );
});
test("custom Azure HTTPS collection paths are retained and credential-bearing URLs rejected", () => {
  assert.equal(
    azureBase("https://devops.company.test/tfs/CustomCollection/"),
    "https://devops.company.test/tfs/CustomCollection",
  );
  for (const url of [
    "http://host/collection",
    "https://user:password@host/",
    "https://host/?token=secret",
    "https://host/#x",
    "not-url",
  ])
    assert.throws(() => azureBase(url));
});

test("Azure adapter uses custom collection, PAT header, project, API version and persists real fields", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-azure-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.company.test/tfs/Collection",
    azureProject: "Project One",
    azureVersion: "7.0",
  });
  store.setSecret("azure.pat", "test-pat");
  const calls: { url: string; init: any }[] = [];
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        id: 321,
        fields: {
          "System.Title": "Fix login",
          "System.State": "Active",
          "System.TeamProject": "Project One",
          "System.AssignedTo": { displayName: "Tester" },
          "System.WorkItemType": "Bug",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  const connectors = new Connectors(store, new IntegrationsAuth(store));
  await connectors.trackTicket(321);
  assert.equal(
    calls[0].url,
    "https://ado.company.test/tfs/Collection/Project%20One/_apis/wit/workitems/321?api-version=7.0",
  );
  assert.equal(
    calls[0].init.headers.Authorization,
    `Basic ${Buffer.from(":test-pat").toString("base64")}`,
  );
  const ticket = store.db
    .prepare("SELECT * FROM tickets WHERE id=321")
    .get() as any;
  assert.equal(ticket.title, "Fix login");
  assert.equal(ticket.assigned, "Tester");
  assert.equal(ticket.state, "Active");
  assert.equal(
    ticket.url,
    "https://ado.company.test/tfs/Collection/Project%20One/_workitems/edit/321",
  );
});

test("Teams incrementally paginates and deduplicates; a failed page never advances the watermark", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-pages-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const watermark = "2026-01-01T00:00:00.000Z";
  store.db
    .prepare("INSERT INTO chats(id,name,watched,synced_at) VALUES (?,?,?,?)")
    .run("chat-1", "Team", 1, watermark);
  const auth = new IntegrationsAuth(store);
  t.mock.method(auth, "graphToken", async () => "test-token");
  const connectors = new Connectors(store, auth);
  let calls = 0;
  const message = (id: string, time: string) => ({
    id,
    body: { content: "ticket #456" },
    createdDateTime: time,
    lastModifiedDateTime: time,
  });
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 1)
      return new Response(
        JSON.stringify({
          value: [message("m1", "2026-01-03T00:00:00Z")],
          "@odata.nextLink":
            "https://graph.microsoft.com/v1.0/chats/chat-1/messages?page=2",
        }),
      );
    return new Response(
      JSON.stringify({
        value: [
          message("m2", "2026-01-02T00:00:00Z"),
          message("old", "2025-01-01T00:00:00Z"),
        ],
      }),
    );
  });
  await connectors.syncTeams();
  assert.equal(calls, 2);
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM messages").get() as any).n,
    2,
  );
  store.db.prepare("UPDATE chats SET synced_at=?").run(watermark);
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });
  await assert.rejects(connectors.syncTeams());
  assert.equal(
    (store.db.prepare("SELECT synced_at FROM chats").get() as any).synced_at,
    watermark,
  );
});

test("Graph send uses the exact recipient and plain text body", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-send-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const auth = new IntegrationsAuth(store);
  t.mock.method(auth, "graphToken", async () => "test-token");
  let captured: any;
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    captured = { url, init };
    return new Response(JSON.stringify({ id: "sent-id" }), { status: 201 });
  });
  const connectors = new Connectors(store, auth);
  assert.deepEqual(
    await connectors.sendMessage("19:abc@thread.v2", "<b>literal text</b>"),
    { id: "sent-id" },
  );
  assert.equal(
    captured.url,
    "https://graph.microsoft.com/v1.0/chats/19%3Aabc%40thread.v2/messages",
  );
  assert.deepEqual(JSON.parse(captured.init.body), {
    body: { contentType: "text", content: "<b>literal text</b>" },
  });
});

test("edited or deleted Teams messages withdraw outdated suggestions", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-edit-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const connectors = new Connectors(store, new IntegrationsAuth(store));
  const message = {
    id: "m1",
    body: { content: "Ticket #123" },
    createdDateTime: "2026-01-01T00:00:00Z",
  };
  connectors.ingest("chat", message);
  connectors.ingest("chat", {
    ...message,
    body: { content: "Correction: ticket #456" },
  });
  assert.deepEqual(
    (store.db.prepare("SELECT ticket_id FROM suggestions").all() as any[]).map(
      (x) => x.ticket_id,
    ),
    [456],
  );
  connectors.ingest("chat", {
    ...message,
    deletedDateTime: "2026-01-02T00:00:00Z",
  });
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM suggestions").get() as any).n,
    0,
  );
});

test("changing Azure settings during a request does not relabel the response as another project", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-source-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const original = {
    ...store.settings(),
    azureUrl: "https://ado.test/One",
    azureProject: "Project A",
  };
  store.set("settings", original);
  store.setSecret("azure.pat", "test");
  t.mock.method(globalThis, "fetch", async () => {
    store.set("settings", {
      ...original,
      azureUrl: "https://ado.test/Two",
      azureProject: "Project B",
    });
    return new Response(
      JSON.stringify({
        id: 1,
        fields: {
          "System.Title": "A ticket",
          "System.TeamProject": "Project A",
        },
      }),
    );
  });
  await new Connectors(store, new IntegrationsAuth(store)).trackTicket(1);
  const ticket = store.db.prepare("SELECT * FROM tickets").get() as any;
  assert.equal(ticket.source, store.source(original));
  assert.match(ticket.url, /\/One\/Project%20A\//);
});
