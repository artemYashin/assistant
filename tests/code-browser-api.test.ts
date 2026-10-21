import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeBrowser, codeBrowserSchema } from "../server/code-browser.js";
import { Store } from "../server/store.js";

test("code browser resolves configured repository and keeps credentials on server", async t => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-code-api-"));
  const store = new Store(dir);
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.CODE_BROWSER_URL, previousKey = process.env.CODE_BROWSER_KEY_FILE;
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CODE_BROWSER_URL; else process.env.CODE_BROWSER_URL = previousUrl;
    if (previousKey === undefined) delete process.env.CODE_BROWSER_KEY_FILE; else process.env.CODE_BROWSER_KEY_FILE = previousKey;
    store.close(); rmSync(dir, { recursive: true, force: true });
  });
  process.env.CODE_BROWSER_URL = "http://code-browser:8010";
  process.env.CODE_BROWSER_KEY_FILE = join(dir, "control", "key");
  const context = { client: "Customer", project: "Portal" };
  store.set("settings", { ...store.rawSettings(), ...context, azureUrl: "https://dev.azure.com/org", azureProject: "Azure Project" });
  store.setSecret("azure.pat", "private-pat");
  store.db.prepare("INSERT INTO pr_projects(id,client,project,source,azure_project,mode,enabled,repository) VALUES (?,?,?,?,?,?,?,?)")
    .run("monitor", context.client, context.project, "https://dev.azure.com/org", "Azure Project", "all", 1, "Repository");
  const calls: { url: string; body: any; authorization: string | null }[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const address = String(url), headers = new Headers(init?.headers);
    calls.push({ url: address, body: init?.body ? JSON.parse(String(init.body)) : undefined, authorization: headers.get("Authorization") });
    const data = address.startsWith("https://dev.azure.com/")
      ? { id: "11111111-2222-3333-4444-555555555555", remoteUrl: "https://untrusted.invalid/steal" }
      : { branches: ["main"], defaultBranch: "main" };
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const browser = new CodeBrowser(store);
  const result = await browser.request({ ...context, operation: "branches" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "http://code-browser:8010/v1/repository");
  assert.equal(calls[1].body.url, "https://dev.azure.com/org/Azure%20Project/_git/11111111-2222-3333-4444-555555555555");
  assert.equal(calls[1].body.token, "private-pat");
  assert.equal(calls[1].body.fetchTimeoutSeconds, 300);
  assert.match(calls[1].authorization!, /^Bearer [0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(result).includes("private-pat"));
  await browser.request({ ...context, operation: "tree", branch: "main" });
  assert.equal(calls.length, 3); // No extra Azure resolution for local reads.
  store.db.prepare("UPDATE pr_projects SET fetch_timeout_seconds=900 WHERE id=?").run("monitor");
  const progress: unknown[] = [];
  globalThis.fetch = (async (_url: any, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("Accept"), "application/x-ndjson");
    assert.equal(JSON.parse(String(init?.body)).fetchTimeoutSeconds, 900);
    return new Response('{"type":"progress","progress":{"stage":"receiving","percent":25}}\n{"type":"result","data":{"current":true}}\n', { headers: { "Content-Type": "application/x-ndjson" } });
  }) as typeof fetch;
  const streamed = await browser.request({ ...context, operation: "pull", branch: "main" }, value => progress.push(value));
  assert.deepEqual(progress, [{ stage: "connecting" }, { stage: "receiving", percent: 25 }]);
  assert.equal(streamed.current, true);

  await assert.rejects(browser.request({ client: "Other", project: "Portal", operation: "branches" }));
  assert.equal(calls.length, 3);
  assert.equal(codeBrowserSchema.safeParse({ ...context, operation: "push" }).success, false);
  assert.equal(codeBrowserSchema.safeParse({ ...context, operation: "tree", url: "https://untrusted.invalid" }).success, false);
  assert.equal(codeBrowserSchema.safeParse({ ...context, operation: "tree", token: "other" }).success, false);
});
