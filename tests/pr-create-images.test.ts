import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../services/backend/src/store.js";
import { PullRequests } from "../services/backend/src/pull-requests.js";
import { PrCreate } from "../services/backend/src/pr-create.js";
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-pr-images-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/collection",
    azureProject: "Project",
  });
  store.setSecret("azure.pat", "pat");
  const prs = new PullRequests(store, {
    active: () => null,
    chat: async () => ({ body: "", requestId: "" }),
  });
  prs.save({ client: "A", project: "B", repository: "repo", mode: "all", enabled: true });
  const id = randomUUID();
  return {
    store,
    service: new PrCreate(store),
    input: {
      monitor: prs.monitors()[0].id,
      source: "refs/heads/feature",
      target: "refs/heads/main",
      title: "Title",
      description: `Screenshot ![image](https://orbit.invalid/pr-image/${id})`,
      requestId: randomUUID(),
      images: [{ id }],
    },
    files: [{ originalname: id, buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]) }],
  };
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
test("PR-bound images survive partial PATCH failure and restart without duplicate PR or uploads", async (t) => {
  const f = fixture(t);
  let creates = 0,
    uploads = 0,
    patches = 0,
    fail = true;
  const names: string[] = [];
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    const url = new URL(String(raw));
    if (url.pathname.endsWith("/refs"))
      return json({ value: [{ name: `refs/${url.searchParams.get("filter")}` }] });
    if (init.method === "PATCH") {
      patches++;
      const description = JSON.parse(init.body).description;
      assert(!description.includes("orbit.invalid"));
      assert.match(description, /\/repositories\/repo\/pullRequests\/42\/attachments\//);
      return fail ? json({}, 500) : json({ pullRequestId: 42, description });
    }
    if (url.pathname.includes("/attachments/")) {
      uploads++;
      assert.equal(init.method, "POST");
      assert.equal(init.headers["Content-Type"], "application/octet-stream");
      names.push(url.pathname.split("/").at(-1)!);
      return json({ displayName: names.at(-1) });
    }
    if (url.pathname.endsWith("/attachments"))
      return json(names.map((displayName) => ({ displayName })));
    if (init.method === "POST") {
      creates++;
      assert.equal(JSON.parse(init.body).description, "");
      return json({ pullRequestId: 42 });
    }
    return json({ value: [] });
  });
  const first = await f.service.create(f.input, f.files);
  assert.ok("incomplete" in first && first.incomplete);
  assert.equal(first.number, 42);
  fail = false;
  const freshService = new PrCreate(f.store);
  assert.deepEqual(await freshService.create(f.input, f.files), { number: 42, existing: false });
  assert.deepEqual(await freshService.create(f.input, f.files), { number: 42, existing: false });
  assert.deepEqual([creates, uploads, patches], [1, 1, 2]);
  await assert.rejects(
    freshService.create({ ...f.input, title: "Changed" }, f.files),
    /другими данными/,
  );
});
test("existing unrelated PR is never modified to add images", async (t) => {
  const f = fixture(t);
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    assert(!init.method || init.method === "GET");
    const url = new URL(String(raw));
    return url.pathname.endsWith("/refs")
      ? json({ value: [{ name: `refs/${url.searchParams.get("filter")}` }] })
      : json({ value: [{ pullRequestId: 15 }] });
  });
  assert.deepEqual(await f.service.create(f.input, f.files), { number: 15, existing: true });
});
test("uncertain create never blindly creates or adopts another PR on retry", async (t) => {
  const f = fixture(t);
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    const url = new URL(String(raw));
    if (url.pathname.endsWith("/refs"))
      return json({ value: [{ name: `refs/${url.searchParams.get("filter")}` }] });
    if (init.method === "POST") {
      writes++;
      throw new Error("response lost");
    }
    return json({ value: [] });
  });
  await assert.rejects(f.service.create(f.input, f.files));
  await assert.rejects(new PrCreate(f.store).create(f.input, f.files), /не подтверждён/);
  assert.equal(writes, 1);
});
test("invalid images and unresolved markers fail before any Azure request", async (t) => {
  const f = fixture(t);
  t.mock.method(globalThis, "fetch", async () => {
    assert.fail("must not access Azure");
  });
  await assert.rejects(f.service.create(f.input));
  await assert.rejects(
    f.service.create(f.input, [{ ...f.files[0], buffer: Buffer.from("not png") }]),
  );
  await assert.rejects(f.service.create({ ...f.input, images: [] }));
});
test("personal recent branches rank by authenticated pushes, validate deleted branches and fall back safely", async (t) => {
  const f = fixture(t);
  let fail = false;
  t.mock.method(globalThis, "fetch", async (raw: any) => {
    const url = new URL(String(raw));
    if (url.pathname.endsWith("/connectionData"))
      return json({ authenticatedUser: { id: "current-user" } });
    if (url.pathname.endsWith("/pushes")) {
      assert.equal(url.searchParams.get("searchCriteria.pusherId"), "current-user");
      if (fail) return json({}, 403);
      return json({
        value: [
          {
            date: "2026-10-29T00:00:00Z",
            refUpdates: [
              { name: "refs/heads/personal", newObjectId: "abc" },
              { name: "refs/heads/deleted", newObjectId: "abc" },
            ],
          },
          {
            date: "2026-10-28T00:00:00Z",
            refUpdates: [{ name: "refs/heads/main", newObjectId: "def" }],
          },
        ],
      });
    }
    if (url.pathname.endsWith("/stats/branches"))
      return json({ value: [{ name: "main" }, { name: "personal" }] });
    return json({ value: [{ name: "refs/heads/main" }] });
  });
  const personal = await f.service.branches(f.input.monitor, "", true);
  assert.deepEqual(personal.branches, ["refs/heads/personal", "refs/heads/main"]);
  assert.ok("branchUpdatedAt" in personal);
  assert.deepEqual(personal.branchUpdatedAt, {
    "refs/heads/personal": "2026-10-29T00:00:00.000Z",
    "refs/heads/main": "2026-10-28T00:00:00.000Z",
  });
  fail = true;
  const result = await f.service.branches(f.input.monitor, "", true);
  assert.deepEqual(result.branches, ["refs/heads/main"]);
  assert(result.warning);
});
test("branch head title is first line and branch names are safely encoded", async (t) => {
  const f = fixture(t);
  t.mock.method(globalThis, "fetch", async (raw: any) => {
    const url = new URL(String(raw));
    assert.equal(url.searchParams.get("searchCriteria.itemVersion.version"), "feature/test");
    return json({ value: [{ commitId: "abcdef", comment: "  New feature\n\nDetails" }] });
  });
  assert.deepEqual(await f.service.branchHead(f.input.monitor, "refs/heads/feature/test"), {
    title: "New feature",
    commitId: "abcdef",
  });
});
test("lost attachment response recovers by PR attachment name and verifies final description", async (t) => {
  const f = fixture(t);
  let name = "",
    uploads = 0,
    patches = 0;
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    const url = new URL(String(raw));
    if (url.pathname.endsWith("/refs"))
      return json({ value: [{ name: `refs/${url.searchParams.get("filter")}` }] });
    if (url.pathname.endsWith("/attachments")) return json(name ? [{ displayName: name }] : []);
    if (url.pathname.includes("/attachments/")) {
      uploads++;
      name = url.pathname.split("/").at(-1)!;
      throw new Error("lost uploaded response");
    }
    if (init.method === "PATCH") {
      patches++;
      return json({
        pullRequestId: 42,
        description: patches === 1 ? "wrong" : JSON.parse(init.body).description,
      });
    }
    if (init.method === "POST") return json({ pullRequestId: 42 });
    return json({ value: [] });
  });
  const uploadFailure = await f.service.create(f.input, f.files);
  assert.ok("incomplete" in uploadFailure && uploadFailure.incomplete);
  const descriptionFailure = await f.service.create(f.input, f.files);
  assert.ok("incomplete" in descriptionFailure && descriptionFailure.incomplete);
  assert.deepEqual(await f.service.create(f.input, f.files), { number: 42, existing: false });
  assert.equal(uploads, 1);
});
test("reference-style local images and oversized expanded descriptions are rejected before create", async (t) => {
  const f = fixture(t);
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    if (init.method === "POST" || init.method === "PATCH") writes++;
    const url = new URL(String(raw));
    return json({
      value: url.pathname.endsWith("/refs")
        ? [{ name: `refs/${url.searchParams.get("filter")}` }]
        : [],
    });
  });
  await assert.rejects(
    f.service.create({
      ...f.input,
      images: [],
      description: "![image][ref]\n\n[ref]: data:image/png;base64,abc",
    }),
  );
  await assert.rejects(
    f.service.create({
      ...f.input,
      images: [],
      description: "![image][ref]\n\n[ref]: http://127.1/img.png",
    }),
  );
  await assert.rejects(
    f.service.create({ ...f.input, description: "A".repeat(19850) + f.input.description }, f.files),
    /20000/,
  );
  assert.equal(writes, 0);
});
test("creation lock covers deferred attachment upload and prevents simultaneous resume", async (t) => {
  const f = fixture(t);
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const uploading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    const url = new URL(String(raw));
    if (url.pathname.endsWith("/refs"))
      return json({ value: [{ name: `refs/${url.searchParams.get("filter")}` }] });
    if (url.pathname.endsWith("/attachments")) return json([]);
    if (url.pathname.includes("/attachments/")) {
      entered();
      await blocked;
      return json({ displayName: url.pathname.split("/").at(-1) });
    }
    if (init.method === "PATCH")
      return json({ pullRequestId: 42, description: JSON.parse(init.body).description });
    if (init.method === "POST") return json({ pullRequestId: 42 });
    return json({ value: [] });
  });
  const first = f.service.create(f.input, f.files);
  await uploading;
  try {
    await assert.rejects(f.service.create(f.input, f.files), /уже выполняется/);
  } finally {
    release();
  }
  assert.deepEqual(await first, { number: 42, existing: false });
});
test("truncated commit summaries are resolved to full commit before title extraction", async (t) => {
  const f = fixture(t);
  t.mock.method(globalThis, "fetch", async (raw: any) => {
    const url = new URL(String(raw));
    return url.pathname.endsWith("/abcdef")
      ? json({ commitId: "abcdef", comment: "Full commit title\nDetails" })
      : json({ value: [{ commitId: "abcdef", comment: "Full...", commentTruncated: true }] });
  });
  assert.equal(
    (await f.service.branchHead(f.input.monitor, "refs/heads/main")).title,
    "Full commit title",
  );
});
test("safeToEdit only unlocks a new unattempted request, never uncertain or completed receipts", async (t) => {
  const f = fixture(t);
  assert.equal(f.service.safeToEdit({}), false);
  await assert.rejects(f.service.create(f.input));
  assert.equal(f.service.safeToEdit(f.input), true);
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    const url = new URL(String(raw));
    if (url.pathname.endsWith("/refs"))
      return json({ value: [{ name: `refs/${url.searchParams.get("filter")}` }] });
    if (init.method === "POST") throw new Error("response lost");
    return json({ value: [] });
  });
  await assert.rejects(f.service.create(f.input, f.files));
  assert.equal(f.service.safeToEdit(f.input), false);
  const key = `pr.create.receipt.v1:${f.input.requestId}`;
  f.store.set(key, { ...f.store.get(key, {}), number: 42, complete: true });
  assert.equal(f.service.safeToEdit(f.input), false);
});
