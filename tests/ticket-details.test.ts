import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { Connectors } from "../server/connectors.js";
import { IntegrationsAuth } from "../server/auth.js";
const image = "11111111-1111-1111-1111-111111111111";
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-details-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/Collection",
    azureProject: "P",
  });
  store.setSecret("azure.pat", "pat");
  return {
    store,
    connectors: new Connectors(store, new IntegrationsAuth(store)),
  };
}
test("automatic import filters by owner, exact type and state with safe WIQL quoting", async (t) => {
  const { store, connectors } = fixture(t);
  store.set("settings", {
    ...store.settings(),
    azureAutoImport: true,
    azureTypes: ["Bug", "Change Request"],
    azureStates: ["Ready ' QA"],
  });
  let query = "";
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    if (String(url).includes("/wiql")) {
      query = JSON.parse(init.body).query;
      return Response.json({ workItems: [{ id: 42 }] });
    }
    assert.deepEqual(JSON.parse(init.body).ids, [42]);
    return Response.json({
      value: [
        {
          id: 42,
          fields: {
            "System.Title": "Fix",
            "System.State": "Ready ' QA",
            "System.TeamProject": "P",
          },
        },
      ],
    });
  });
  await connectors.syncTickets(false, true);
  assert.match(query, /\[System.AssignedTo\] = @Me/);
  assert.match(query, /IN \('Bug','Change Request'\)/);
  assert.match(query, /'Ready '' QA'/);
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM tickets").get() as any).n,
    1,
  );
});
test("ticket details include all comment pages and only allow own Azure attachment URLs", async (t) => {
  const { store, connectors } = fixture(t);
  let comments = 0,
    attachmentCalls = 0;
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    const url = new URL(String(raw));
    assert.equal(url.origin, "https://ado.test");
    if (url.pathname.includes("/attachments/")) {
      attachmentCalls++;
      return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), {
        headers: { "content-type": "application/octet-stream" },
      });
    }
    if (url.pathname.endsWith("/comments")) {
      comments++;
      assert.equal(url.searchParams.get("api-version"), "7.1-preview.4");
      return Response.json(
        comments === 1
          ? {
              comments: [
                { id: 1, text: "first", createdBy: { displayName: "User" } },
              ],
              continuationToken: "next",
            }
          : { comments: [{ id: 2, text: "second" }] },
      );
    }
    return Response.json({
      id: 42,
      fields: {
        "System.TeamProject": "P",
        "System.Title": "Bug",
        "System.Description": `<p>Hello</p><img src="https://ado.test/Collection/_apis/wit/attachments/${image}">`,
      },
      relations: [
        {
          rel: "AttachedFile",
          url: `https://evil.test/_apis/wit/attachments/${image}`,
          attributes: { name: "evil.png" },
        },
      ],
    });
  });
  const details = await connectors.ticketDetails(42);
  assert.equal(details.comments.length, 2);
  assert.equal(details.attachments.length, 1);
  assert.equal(details.attachments[0].image, true);
  assert.equal(details.warnings.length, 0);
  assert.equal(
    (store.db.prepare("SELECT count(*) n FROM tickets").get() as any).n,
    0,
  );
  const file = await connectors.attachment(details.cardId, image);
  assert.equal(file.type, "image/png");
  assert.equal(attachmentCalls, 1);
  await assert.rejects(
    connectors.attachment(details.cardId, "not-listed"),
    /не найдено/,
  );
  assert.equal(attachmentCalls, 1);
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://another.test",
  });
  await assert.rejects(
    connectors.attachment(details.cardId, image),
    /изменилось/,
  );
  assert.equal(attachmentCalls, 1);
});
test("unavailable comments are shown as incomplete and wrong-project ticket is rejected", async (t) => {
  const { connectors } = fixture(t);
  let project = "P";
  t.mock.method(globalThis, "fetch", async (raw: any) =>
    String(raw).includes("/comments")
      ? new Response("", { status: 403 })
      : Response.json({ id: 42, fields: { "System.TeamProject": project } }),
  );
  const details = await connectors.ticketDetails(42);
  assert.equal(details.warnings.length, 1);
  project = "Other";
  await assert.rejects(connectors.ticketDetails(42), /другому проекту/);
});
test("work item types and states are loaded from the configured project", async (t) => {
  const { store, connectors } = fixture(t);
  t.mock.method(globalThis, "fetch", async (raw: any) => {
    const url = new URL(String(raw));
    assert.ok(url.pathname.startsWith("/Collection/P/"));
    return Response.json(
      url.pathname.endsWith("/states")
        ? { value: [{ name: "New" }, { name: "Active" }] }
        : {
            value: [
              { name: "Bug" },
              { name: "Change Request", states: [{ name: "Proposed" }] },
            ],
          },
    );
  });
  assert.deepEqual(await connectors.ticketOptions(), [
    { name: "Bug", states: ["New", "Active"] },
    { name: "Change Request", states: ["Proposed"] },
  ]);
  assert.deepEqual(store.get("azure.ticket-options:" + store.source(), []), [
    { name: "Bug", states: ["New", "Active"] },
    { name: "Change Request", states: ["Proposed"] },
  ]);
});

test("comment images accept HTML attribute spacing and unquoted sources, deduplicating UUID case", async (t) => {
  const { connectors } = fixture(t);
  const id = "abcdefab-1234-1234-1234-abcdefabcdef";
  t.mock.method(globalThis, "fetch", async (raw: any) => {
    if (new URL(String(raw)).pathname.endsWith("/comments"))
      return Response.json({
        comments: [
          {
            id: 1,
            renderedText: `<p>Screenshot</p><img src = "https://ado.test/Collection/_apis/wit/attachments/${id.toUpperCase()}"><img src=https://ado.test/Collection/_apis/wit/attachments/${id}><img src = "https://evil.test/Collection/_apis/wit/attachments/${image}">`,
          },
        ],
      });
    return Response.json({
      id: 42,
      fields: { "System.Title": "Comment images", "System.TeamProject": "P" },
      relations: [],
    });
  });
  const card = await connectors.ticketDetails(42);
  assert.deepEqual(card.attachments, [
    { id, name: "Изображение в тексте", image: true },
  ]);
  assert.match(card.comments[0].richText, /Screenshot/);
});

test("sync refreshes assigned tickets first then other locally tracked tickets with content", async t => {
  const { store, connectors } = fixture(t);
  const source = store.source();
  for (const id of [42, 43]) store.db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)").run(source, id, "Old", "Old", "Other", "Bug", "url", null, "old");
  const batches: number[][] = [];
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    if (String(url).includes("/wiql")) return Response.json({ workItems: [{ id: 43 }, { id: 44 }] });
    const ids = JSON.parse(init.body).ids; batches.push(ids);
    return Response.json({ value: ids.map((id: number) => ({ id, fields: {
      "System.TeamProject": "P", "System.Title": `Fresh ${id}`, "System.State": "Active",
      "System.AssignedTo": { displayName: id === 42 ? "Someone else" : "Me" }, "System.Description": `<p>Body ${id}</p>`,
    } })) });
  });
  assert.deepEqual(await connectors.syncTickets(true), { count: 3 });
  assert.deepEqual(batches, [[43, 44], [42]]);
  const other = store.db.prepare("SELECT * FROM tickets WHERE source=? AND id=42").get(source) as any;
  assert.equal(other.title, "Fresh 42"); assert.equal(other.assigned, "Someone else");
  assert.equal((store.db.prepare("SELECT body FROM ticket_content_cache WHERE source=? AND id=42 AND section='description'").get(source) as any).body, "Body 42");
});

test("opening tracked detail refreshes local Azure fields and clears removed cached sections", async t => {
  const { store, connectors } = fixture(t);
  const source = store.source();
  store.db.prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)").run(source, 42, "Old", "Old", "Old", "Bug", "url", null, "old");
  store.db.prepare("INSERT INTO ticket_content_cache VALUES (?,?,?,?,?,?)").run(source, 42, "criteria", "outdated", "outdated", "old");
  t.mock.method(globalThis, "fetch", async (url: any) => String(url).includes("/comments") ? Response.json({ comments: [] }) : Response.json({ id: 42, fields: {
    "System.TeamProject": "P", "System.Title": "Fresh", "System.State": "Closed", "System.AssignedTo": { displayName: "Other" }, "System.Tags": "AzureTag", "System.Description": "<p>Fresh body</p>",
  } }));
  await connectors.ticketDetails(42);
  const row = store.db.prepare("SELECT * FROM tickets WHERE source=? AND id=42").get(source) as any;
  assert.equal(row.title, "Fresh"); assert.equal(row.state, "Closed"); assert.equal(row.assigned, "Other");
  assert.equal((store.db.prepare("SELECT body FROM ticket_content_cache WHERE source=? AND id=42 AND section='criteria'").get(source) as any).body, "");
});
