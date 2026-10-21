import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recoverShallowLock } from './recovery.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const gitDir = path.join(root, 'git'), procRoot = path.join(root, 'proc');
  await fs.mkdir(gitDir); await fs.mkdir(procRoot);
  return { gitDir, procRoot, lock: path.join(gitDir, 'shallow.lock') };
}
test('recovers only the abandoned shallow lock and reports recovery', async t => {
  const { gitDir, procRoot, lock } = await fixture(t);
  await fs.writeFile(lock, 'unfinished');
  await fs.writeFile(path.join(gitDir, 'shallow'), 'keep-history');
  await fs.writeFile(path.join(gitDir, 'config.lock'), 'keep-other-lock');
  const events = [];
  assert.equal(await recoverShallowLock(gitDir, { procRoot, report: p => events.push(p.stage) }), true);
  assert.equal(await recoverShallowLock(gitDir, { procRoot }), false);
  assert.deepEqual(events, ['recovering']);
  assert.equal(await fs.readFile(path.join(gitDir, 'shallow'), 'utf8'), 'keep-history');
  assert.equal(await fs.readFile(path.join(gitDir, 'config.lock'), 'utf8'), 'keep-other-lock');
});
test('live Git and unavailable process inspection preserve the lock', async t => {
  const { gitDir, procRoot, lock } = await fixture(t);
  await fs.writeFile(lock, 'unfinished');
  await fs.mkdir(path.join(procRoot, '123'));
  await fs.writeFile(path.join(procRoot, '123', 'comm'), 'git-remote-http\n');
  await assert.rejects(recoverShallowLock(gitDir, { procRoot }), /Git ещё работает/);
  await assert.rejects(recoverShallowLock(gitDir, { procRoot: procRoot + '-missing' }), /Не удалось проверить/);
  assert.equal(await fs.readFile(lock, 'utf8'), 'unfinished');
});
test('does not follow a shallow lock symlink', async t => {
  const { gitDir, procRoot, lock } = await fixture(t);
  await fs.writeFile(path.join(gitDir, 'shallow'), 'keep');
  await fs.symlink('shallow', lock);
  await assert.rejects(recoverShallowLock(gitDir, { procRoot }), /неожиданный тип/);
  assert.equal(await fs.readFile(lock, 'utf8'), 'keep');
});
