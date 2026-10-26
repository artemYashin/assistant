import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { PullRequests } from "../services/backend/src/pull-requests.js";

test("line comments use the right file, line and iteration; stale/invalid targets never write", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-line-comment-"));
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
  const monitor = prs.monitors()[0].id;
  store.db
    .prepare(
      "INSERT INTO pull_requests(monitor,repo,number,title,author,url,head,target,draft,in_scope,synced_at) VALUES (?, 'repo', 42, 'Title', 'Author', '', '', '', 0, 1, '')",
    )
    .run(monitor);
  const input = {
    monitor,
    repo: "repo",
    number: 42,
    head: "a".repeat(40),
    base: "b".repeat(40),
    target: "c".repeat(40),
    path: "/renamed.ts",
    line: 2,
    content: "  Please check this.\nSecond line.  ",
  };
  let writes = 0,
    status = "active",
    changedHead = false;
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    const url = new URL(String(raw));
    let data: any;
    if (init.method === "POST") {
      writes++;
      assert(url.pathname.endsWith("/pullrequests/42/threads"));
      assert.deepEqual(JSON.parse(init.body), {
        comments: [{ parentCommentId: 0, content: input.content, commentType: 1 }],
        status: 1,
        threadContext: {
          filePath: input.path,
          rightFileStart: { line: 2, offset: 1 },
          rightFileEnd: { line: 2, offset: 1 },
        },
        pullRequestThreadContext: {
          changeTrackingId: 7,
          iterationContext: { firstComparingIteration: 3, secondComparingIteration: 3 },
        },
      });
      data = { id: 55 };
    } else if (url.pathname.endsWith("/threads")) {
      assert.equal(url.searchParams.get("$iteration"), "3");
      assert.equal(url.searchParams.get("$baseIteration"), "3");
      data = {
        value: [
          {
            id: 55,
            status: "active",
            threadContext: { filePath: input.path, rightFileStart: { line: 2 } },
            comments: [
              {
                id: 1,
                content: input.content,
                author: { displayName: "Author" },
                commentType: "text",
              },
              { id: 2, content: "Reply", author: { displayName: "Reviewer" }, commentType: "text" },
              { id: 3, content: "Deleted reply", isDeleted: true },
            ],
          },
          { id: 56, isDeleted: true, comments: [{ id: 1, content: "Deleted thread" }] },
          { id: 57, comments: [{ id: 1, content: "System message", commentType: "system" }] },
          {
            id: 58,
            status: "fixed",
            threadContext: { filePath: "/outside-diff.ts", rightFileStart: { line: 99 } },
            comments: [{ id: 1, content: "Keep this visible" }],
          },
        ],
      };
    } else if (url.pathname.endsWith("/iterations")) {
      data = {
        value: [
          {
            id: 3,
            sourceRefCommit: { commitId: input.head },
            commonRefCommit: { commitId: input.base },
          },
        ],
      };
    } else if (url.pathname.endsWith("/changes")) {
      assert.equal(url.searchParams.get("$compareTo"), "0");
      data = {
        changeEntries: [
          { changeTrackingId: 7, item: { path: input.path }, changeType: "rename, edit" },
        ],
      };
    } else if (url.pathname.endsWith("/items")) {
      assert.equal(url.searchParams.get("versionDescriptor.version"), input.head);
      data = { content: "first\nsecond" };
    } else {
      data = {
        pullRequestId: 42,
        repository: { id: "repo" },
        status,
        lastMergeSourceCommit: { commitId: changedHead ? "d".repeat(40) : input.head },
        lastMergeTargetCommit: { commitId: input.target },
      };
    }
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  });
  assert.deepEqual(await prs.commentOnLine(input), { id: 55 });
  const comments = await prs.lineComments(monitor, "repo", 42, input.head, input.base);
  assert.equal(comments.length, 2);
  assert.equal(comments[0].path, input.path);
  assert.equal(comments[0].line, 2);
  assert.deepEqual(
    comments[0].comments.map((c: any) => c.content),
    [input.content, "Reply"],
  );
  assert.equal(comments[1].path, "/outside-diff.ts");
  assert.equal(comments[1].status, "fixed");
  await assert.rejects(prs.commentOnLine({ ...input, line: 3 }), /Строка не найдена/);
  await assert.rejects(prs.commentOnLine({ ...input, path: "/missing.ts" }), /Файл не найден/);
  changedHead = true;
  await assert.rejects(prs.commentOnLine(input), /Изменения PR обновились/);
  changedHead = false;
  status = "completed";
  await assert.rejects(prs.commentOnLine(input), /PR уже закрыт/);
  assert.equal(writes, 1);
});
