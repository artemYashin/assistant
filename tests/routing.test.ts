import test from "node:test";
import assert from "node:assert/strict";
import {
  pagePaths,
  pageForPath,
  ticketPath,
  pullRequestPath,
} from "../src/routing.js";
test("every section has a stable route, with trailing slash and unknown path handling", () => {
  for (const [page, path] of Object.entries(pagePaths)) {
    assert.equal(pageForPath(path), page);
    assert.equal(pageForPath(path + "/"), page);
  }
  assert.equal(pageForPath("/unknown"), undefined);
});
test("ticket deep links preserve collection source and exact numeric ID", () => {
  const url = new URL(
    ticketPath(123456, "https://ado.test/My Collection|Project & Team"),
    "http://localhost",
  );
  assert.equal(url.pathname, "/tickets");
  assert.equal(url.searchParams.get("id"), "123456");
  assert.equal(
    url.searchParams.get("source"),
    "https://ado.test/My Collection|Project & Team",
  );
});

test("PR deep links preserve full monitor and repository identity", () => {
  const url = new URL(
    pullRequestPath({ monitor: "m & 1", repo: "repo/with spaces", number: 42 }),
    "http://localhost",
  );
  assert.equal(url.pathname, "/pull-requests");
  assert.equal(url.searchParams.get("monitor"), "m & 1");
  assert.equal(url.searchParams.get("repo"), "repo/with spaces");
  assert.equal(url.searchParams.get("number"), "42");
});
