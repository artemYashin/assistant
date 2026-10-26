import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { IntegrationsAuth } from "../services/backend/src/auth.js";
import { deviceCode, githubLogin } from "../services/backend/src/github-login.js";
test("CLI device login returns code and stores token without exposing it in status", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-gh-auth-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let finish!: (s: string) => void;
  let runs = 0;
  const auth = new IntegrationsAuth(store, async (report) => {
    runs++;
    report("ABCD-1234");
    return new Promise<string>((r) => {
      finish = r;
    });
  });
  const flow = await auth.startGitHub();
  assert.equal(flow.userCode, "ABCD-1234");
  await auth.startGitHub();
  assert.equal(runs, 1);
  finish("private-token");
  await new Promise((r) => setImmediate(r));
  assert.equal((await auth.pollGitHub()).status, "connected");
  assert.equal(store.secret("github.token"), "private-token");
  assert.ok(!JSON.stringify(await auth.pollGitHub()).includes("private-token"));
});
test("failed CLI login is retryable and does not mark account connected", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-gh-fail-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let calls = 0;
  const auth = new IntegrationsAuth(store, async () => {
    calls++;
    throw new Error("Unavailable");
  });
  await auth.startGitHub();
  await new Promise((r) => setImmediate(r));
  assert.equal((await auth.pollGitHub()).status, "error");
  assert.equal(store.secret("github.token"), undefined);
  await auth.startGitHub();
  assert.equal(calls, 2);
});
test("CLI adapter handles code output, isolates credentials and removes temporary config", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-gh-process-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const executable = join(dir, "gh"),
    marker = join(dir, "config-path");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs=require('fs');const args=process.argv.slice(2);
if(args.includes('--help')){console.log('--insecure-storage');process.exit(0)}
if(args[1]==='login'){
 if(!args.includes('--insecure-storage')||process.env.GH_TOKEN||process.env.GITHUB_TOKEN)process.exit(2);
 fs.writeFileSync(${JSON.stringify(marker)},process.env.GH_CONFIG_DIR);
 fs.writeFileSync(process.env.GH_CONFIG_DIR+'/token','fake-secret');
 process.stderr.write('! First copy your one-time code: ABCD-1234\\n');
}else if(args[1]==='token'){console.log(fs.readFileSync(process.env.GH_CONFIG_DIR+'/token','utf8'))}
`,
    { mode: 0o700 },
  );
  let code = "";
  assert.equal(
    await githubLogin((c) => {
      code = c;
    }, executable),
    "fake-secret",
  );
  assert.equal(code, "ABCD-1234");
  assert.equal(existsSync(readFileSync(marker, "utf8")), false);
  assert.equal(deviceCode("unrelated 1234-5678"), undefined);
});

test("CLI adapter never exposes token command diagnostics", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-gh-errors-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const executable = join(dir, "gh");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const args=process.argv.slice(2);
if(args.includes('--help'))process.exit(0);
if(args[1]==='login'){if(args.includes('--insecure-storage'))process.exit(2);process.exit(0)}
process.stderr.write('secret-token');process.exit(1);
`,
    { mode: 0o700 },
  );
  await assert.rejects(
    githubLogin(() => {}, executable),
    (error) =>
      error instanceof Error &&
      error.message.includes("Не удалось получить токен") &&
      !error.message.includes("secret-token"),
  );
});
