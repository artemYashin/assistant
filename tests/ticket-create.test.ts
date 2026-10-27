import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../services/backend/src/store.js";
import { Connectors } from "../services/backend/src/connectors.js";
import { TicketCreate } from "../services/backend/src/ticket-create.js";

function setup(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-create-"));
  const store = new Store(dir);
  store.set("settings", {
    ...store.rawSettings(),
    azureUrl: "https://ado.test/Collection",
    azureProject: "Project",
  });
  store.setSecret("azure.pat", "test-pat");
  const previous = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previous;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const input = {
    requestId: randomUUID(),
    source: store.source(),
    type: "Bug",
    title: "New task",
    assigneeId: null,
    description: "**Description**",
    acceptance: "",
    steps: "",
    relations: [{ kind: "parent", id: 7 }],
  };
  return { store, service: new TicketCreate(store), input };
}
const fields = () =>
  Response.json({
    value: [
      { referenceName: "System.Description" },
      { referenceName: "Microsoft.VSTS.TCM.ReproSteps" },
    ],
  });
test("create uses one atomic Azure patch, Markdown, identity and directional relations; retry preserves existing data", async (t) => {
  const { store, service, input } = setup(t);
  store.db
    .prepare("INSERT INTO tickets VALUES (?,42,'Existing','Active','','Bug','','','')")
    .run(store.source());
  const userId = randomUUID();
  store.set("developers:" + store.source(), [
    { id: userId, email: "user@example.test", name: "User" },
  ]);
  const body = {
    ...input,
    assigneeId: userId,
    relations: [...input.relations, { kind: "child", id: 8 }, { kind: "related", id: 9 }],
  };
  let writes = 0;
  globalThis.fetch = async (url, init) => {
    if (init?.method !== "POST") return fields();
    writes++;
    assert.match(String(url), /workitems\/\$Bug\?api-version=7.1/);
    const patch = JSON.parse(String(init.body));
    assert.equal(
      patch.find((p: any) => p.path === "/fields/System.AssignedTo").value,
      "user@example.test",
    );
    assert.match(
      patch.find((p: any) => p.path === "/fields/System.Description").value,
      /<strong>Description<\/strong>/,
    );
    assert.deepEqual(
      patch.filter((p: any) => p.path === "/relations/-").map((p: any) => p.value.rel),
      [
        "System.LinkTypes.Hierarchy-Reverse",
        "System.LinkTypes.Hierarchy-Forward",
        "System.LinkTypes.Related",
      ],
    );
    return Response.json({ id: 43, fields: { "System.Title": "New task" } });
  };
  assert.equal((await service.create(body)).id, 43);
  assert.equal((await new TicketCreate(store).create(body)).id, 43);
  assert.equal(writes, 1);
  assert.equal(
    (store.db.prepare("SELECT title FROM tickets WHERE id=42").get() as any).title,
    "Existing",
  );
  assert.equal(store.db.prepare("SELECT id FROM tickets WHERE id=43").get(), undefined);
});
test("validation and connection changes prevent writes", async (t) => {
  const { store, service, input } = setup(t);
  let writes = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") writes++;
    return fields();
  };
  await assert.rejects(
    service.create({
      ...input,
      relations: [
        { kind: "parent", id: 1 },
        { kind: "parent", id: 2 },
      ],
    }),
  );
  await assert.rejects(service.create({ ...input, acceptance: "Unsupported" }), /не поддерживает/);
  await assert.rejects(service.create({ ...input, source: "wrong" }), /изменилось/);
  globalThis.fetch = async () => {
    store.set("settings", { ...store.rawSettings(), azureProject: "Other" });
    return fields();
  };
  await assert.rejects(service.create({ ...input, type: "Task" }), /изменилось/);
  assert.equal(writes, 0);
});
test("uncertain create cannot be retried, definitive validation failure can", async (t) => {
  const { service, input } = setup(t);
  let writes = 0;
  let fail = 400;
  globalThis.fetch = async (_url, init) => {
    if (init?.method !== "POST") return fields();
    writes++;
    if (fail === 400) return Response.json({ message: "Required custom field" }, { status: 400 });
    throw new Error("Connection lost");
  };
  await assert.rejects(service.create(input), /Required custom field/);
  fail = 0;
  await assert.rejects(service.create(input), /мог уже создаться/);
  await assert.rejects(service.create(input), /предыдущего создания/);
  assert.equal(writes, 2);
});

test("creation images validate bytes, reuse uploads and resolve only this draft's image markers", async (t) => {
  const { store, service, input } = setup(t);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5X8AAAAASUVORK5CYII=",
    "base64",
  );
  const uploadId = randomUUID(),
    attachmentId = randomUUID();
  let uploads = 0,
    creates = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/attachments?")) {
      uploads++;
      assert.match(String(url), /fileName=image.png&api-version=7.1/);
      assert.equal(new Headers(init?.headers).get("content-type"), "application/octet-stream");
      return Response.json({ id: attachmentId, url: "https://untrusted.test/ignore" });
    }
    if (init?.method !== "POST") return fields();
    creates++;
    const patch = JSON.parse(String(init.body));
    const description = patch.find((p: any) => p.path === "/fields/System.Description").value;
    assert.ok(
      description.includes(
        `https://ado.test/Collection/Project/_apis/wit/attachments/${attachmentId}`,
      ),
    );
    assert.ok(!description.includes("orbit.invalid") && !description.includes("untrusted.test"));
    if (creates === 1) return Response.json({ message: "Validation failure" }, { status: 400 });
    return Response.json({ id: 44 });
  };
  await assert.rejects(
    service.upload(input.source, input.requestId, uploadId, Buffer.from("not an image")),
    /изображения/,
  );
  const image = await service.upload(input.source, input.requestId, uploadId, png);
  assert.deepEqual(
    await new TicketCreate(store).upload(input.source, input.requestId, uploadId, png),
    image,
  );
  assert.equal(uploads, 1);
  const body = {
    ...input,
    description: `![Screenshot](https://orbit.invalid/create-ticket-image/${uploadId})`,
  };
  await assert.rejects(service.create({ ...body, requestId: randomUUID() }), /не загружено/);
  await assert.rejects(service.create(body), /Validation failure/);
  assert.equal((await service.create(body)).id, 44);
  assert.equal(uploads, 1);
  assert.equal(creates, 2);
});

test("field cache survives restart, expires at 24 hours, separates types/projects and retries failures", async (t) => {
  const { store, service, input } = setup(t);
  let now = Date.now(),
    reads = 0;
  t.mock.method(Date, "now", () => now);
  globalThis.fetch = async () => {
    reads++;
    return fields();
  };
  await Promise.all([service.options(input.source, "Bug"), service.options(input.source, "Bug")]);
  assert.equal(reads, 1);
  const reopened = new Store(store.dir);
  try {
    await new TicketCreate(reopened).options(input.source, "Bug");
    assert.equal(reads, 1);
  } finally {
    reopened.close();
  }
  now += 24 * 60 * 60 * 1000 - 1;
  await service.options(input.source, "Bug");
  assert.equal(reads, 1);
  now++;
  globalThis.fetch = async () => {
    reads++;
    return Response.json({ value: [{}] });
  };
  await assert.rejects(service.options(input.source, "Bug"), /корректный список/);
  globalThis.fetch = async () => {
    reads++;
    return fields();
  };
  await service.options(input.source, "Bug");
  assert.equal(reads, 3);
  await service.options(input.source, "Task");
  assert.equal(reads, 4);
  store.set("settings", { ...store.rawSettings(), azureProject: "Other" });
  await service.options(store.source(), "Bug");
  assert.equal(reads, 5);
  store.set("settings", { ...store.rawSettings(), azureProject: "Project" });
  await service.options(input.source, "Bug");
  assert.equal(reads, 5);
});

test("successful creation updates shared recent assignees; failures preserve prior choices", async (t) => {
  const { store, service, input } = setup(t);
  const recentKey = "azure.assignees.recent:" + input.source;
  const recent = Array.from({ length: 8 }, (_, i) => ({
    id: randomUUID(),
    name: `Person ${i}`,
    email: `p${i}@example.test`,
  }));
  store.set(recentKey, recent);
  let reject = true;
  globalThis.fetch = async (_url, init) => {
    if (init?.method !== "POST") return fields();
    if (reject) return Response.json({ message: "Denied" }, { status: 400 });
    return Response.json({ id: 99 });
  };
  const body = { ...input, assigneeId: recent[5].id };
  await assert.rejects(service.create(body), /Denied/);
  assert.deepEqual(store.get(recentKey, []), recent);
  reject = false;
  await service.create(body);
  assert.deepEqual(store.get(recentKey, []), [
    recent[5],
    ...recent.filter((p) => p.id !== recent[5].id),
  ]);
  const next = { id: randomUUID(), name: "New person", email: "new@example.test" };
  store.set("developers:" + input.source, [next]);
  await service.create({ ...input, requestId: randomUUID(), assigneeId: next.id });
  const saved = store.get<any[]>(recentKey, []);
  assert.equal(saved.length, 8);
  assert.deepEqual(saved[0], next);
  assert.deepEqual(saved[1], recent[5]);
  assert.deepEqual(store.get("azure.assignees.recent:Other", []), []);
});

test("task types cache persists, coalesces requests, expires after a day and isolates projects", async (t) => {
  const { store, service, input } = setup(t);
  let requests = 0;
  let malformed = false;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({
      value: malformed ? [{}] : [{ name: "Bug" }, { name: "Hidden", isDisabled: true }],
    });
  };
  const expected = { types: ["Bug"] };
  assert.deepEqual(
    await Promise.all([service.options(input.source), service.options(input.source)]),
    [expected, expected],
  );
  assert.equal(requests, 1);
  const reopened = new Store(store.dir);
  try {
    assert.deepEqual(await new TicketCreate(reopened).options(input.source), expected);
    assert.equal(requests, 1);
  } finally {
    reopened.close();
  }
  const key = "ticket.create-types:" + input.source;
  const expired = { loadedAt: Date.now() - 86400000, types: ["Old"] };
  store.set(key, expired);
  malformed = true;
  await assert.rejects(service.options(input.source), /список типов/);
  assert.deepEqual(store.get(key, null), expired);
  malformed = false;
  assert.deepEqual(await service.options(input.source), expected);
  assert.equal(requests, 3);
  store.set("settings", { ...store.rawSettings(), azureProject: "Other" });
  assert.deepEqual(await service.options(store.source()), expected);
  assert.equal(requests, 4);
  assert.deepEqual(store.get<{ types: string[] }>(key, { types: [] }).types, ["Bug"]);
  await assert.rejects(service.options(input.source), /Подключение изменилось/);
});

test("creation import failure preserves Azure receipt and retry never creates a duplicate", async (t) => {
  const { service, input } = setup(t);
  let creates = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method !== "POST") return fields();
    creates++;
    return Response.json({ id: 77 });
  };
  let attempts = 0;
  const importer = async (ids: number[], source: string) => {
    assert.deepEqual(ids, [77]);
    assert.equal(source, input.source);
    attempts++;
    if (attempts === 1) throw new Error("Import unavailable");
    return { missing: attempts === 2 ? [77] : [] };
  };
  const failed = await service.createAndImport(input, importer);
  assert.equal(failed.id, 77);
  assert.equal(failed.imported, false);
  assert.equal(failed.importError, "Import unavailable");
  assert.equal((await service.createAndImport(input, importer)).imported, false);
  assert.equal((await service.createAndImport(input, importer)).imported, true);
  assert.equal(creates, 1);
});

test("new Azure ticket imports into a populated local list and repeated creation preserves local data", async (t) => {
  const { store, service, input } = setup(t);
  const connectors = new Connectors(store);
  store.db
    .prepare("INSERT INTO tickets VALUES (?,42,'Existing','Active','','Bug','','','')")
    .run(input.source);
  let creates = 0,
    imports = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("workitemsbatch")) {
      imports++;
      return Response.json({
        value: [
          {
            id: 78,
            fields: {
              "System.TeamProject": "Project",
              "System.Title": "Created",
              "System.WorkItemType": "Bug",
              "System.State": "New",
              "System.Description": "<p>Description</p>",
            },
          },
        ],
      });
    }
    if (init?.method !== "POST") return fields();
    creates++;
    return Response.json({ id: 78 });
  };
  const importer = (ids: number[], source: string) => connectors.importAzureSelection(ids, source);
  assert.equal((await service.createAndImport(input, importer)).imported, true);
  assert.equal(
    (store.db.prepare("SELECT title FROM tickets WHERE id=78").get() as any).title,
    "Created",
  );
  store.db.prepare("UPDATE tickets SET title='Local snapshot' WHERE id=78").run();
  assert.equal((await service.createAndImport(input, importer)).imported, true);
  assert.equal(creates, 1);
  assert.equal(imports, 1);
  assert.equal(
    (store.db.prepare("SELECT title FROM tickets WHERE id=78").get() as any).title,
    "Local snapshot",
  );
  assert.equal(
    (store.db.prepare("SELECT title FROM tickets WHERE id=42").get() as any).title,
    "Existing",
  );
});
