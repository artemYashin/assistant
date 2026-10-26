import test from "node:test";
import assert from "node:assert/strict";
import { gitProgressParser } from "./progress.mjs";

test("Git progress handles chunks and carriage returns without exposing stderr", () => {
  const events = [],
    parse = gitProgressParser((event) => events.push(event));
  parse(Buffer.from("remote: Counting obj"));
  parse(Buffer.from("ects:  42% (42/100)\rReceiving objects:  5% (5/100), 8 MiB | 1 MiB/s\r"));
  parse(Buffer.from("Authorization: Basic SECRET\nhttps://user:PAT@example.test/repo\n"));
  parse(Buffer.from("Resolving deltas: 100% (20/20), done.\nReceiving objects: 999% invalid\n"));
  assert.deepEqual(events, [
    { stage: "counting", percent: 42 },
    {
      stage: "receiving",
      percent: 5,
      receivedObjects: 5,
      totalObjects: 100,
      receivedBytes: 8 * 1024 ** 2,
      bytesPerSecond: 1024 ** 2,
    },
    { stage: "resolving", percent: 100 },
  ]);
  assert.ok(!JSON.stringify(events).includes("SECRET"));
});

test("unterminated stderr is bounded and unknown diagnostics are ignored", () => {
  const events = [],
    parse = gitProgressParser((event) => events.push(event));
  parse(Buffer.from("x".repeat(50000)));
  parse(Buffer.from("\nUnpacking objects: 75% (3/4)\r"));
  assert.deepEqual(events, [{ stage: "unpacking", percent: 75 }]);
});

test("Git transfer metrics use reported units and do not invent a total byte size", () => {
  const events = [],
    parse = gitProgressParser((event) => events.push(event));
  parse(Buffer.from("Receiving objects: 50% (10/20), 1.50 GiB | 512.00 Ki"));
  parse(Buffer.from("B/s\rReceiving objects: 100% (20/20), 2.00 GiB, done.\n"));
  assert.equal(events[0].receivedBytes, 1.5 * 1024 ** 3);
  assert.equal(events[0].bytesPerSecond, 512 * 1024);
  assert.equal(events[1].receivedBytes, 2 * 1024 ** 3);
  assert.equal(events[1].bytesPerSecond, undefined);
  assert.equal(events[1].totalBytes, undefined);
});
