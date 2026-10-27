import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../services/backend/src/store.js";
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
  await assert.rejects(service.create(input), /изменилось/);
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
