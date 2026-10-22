import test from "node:test";
import assert from "node:assert/strict";
import { searchPattern } from "../server/search-pattern.js";
test("RE2 patterns support alternatives, anchors and Cyrillic, preserving literal default semantics", () => {
  assert.deepEqual(searchPattern("auth|login", "regex")("Use LOGIN"), {start:4,end:9});
  assert.equal(searchPattern("auth|login", "literal")("Use LOGIN"), null);
  assert.deepEqual(searchPattern("^вход", "regex")("abc\nВход"), {start:4,end:8});
  assert.deepEqual(searchPattern("x", "regex")("😀x"), {start:2,end:3});
  assert.throws(()=>searchPattern("[", "regex"), /регулярное выражение/);
  assert.throws(()=>searchPattern("(a)\\1", "regex"), /регулярное выражение/);
  assert.throws(()=>searchPattern("(?=a)", "regex"), /регулярное выражение/);
  assert.equal(searchPattern("(a+)+$", "regex")("a".repeat(20000)+"!"), null);
});
