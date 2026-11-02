import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { PullRequests } from "../services/backend/src/pull-requests.js";
import { azureImageNeedsIdentityLookup, azureImageUrl } from "../services/backend/src/pr-images.js";

const base = "https://dev.azure.com/example";
const projectId = "11111111-1111-1111-1111-111111111111";
const repoId = "22222222-2222-2222-2222-222222222222";
const metadata = { id: repoId, name: "Repository", project: { id: projectId, name: "Project" } };
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function fixture(t: any, project = "Project") {
  const directory = mkdtempSync(join(tmpdir(), "orbit-pr-project-alias-"));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  store.set("settings", { ...store.settings(), azureUrl: base, azureProject: project });
  store.setSecret("azure.pat", "fixture");
  const prs = new PullRequests(store, {
    active: () => null,
    chat: async () => ({ body: "", requestId: "" }),
  });
  store.db
    .prepare(
      "INSERT INTO pr_projects(id,client,project,source,azure_project,mode,enabled,repository) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run("monitor", "client", "project", base, project, "all", 1, repoId);
  const prUrl = `${base}/${project}/_git/${repoId}/pullrequest/7`;
  const setSource = (source: string) => {
    store.db
      .prepare(
        "INSERT INTO pull_requests(monitor,repo,number,title,author,url,head,target,draft,in_scope,synced_at,description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(monitor,repo,number) DO UPDATE SET description=excluded.description",
      )
      .run(
        "monitor",
        repoId,
        7,
        "Fixture",
        "Author",
        prUrl,
        "a".repeat(40),
        "b".repeat(40),
        0,
        1,
        "2026-11-02",
        `![image](${source})`,
      );
  };
  return { store, prs, prUrl, setSource };
}
const sourceUrl = (project: string, repo = repoId) =>
  `${base}/${project}/_apis/git/repositories/${repo}/pullRequests/7/attachments/image.png`;

test("project alias candidates keep strict origin, collection, endpoint and PR boundaries", () => {
  const pr = `${base}/Project/_git/${repoId}/pullrequest/7`;
  const source = sourceUrl(projectId);
  assert.equal(azureImageUrl(source, base, pr, repoId, 7, "7.1"), null);
  assert.equal(azureImageNeedsIdentityLookup(source, base, pr, repoId, 7, "7.1"), true);
  for (const invalid of [
    source.replace("dev.azure.com", "foreign.test"),
    source.replace("/example/", "/other/"),
    source.replace("https:", "http:"),
    source.replace("https://", "https://user:secret@"),
    source.replace("/7/", "/8/"),
    source.replace("attachments/image.png", "commits"),
    source.replace("image.png", "%00.png"),
    source.replace("image.png", "%2e%2e"),
    source.replace("image.png", "%5Cprivate.png"),
  ])
    assert.equal(
      azureImageNeedsIdentityLookup(invalid, base, pr, repoId, 7, "7.1"),
      false,
      invalid,
    );
});

for (const configuredProject of ["Project", projectId]) {
  test(`saved PR resolves verified project name/GUID lazily (${configuredProject})`, async (t) => {
    const { store, prs, setSource } = fixture(t, configuredProject);
    const alternate = configuredProject === "Project" ? projectId : "Project";
    const calls: string[] = [];
    t.mock.method(globalThis, "fetch", async (input: any, options: any) => {
      const url = String(input);
      calls.push(url);
      assert.equal(
        options.headers.Authorization,
        `Basic ${Buffer.from(":fixture").toString("base64")}`,
      );
      assert.equal(options.redirect, "error");
      if (!url.includes("/attachments/")) {
        assert.equal(
          url,
          `${base}/${configuredProject}/_apis/git/repositories/${repoId}?api-version=7.1`,
        );
        return Response.json(metadata);
      }
      assert.equal(new URL(url).hostname, "dev.azure.com");
      assert.equal(url, sourceUrl(alternate, "Repository") + "?api-version=7.1");
      return new Response(png);
    });
    for (const host of ["dev.azure.com", "dev.azure.com.mcas.ms"]) {
      const source =
        sourceUrl(alternate, "Repository").replace("dev.azure.com", host) + "?mcasCtx=ignored";
      setSource(source);
      const before = store.db.prepare("SELECT * FROM pull_requests").all();
      const count = calls.length;
      for (let repeat = 0; repeat < 2; repeat++) {
        const card = prs.list({ client: "client", project: "project" })[0];
        assert.match(card.images[0].preview, /^\/api\/pr\/image\?/);
        assert.equal(card.images[0].diagnostic, undefined);
      }
      assert.equal(calls.length, count, "reading a list must not fetch Azure");
      assert.equal((await prs.image("monitor", repoId, 7, source)).type, "image/png");
      assert.equal(calls.length, count + 2);
      assert.deepEqual(store.db.prepare("SELECT * FROM pull_requests").all(), before);
    }
  });
}

test("unverified project/repository, failed metadata and changed credentials never fetch pixels", async (t) => {
  const { store, prs, setSource } = fixture(t);
  let response: any = metadata;
  let fail = false;
  let changePat = false;
  let lookups = 0;
  t.mock.method(globalThis, "fetch", async (input: any) => {
    const url = String(input);
    assert.equal(
      url,
      `${base}/Project/_apis/git/repositories/${repoId}?api-version=7.1`,
      "only configured metadata endpoint may be contacted",
    );
    lookups++;
    if (changePat) store.setSecret("azure.pat", "changed");
    return fail ? new Response("unavailable", { status: 503 }) : Response.json(response);
  });
  for (const source of [sourceUrl("OtherProject"), sourceUrl(projectId, "OtherRepository")]) {
    setSource(source);
    await assert.rejects(prs.image("monitor", repoId, 7, source), /не вложение/);
  }
  const source = sourceUrl(projectId);
  setSource(source);
  const before = store.db.prepare("SELECT * FROM pull_requests").all();
  for (const wrong of [
    { ...metadata, id: "other" },
    { ...metadata, project: { id: "other", name: "Other" } },
  ]) {
    response = wrong;
    await assert.rejects(prs.image("monitor", repoId, 7, source), /не вложение/);
  }
  response = metadata;
  fail = true;
  await assert.rejects(prs.image("monitor", repoId, 7, source));
  fail = false;
  changePat = true;
  await assert.rejects(prs.image("monitor", repoId, 7, source), /Подключение Azure изменилось/);
  assert.equal(lookups, 6);
  assert.deepEqual(store.db.prepare("SELECT * FROM pull_requests").all(), before);
});
