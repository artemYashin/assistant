import test from "node:test";
import assert from "node:assert/strict";
import { developerGroup } from "../src/developer-status.js";

test("developer status grouping is type independent, exclusive and defaults to active", () => {
  const groups = {Prod: "done", UAT: "review", "Ready for Testing": "review", Closed: "active"} as const;
  assert.equal(developerGroup("prod", groups), "done");
  assert.equal(developerGroup(" UAT ", groups), "review");
  assert.equal(developerGroup("Ready for Testing", groups), "review");
  assert.equal(developerGroup("Closed", groups), "active");
  assert.equal(developerGroup("New status", groups), "active");
  assert.equal(developerGroup("Prod", {}), "active");
});
