import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { PullRequests } from "../server/pull-requests.js";
import { prTools } from "../server/pr-tools.js";

test("PR chat tools paginate, isolate context and enqueue only explicit review requests", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-pr-tools-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/org",
    azureProject: "P",
  });
  store.setSecret("azure.pat", "pat");
  store.setSecret("github.token", "token");
  const service = new PullRequests(store, {
    active: () => null,
    chat: async () => ({ body: "", requestId: "" }),
  });
  const context = { client: "C", project: "P" };
  service.save({ ...context, repository: "repo", mode: "all", enabled: true });
  const monitor = service.monitors()[0].id;
  const insert = store.db.prepare(
    "INSERT INTO pull_requests(monitor,repo,number,title,author,url,head,target,draft,in_scope,synced_at,description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  for (let i = 1; i <= 25; i++)
    insert.run(
      monitor,
      "repo",
      i,
      "Title",
      "Author",
      "https://ado.test/pr",
      "head",
      "target",
      0,
      1,
      "today",
      "a".repeat(3000),
    );
  const call = (
    name: string,
    args: any,
    prompt = "Запусти ревью PR #1",
    ctx = context,
  ) =>
    prTools(store, service, ctx, prompt, () => {}).find((t) => t.name === name)!
      .handler!(args, {} as any) as Promise<any>;
  const first = await call("list_pull_requests", {});
  assert.equal(first.total, 25);
  assert.equal(first.items.length, 20);
  const last = await call("list_pull_requests", { offset: first.nextOffset });
  assert.equal(last.items.length, 5);
  assert.equal(last.hasMore, false);
  const key = { monitor, repo: "repo", number: 1 };
  const detail = await call("get_pull_request", key);
  assert.equal(detail.text.length, 2000);
  assert.equal(detail.nextOffset, 2000);
  await assert.rejects(
    call("get_pull_request", key, "", { client: "other", project: "P" }),
    /не найден/,
  );
  await assert.rejects(
    call("request_pull_request_review", key, "Покажи результат ревью PR #1"),
    /явная просьба/,
  );
  await assert.rejects(
    call("request_pull_request_review", key, "Не запускай ревью PR #1"),
    /явная просьба/,
  );
  const queued = await call("request_pull_request_review", key);
  assert.equal(queued.job.status, "queued");
  assert.equal(queued.azureChanged, false);
  assert.equal(
    (await call("request_pull_request_review", key)).job.id,
    queued.job.id,
  );
  store.db.prepare("UPDATE pull_requests SET draft=1 WHERE number=2").run();
  await assert.rejects(
    call("request_pull_request_review", { ...key, number: 2 }),
    /черновики/,
  );
});
