import { randomBytes } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RepositoryBrowser, safePath } from './engine.mjs';

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'orbit-code-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const work = path.join(root, 'origin'); await fs.mkdir(work);
  const git = (...args) => execFileSync('git', ['-C', work, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  await fs.mkdir(path.join(work, 'src'));
  await fs.writeFile(path.join(work, 'src', 'hello.ts'), 'const greeting = "hello World";\nsecond line\n');
  await fs.writeFile(path.join(work, '.hidden'), 'hello hidden\n');
  await fs.writeFile(path.join(work, 'binary'), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(work, 'large'), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  await fs.symlink('/etc/passwd', path.join(work, 'outside'));
  git('add', '.'); git('commit', '-m', 'initial');
  const first = git('rev-parse', 'HEAD');
  git('branch', 'feature/nested');
  const browser = new RepositoryBrowser(path.join(root, 'cache'), { allowLocal: true, ...options });
  const url = pathToFileURL(work).href;
  const events = [];
  const request = (operation, extra = {}) => browser.execute({ url, token: 'fixture-secret', operation, branch: 'main', ...extra }, event => events.push(event));
  return { root, work, git, browser, request, first, events };
}

test('isolated snapshots, branch selection, local tree and content search', async t => {
  const { request, first, events } = await fixture(t);
  const branches = await request('branches');
  assert.deepEqual(branches.branches, ['feature/nested', 'main']);
  assert.equal(branches.defaultBranch, 'main');
  const status = await request('status');
  assert.equal(status.sha, first); assert.equal(status.current, true);
  const tree = await request('tree');
  assert.ok(tree.entries.some(e => e.name === 'src' && e.type === 'directory'));
  assert.ok(tree.entries.some(e => e.name === 'outside' && e.type === 'symlink'));
  assert.match((await request('file', { path: 'src/hello.ts' })).text, /hello World/);
  assert.match((await request('file', { path: 'large' })).unavailable, /2 MiB/);
  assert.match((await request('file', { path: 'binary' })).unavailable, /UTF-8/);
  assert.equal((await request('file', { path: 'outside' })).text, '/etc/passwd');
  assert.equal((await request('search', { query: 'HELLO', mode: 'name' })).total, 1);
  const found = await request('search', { query: 'hello', mode: 'content' });
  assert.ok(events.some(e => e.stage === 'fetching'));
  assert.ok(events.some(e => e.stage === 'snapshot' && e.percent === 100));
  assert.ok(events.some(e => e.stage === 'searching'));
  assert.equal(events[0].stage, 'queued');
  assert.equal(found.total, 2); assert.equal(found.coverage.skippedFiles, 3);
  assert.ok(found.results.some(r => r.path === '.hidden'));
  assert.ok(found.results.some(r => r.path === 'src/hello.ts' && r.line === 1));
  assert.equal((await request('search', { query: 'NOT_PRESENT', mode: 'content' })).total, 0);
  await request('status', { branch: 'feature/nested' });
  assert.match((await request('file', { branch: 'feature/nested', path: 'src/hello.ts' })).text, /hello/);
});

test('checking does not advance displayed code, pull is local only, stale revision rejected', async t => {
  const { request, git, work, first } = await fixture(t, { fetchDepth: 200 });
  await request('status');
  await fs.writeFile(path.join(work, 'src/hello.ts'), 'new version\n');
  git('add', '.'); git('commit', '-m', 'next'); const head = git('rev-parse', 'HEAD');
  const checked = await request('status', { refresh: true });
  assert.equal(checked.sha, first); assert.equal(checked.remoteSha, head); assert.equal(checked.behind, 1);
  assert.match((await request('file', { path: 'src/hello.ts' })).text, /hello World/);
  const pulled = await request('pull'); assert.equal(pulled.sha, head); assert.equal(pulled.behind, 0);
  assert.equal((await request('file', { path: 'src/hello.ts' })).text, 'new version\n');
  await assert.rejects(request('tree', { revision: first }), /Снимок обновился/);
  assert.equal(git('rev-parse', 'HEAD'), head); assert.equal(git('status', '--porcelain'), '');
});

test('untrusted paths, shell-like input and remote write operations cannot escape', async t => {
  const { request, root } = await fixture(t);
  for (const value of ['../secret', '/etc/passwd', 'a/../../secret', 'a\\b', '.git/config', 'a/./b']) assert.equal(safePath(value), false);
  await assert.rejects(request('file', { path: '../secret' }));
  await assert.rejects(request('push'));
  await assert.rejects(request('status', { branch: '--upload-pack=evil' }));
  await assert.rejects(request('status', { branch: 'main; touch /tmp/unsafe' }));
  const production = new RepositoryBrowser(path.join(root, 'production'));
  await assert.rejects(production.execute({ url: pathToFileURL(root).href, token: 'secret', operation: 'branches' }), /HTTPS/);
  await assert.rejects(production.execute({ url: 'https://user:secret@example.invalid/repo', token: 'secret', operation: 'branches' }), /HTTPS/);
  await assert.rejects(production.execute({ url: 'https://example.invalid/repo', token: 'a\nb', operation: 'branches' }), /токен/);
  await request('status');
  const output = await request('search', { query: '$(touch unsafe)', mode: 'content' });
  assert.equal(output.total, 0);
});

test('cache never persists PAT or credential headers', async t => {
  const { request, root } = await fixture(t);
  await request('status');
  async function inspect(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, item.name);
      if (item.isDirectory()) await inspect(p);
      else if (item.isFile() && !p.includes('/objects/')) {
        const text = await fs.readFile(p, 'utf8');
        assert.ok(!text.includes('fixture-secret')); assert.ok(!text.includes('Authorization: Basic'));
      }
    }
  }
  await inspect(path.join(root, 'cache'));
});

test('oversized fetch preserves objects and can continue after increasing quota', async t => {
  const { request, root, work, git, browser } = await fixture(t, { maxCacheBytes: 64 * 1024 });
  await fs.writeFile(path.join(work, 'random.bin'), randomBytes(256 * 1024));
  git('add', '.'); git('commit', '-m', 'large binary');
  await assert.rejects(request('status'), /Скачанные данные сохранены/);
  const repos = await fs.readdir(path.join(root, 'cache'));
  assert.equal(repos.length, 1);
  const gitDir = path.join(root, 'cache', repos[0], 'git');
  const head = git('rev-parse', 'HEAD');
  assert.equal(execFileSync('git', ['--git-dir=' + gitDir, 'cat-file', '-t', head], { encoding: 'utf8' }).trim(), 'commit');
  browser.maxCacheBytes = 8 * 1024 ** 2;
  assert.equal((await request('status')).sha, head);
  // The lightweight default downloads one commit, with all current files.
  assert.equal(execFileSync('git', ['--git-dir=' + gitDir, 'rev-list', '--count', head], { encoding: 'utf8' }).trim(), '1');
  assert.match((await request('file', { path: 'src/hello.ts' })).text, /hello World/);
});

test('reopening an old cached branch works without contacting its origin', async t => {
  const { request, root, work, first, events } = await fixture(t);
  const initial = await request('status');
  const [repo] = await fs.readdir(path.join(root, 'cache'));
  const dir = path.join(root, 'cache', repo);
  const stateName = (await fs.readdir(dir)).find(name => name.endsWith('.json'));
  const statePath = path.join(dir, stateName);
  await fs.writeFile(statePath, JSON.stringify({ ...JSON.parse(await fs.readFile(statePath, 'utf8')), checkedAt: '2000-01-01T00:00:00.000Z' }));
  await fs.rename(work, work + '-offline');
  events.length = 0;
  const reopened = await request('status');
  assert.equal(reopened.sha, first);
  assert.equal(reopened.checkedAt, '2000-01-01T00:00:00.000Z');
  assert.equal(reopened.remoteSha, initial.remoteSha);
  assert.ok(!events.some(event => event.stage === 'fetching'));
  assert.match((await request('file', { path: 'src/hello.ts' })).text, /hello World/);
  await assert.rejects(request('status', { refresh: true }));
});

test('branch catalog survives service restart and refresh is explicit', async t => {
  const { request, browser, work, root } = await fixture(t);
  const initial = await request('branches');
  await fs.rename(work, work + '-offline');
  const restarted = new RepositoryBrowser(path.join(root, 'cache'), { allowLocal: true });
  const input = { url: pathToFileURL(work).href, token: 'fixture-secret', operation: 'branches' };
  assert.deepEqual(await restarted.execute(input), initial);
  await assert.rejects(restarted.execute({ ...input, refresh: true }));
  assert.deepEqual(await restarted.execute(input), initial); // A failed check preserves the last catalog.
  assert.ok(browser.branchesCache.size);
});
