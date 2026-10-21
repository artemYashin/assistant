import test from 'node:test';
import assert from 'node:assert/strict';
import { RepositoryJobs } from './jobs.mjs';

test('reconnected observers share one job and receive its latest progress', async () => {
  const jobs = new RepositoryJobs();
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const first = jobs.run('same', async report => {
    calls++; report({ stage: 'receiving', percent: 42 }); await gate; return 'snapshot';
  });
  await new Promise(resolve => setImmediate(resolve));
  const updates = [];
  const second = jobs.run('same', () => { throw new Error('must not execute'); }, event => updates.push(event));
  assert.equal(updates.at(-1).percent, 42);
  assert.equal(updates.at(-1).queueLength, 1);
  assert.equal(updates.at(-1).queuePosition, 0);
  release();
  assert.deepEqual(await Promise.all([first, second]), ['snapshot', 'snapshot']);
  assert.equal(calls, 1);
});

test('queue positions advance and disconnect does not cancel shared work', async () => {
  const jobs = new RepositoryJobs();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const controller = new AbortController(), updates = [], queued = [];
  const first = jobs.run('first', async report => { await gate; report({ stage: 'finalizing' }); return 1; }, event => updates.push(event), controller.signal);
  const second = jobs.run('second', async () => 2, event => queued.push(event));
  assert.equal(queued.at(-1).queuePosition, 1);
  controller.abort();
  const count = updates.length;
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.equal(updates.length, count);
  assert.ok(queued.some(event => event.queuePosition === 0));
});

test('a failed job is removed and a later request can retry', async () => {
  const jobs = new RepositoryJobs();
  await assert.rejects(jobs.run('same', async () => { throw new Error('failed'); }), /failed/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await jobs.run('same', async () => 'retried'), 'retried');
});

test('page reload uses cached branches and observes the running pull', async () => {
  const { RepositoryBrowser } = await import('./engine.mjs');
  const { createHash } = await import('node:crypto');
  const browser = new RepositoryBrowser('/unused');
  const input = { url: 'https://example.test/repo', token: 'credential', branch: 'feature' };
  const key = createHash('sha256').update(input.url + input.token).digest('hex');
  browser.branchesCache.set(key, { time: 0, result: { branches: ['feature'] } });
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  browser.perform = async (_input, report) => {
    calls++; report({ stage: 'receiving', percent: 50 }); await gate; return { sha: 'snapshot' };
  };
  const pull = browser.execute({ ...input, operation: 'pull' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await browser.execute({ ...input, operation: 'branches' }), { branches: ['feature'] });
  const events = [];
  const status = browser.execute({ ...input, operation: 'status', refresh: true }, event => events.push(event));
  assert.equal(events.at(-1).percent, 50);
  release();
  assert.deepEqual(await pull, await status);
  assert.equal(calls, 1);
});

test('cancel waits for running cleanup and removes queued work only in its scope', async () => {
  const jobs = new RepositoryJobs();
  let finish, stopped = false, queuedCalled = false;
  const first = jobs.run('running', async (_report, signal) => {
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    await new Promise(resolve => { finish = resolve; });
    stopped = true;
    throw signal.reason;
  }, undefined, undefined, { scope: 'old' });
  const queued = jobs.run('queued', async () => { queuedCalled = true; }, undefined, undefined, { scope: 'old' });
  const other = jobs.run('other', async () => { assert.equal(stopped, true); return 'next'; }, undefined, undefined, { scope: 'new' });
  const settled = Promise.allSettled([first, queued]);
  await new Promise(resolve => setImmediate(resolve));
  let cancelled = false;
  const cancellation = jobs.cancel(job => job.scope === 'old').then(count => { cancelled = true; return count; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, false);
  finish();
  assert.equal(await cancellation, 2);
  assert.equal(await other, 'next');
  assert.equal(queuedCalled, false);
  assert.deepEqual((await settled).map(result => result.status), ['rejected', 'rejected']);
});

test('cancelled request cannot start after a delayed arrival', async () => {
  const { RepositoryBrowser } = await import('./engine.mjs');
  const browser = new RepositoryBrowser('/unused');
  browser.perform = async () => { throw new Error('must not start'); };
  const input = { url: 'https://example.test/repo', token: 'credential', branch: 'old' };
  await browser.execute({ ...input, operation: 'cancel', cancelledRequestIds: ['late'] });
  await assert.rejects(browser.execute({ ...input, operation: 'pull', requestId: 'late' }), /отменена/);
});
