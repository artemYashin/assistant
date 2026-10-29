import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { PullRequests } from "../services/backend/src/pull-requests.js";
import assert from "node:assert/strict";
import {
  azureImageUrl,
  descriptionImages,
  prDescriptionImages,
  readAzureImage,
} from "../services/backend/src/pr-images.js";
const base = "https://dev.azure.com/org";
const attachment = `${base}/Project/_apis/wit/attachments/12345678-1234-1234-1234-123456789abc`;
const resolve = (url: string) =>
  azureImageUrl(url, base, `${base}/Project/_git/repo/pullrequest/1`, "repo", 1, "7.1");
test("extracts only Markdown images including references", () => {
  assert.deepEqual(
    descriptionImages(
      "![a](https://a.test/x)\n\n![b][ref]\n\n[ref]: /image.png\n\n[link](https://other.test)\n\n`![code](https://code.test)`\n\n<img src='https://html.test'>",
    ),
    ["https://a.test/x", "/image.png"],
  );
});
test("only Azure attachment endpoints from this collection are eligible for credentials", () => {
  assert.equal(resolve(attachment + "?download=true"), attachment + "?api-version=7.1");
  assert.ok(
    resolve("/org/Project/_apis/git/repositories/repo/pullRequests/1/attachments/test.png"),
  );
  assert.ok(resolve("/org/_apis/wit/attachments/12345678-1234-1234-1234-123456789abc"));
  for (const url of [
    attachment.replace("org/", "other/"),
    attachment.replace("dev.azure.com", "evil.test"),
    attachment.replace("https:", "http:"),
    "https://user:pass@dev.azure.com/org/Project/_apis/wit/attachments/12345678-1234-1234-1234-123456789abc",
    "/org/Project/_apis/git/repositories/other/pullRequests/1/attachments/test.png",
    "/org/Project/_apis/git/repositories/repo/pullRequests/2/attachments/test.png",
    "/org/Project/_apis/wit/workitems/42",
    "data:image/png;base64,AAAA",
    "file:///etc/passwd",
    "//evil.test/image.png",
  ])
    assert.equal(resolve(url), null, url);
});
test("image download uses GET without redirects and identifies binary content", async (t) => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, `Basic ${Buffer.from(":secret").toString("base64")}`);
    return new Response(png, {
      headers: { "Content-Type": "application/octet-stream" },
    });
  });
  assert.equal((await readAzureImage(attachment, "secret")).type, "image/png");
});
test("HTML/SVG and oversized downloads cannot be served as images", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response("<svg onload='alert(1)'/>", {
        headers: { "Content-Type": "image/png" },
      }),
  );
  await assert.rejects(readAzureImage(attachment, "secret"), /PNG/);
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(new Uint8Array(20 * 1024 * 1024 + 1)),
  );
  await assert.rejects(readAzureImage(attachment, "secret"), /20 МБ/);
});

const embeddedPng = "data:image/png;base64,iVBORw0KGgo=";
test("PR inline reader adapts Markdown, references and wrapped HTML without changing source", () => {
  const description = `![one](${embeddedPng})\n\n![ref][pic]\n\n[link][pic]\n\n[pic]: ${embeddedPng}\n\n<div>Screenshot<img src="${embeddedPng}" onerror="alert(1)"></div>`;
  const result = prDescriptionImages(description);
  assert.equal(result.sources.length, 1);
  assert.equal(result.inline.size, 1);
  assert.equal(result.inline.get(result.sources[0])?.type, "image/png");
  assert.equal(description.includes(embeddedPng), true);
  assert.equal(result.description.includes(embeddedPng), false);
  assert.equal(result.description.includes("onerror"), false);
  assert.equal(result.description.includes("<div>"), false);
  assert.equal(descriptionImages(result.description).length, 1);
  assert.ok(result.description.includes(`[pic]: ${result.sources[0]}`));
  assert.ok(result.description.includes("[link][pic]"));
  assert.deepEqual(prDescriptionImages(description).sources, result.sources);
});
test("PR reader ignores code, scripts and fake HTML attributes; leaves blob unavailable", () => {
  const code = `\`![x](${embeddedPng})\`\n\n\`\`\`html\n<img src="${embeddedPng}">\n\`\`\`\n\n<script><img src="${embeddedPng}"></script>\n\n<img data-src="${embeddedPng}">`;
  assert.equal(prDescriptionImages(code).inline.size, 0);
  assert.equal(prDescriptionImages(`<pre><img src="${embeddedPng}"></pre>`).inline.size, 0);
  const blob = "blob:https://ado.test/not-downloadable";
  const result = prDescriptionImages(`![x](${blob})\n\n<img src="${blob}">`);
  assert.deepEqual(result.sources, [blob]);
  assert.equal(result.inline.size, 0);
  assert.equal(resolve(blob), null);
});
test("PR reader rejects mismatched MIME, malformed and oversized embedded images", () => {
  for (const source of [
    embeddedPng.replace("png", "jpeg"),
    "data:image/png;base64,====",
    "data:image/svg+xml;base64,PHN2Zz4=",
    `data:image/png;base64,${"A".repeat(14 * 1024 * 1024)}`,
  ]) {
    const result = prDescriptionImages(`![x](${source})`);
    assert.equal(result.inline.size, 0);
    assert.equal(result.description.includes(source), false);
    assert.match(result.sources[0], /unavailable-/);
  }
  for (const [type, bytes] of [
    ["jpeg", [255, 216, 255]],
    ["gif", Array.from(Buffer.from("GIF89a"))],
    ["webp", Array.from(Buffer.from("RIFF0000WEBP"))],
  ] as const) {
    assert.equal(
      prDescriptionImages(
        `![x](data:image/${type};base64,${Buffer.from(bytes).toString("base64")})`,
      ).inline.size,
      1,
    );
  }
});

test("old populated PR snapshots and exact previews serve only their own inline pixels", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-pr-inline-"));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  store.set("settings", { ...store.settings(), azureUrl: base, azureProject: "Project" });
  store.setSecret("azure.pat", "fixture");
  const prs = new PullRequests(store, {
    active: () => null,
    chat: async () => ({ body: "", requestId: "" }),
  });
  store.db
    .prepare(
      "INSERT INTO pr_projects(id,client,project,source,azure_project,mode,enabled,repository) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run("monitor", "client", "project", base, "Project", "all", 1, "repo");
  const description = `<img src="${embeddedPng}">`;
  const insert = store.db.prepare(
    "INSERT INTO pull_requests(monitor,repo,number,title,author,url,head,target,draft,in_scope,synced_at,description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  for (const id of [1, 2])
    insert.run(
      "monitor",
      "repo",
      id,
      "Fixture",
      "Author",
      `${base}/Project/_git/repo/pullrequest/${id}`,
      "a".repeat(40),
      "b".repeat(40),
      0,
      1,
      "2026-10-29",
      id === 1 ? description : "No image",
    );
  const before = store.db.prepare("SELECT * FROM pull_requests ORDER BY number").all();
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async (input: any) => {
    fetches++;
    if (String(input).includes("/workitems")) return Response.json({ value: [] });
    return Response.json({
      pullRequestId: 3,
      status: "completed",
      title: "Fixture",
      description,
      repository: { id: "repo", name: "Repository", project: { id: "Project", name: "Project" } },
      lastMergeSourceCommit: { commitId: "a".repeat(40) },
      lastMergeTargetCommit: { commitId: "b".repeat(40) },
      sourceRefName: "refs/heads/feature",
      targetRefName: "refs/heads/main",
    });
  });
  const card = prs
    .list({ client: "client", project: "project" })
    .find((item: any) => item.number === 1)!;
  assert.equal(card.images.length, 1);
  assert.ok(card.images[0].preview.length < 350);
  assert.equal(card.description.includes("data:image"), false);
  assert.equal((await prs.image("monitor", "repo", 1, card.images[0].source)).type, "image/png");
  assert.equal(fetches, 0);
  await assert.rejects(prs.image("monitor", "repo", 2, card.images[0].source), /не найдено/);
  await assert.rejects(prs.image("monitor", "other", 1, card.images[0].source), /не найдено/);
  const preview = (await prs.lookup(3)).item;
  const beforeImageFetches = fetches;
  assert.equal(
    (await prs.image(preview.monitor, "repo", 3, preview.images[0].source)).type,
    "image/png",
  );
  assert.equal(fetches, beforeImageFetches);
  assert.equal(preview.description.includes("data:image"), false);
  await assert.rejects(prs.image(preview.monitor, "repo", 4, preview.images[0].source), /устарел/);
  assert.deepEqual(store.db.prepare("SELECT * FROM pull_requests ORDER BY number").all(), before);
});

test("exact PR preview resolves original project and repo name links from trusted PR metadata", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-pr-alias-"));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  store.set("settings", { ...store.settings(), azureUrl: base, azureProject: "Project" });
  store.setSecret("azure.pat", "fixture");
  const source = `${base}/Project/_apis/git/repositories/Repository/pullRequests/3/attachments/test.png`;
  const prs = new PullRequests(store, {
    active: () => null,
    chat: async () => ({ body: "", requestId: "" }),
  });
  t.mock.method(globalThis, "fetch", async (input: any) => {
    const url = String(input);
    if (url.includes("/attachments/"))
      return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (url.includes("/workitems")) return Response.json({ value: [] });
    return Response.json({
      pullRequestId: 3,
      status: "completed",
      title: "Fixture",
      description: `![image](${source})`,
      repository: {
        id: "repo-guid",
        name: "Repository",
        project: { id: "project-guid", name: "Project" },
      },
      lastMergeSourceCommit: { commitId: "a".repeat(40) },
      lastMergeTargetCommit: { commitId: "b".repeat(40) },
      sourceRefName: "refs/heads/feature",
      targetRefName: "refs/heads/main",
    });
  });
  const preview = (await prs.lookup(3)).item;
  assert.match(preview.images[0].preview, /^\/api\/pr\/image\?/);
  assert.equal((await prs.image(preview.monitor, "repo-guid", 3, source)).type, "image/png");
});
