import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  azureImageResolution,
  azureImageUrl,
  type PrImageReason,
} from "../services/backend/src/pr-images.js";
import {
  safePrImageDiagnostic,
  prImageReasons,
} from "../services/frontend/src/features/render-content/lib/pr-image-diagnostic.js";
import { Store } from "../services/backend/src/store.js";
import { PullRequests } from "../services/backend/src/pull-requests.js";

// Contract check belongs in tests, not in browser-to-server imports.
const descriptions: Record<PrImageReason, string> = prImageReasons;
test("every backend PR diagnostic has a frontend explanation", () => {
  assert.ok(Object.values(descriptions).every((description) => description.length > 0));
});

const base = "https://dev.azure.com/private-org";
const pr = `${base}/private-project/_git/private-repo/pullrequest/7`;
const wit = `${base}/private-project/_apis/wit/attachments/11111111-1111-1111-1111-111111111111`;
const git = `${base}/private-project/_apis/git/repositories/private-repo/pullRequests/7/attachments/private.png`;
const resolve = (url: string) => azureImageResolution(url, base, pr, "private-repo", 7, "7.1");

test("PR image diagnostics identify rejection stages without URLs or private values", () => {
  const cases = [
    ["", "empty_source"],
    ["https://[bad", "invalid_url"],
    [wit.replace("https:", "http:"), "unsupported_protocol"],
    [wit.replace("https://", "https://user:secret@"), "credentials_in_url"],
    [wit.replace("dev.azure.com", "evil.test"), "different_origin"],
    [wit.replace("/private-org/", "/other/"), "different_collection"],
    [wit + "%00", "invalid_path"],
    [wit.replace("attachments/", "workitems/"), "unsupported_path"],
    [git.replace("/private-project/", "/other/"), "different_project"],
    [git.replace("/private-repo/", "/other/"), "different_repository"],
    [git.replace("/7/", "/8/"), "different_pr"],
    ["blob:https://private.example/private-token", "temporary_blob"],
    ["https://orbit.invalid/pr-inline-image/unavailable-private", "invalid_inline"],
    ["data:image/png;base64,secret", "invalid_inline"],
  ];
  for (const [url, reason] of cases) {
    const result = resolve(url);
    assert.equal(result.url, null);
    assert.deepEqual(result.diagnostic, {
      scope: "pr",
      format: 1,
      stage: "before_request",
      reason,
    });
    assert.equal(azureImageUrl(url, base, pr, "private-repo", 7, "7.1"), null);
    assert.doesNotMatch(JSON.stringify(result.diagnostic), /private|secret|https|11111111/);
  }
  for (const url of [wit, git, wit.replace("dev.azure.com", "dev.azure.com.mcas.ms")]) {
    const result = resolve(url + "?private-token=secret#private");
    assert.equal(result.diagnostic, undefined);
    assert.equal(result.url, azureImageUrl(url, base, pr, "private-repo", 7, "7.1"));
    assert.equal(new URL(result.url!).hostname, "dev.azure.com");
    assert.equal(new URL(result.url!).search, "?api-version=7.1");
  }
});

test("clipboard PR diagnostic reconstructs an allowlisted report even from malformed API data", () => {
  assert.deepEqual(
    safePrImageDiagnostic(
      {
        scope: "pr",
        reason: "different_pr",
        url: "https://secret",
        token: "secret",
        format: 999,
        stage: "https://secret",
      },
      "missing_diagnostic",
    ),
    {
      scope: "pr",
      format: 1,
      stage: "before_request",
      reason: "different_pr",
    },
  );
  for (const value of [
    null,
    {},
    { scope: "pr", reason: "https://secret" },
    { scope: "pr", reason: "__proto__" },
    { scope: "ticket", reason: "different_pr" },
  ]) {
    assert.deepEqual(safePrImageDiagnostic(value, "unmapped_source"), {
      scope: "pr",
      format: 1,
      stage: "before_request",
      reason: "unmapped_source",
    });
  }
});

test("saved and exact PR previews include safe rejection diagnostics without rewriting descriptions", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-pr-diag-"));
  const store = new Store(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  store.set("settings", { ...store.settings(), azureUrl: base, azureProject: "private-project" });
  store.setSecret("azure.pat", "fixture");
  const prs = new PullRequests(store, {
    active: () => null,
    chat: async () => ({ body: "", requestId: "" }),
  });
  store.db
    .prepare(
      "INSERT INTO pr_projects(id,client,project,source,azure_project,mode,enabled,repository) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run("monitor", "client", "project", base, "private-project", "all", 1, "private-repo");
  const description = `![hidden](${wit.replace("dev.azure.com", "foreign.test")}?token=private)\n\n![blob](blob:https://secret.test/id)\n\n![invalid](data:image/png;base64,AAAA)`;
  store.db
    .prepare(
      "INSERT INTO pull_requests(monitor,repo,number,title,author,url,head,target,draft,in_scope,synced_at,description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "monitor",
      "private-repo",
      7,
      "Fixture",
      "Author",
      pr,
      "a".repeat(40),
      "b".repeat(40),
      0,
      1,
      "2026-11-02",
      description,
    );
  const before = store.db.prepare("SELECT * FROM pull_requests").all();
  const check = (item: any) => {
    assert.equal(item.images.length, 3);
    assert.deepEqual(
      item.images.map((image: any) => image.diagnostic.reason),
      ["different_origin", "temporary_blob", "invalid_inline"],
    );
    for (const image of item.images) {
      assert.equal(image.preview, null);
      assert.doesNotMatch(JSON.stringify(image.diagnostic), /private|token|foreign|secret|https/);
    }
  };
  check(prs.list({ client: "client", project: "project" })[0]);
  check(prs.list({ client: "client", project: "project" })[0]);
  let downloads = 0;
  t.mock.method(globalThis, "fetch", async (input: any) => {
    const url = String(input);
    if (url.includes("/attachments/")) {
      downloads++;
      throw new Error("must not download rejected image");
    }
    if (url.includes("/workitems")) return Response.json({ value: [] });
    return Response.json({
      pullRequestId: 7,
      status: "completed",
      title: "Fixture",
      description,
      repository: {
        id: "private-repo",
        name: "private-repo",
        project: { id: "private-project", name: "private-project" },
      },
      lastMergeSourceCommit: { commitId: "a".repeat(40) },
      lastMergeTargetCommit: { commitId: "b".repeat(40) },
      sourceRefName: "refs/heads/feature",
      targetRefName: "refs/heads/main",
    });
  });
  const preview = (await prs.lookup(7)).item;
  check(preview);
  await assert.rejects(
    prs.image(
      "monitor",
      "private-repo",
      7,
      prs.list({ client: "client", project: "project" })[0].images[0].source,
    ),
    /не вложение/,
  );
  assert.equal(downloads, 0);
  assert.deepEqual(store.db.prepare("SELECT * FROM pull_requests").all(), before);
});
