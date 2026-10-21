import test from 'node:test';
import assert from 'node:assert/strict';
import { gitProgressParser } from './progress.mjs';

test('Git progress handles chunks and carriage returns without exposing stderr', () => {
  const events = [], parse = gitProgressParser(event => events.push(event));
  parse(Buffer.from('remote: Counting obj'));
  parse(Buffer.from('ects:  42% (42/100)\rReceiving objects:  5% (5/100), 8 MiB | 1 MiB/s\r'));
  parse(Buffer.from('Authorization: Basic SECRET\nhttps://user:PAT@example.test/repo\n'));
  parse(Buffer.from('Resolving deltas: 100% (20/20), done.\nReceiving objects: 999% invalid\n'));
  assert.deepEqual(events, [{ stage: 'counting', percent: 42 }, { stage: 'receiving', percent: 5 }, { stage: 'resolving', percent: 100 }]);
  assert.ok(!JSON.stringify(events).includes('SECRET'));
});

test('unterminated stderr is bounded and unknown diagnostics are ignored', () => {
  const events = [], parse = gitProgressParser(event => events.push(event));
  parse(Buffer.from('x'.repeat(50000)));
  parse(Buffer.from('\nUnpacking objects: 75% (3/4)\r'));
  assert.deepEqual(events, [{ stage: 'unpacking', percent: 75 }]);
});
