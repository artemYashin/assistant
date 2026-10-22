import test from "node:test";
import assert from "node:assert/strict";
import { matchesReviewers, reviewerFilter } from "../server/pr-reviewer-filter.js";
test("removed synthetic PAT owner never matches; explicit selections survive", () => {
  const pr = { reviewers: [{ id: "me", isRequired: true }] };
  assert.equal(matchesReviewers(pr, { mode: "required" }), false);
  const raw = JSON.stringify({ required: [{ id: "$self", name: "Self", email: "" }, { id: "me", name: "Me", email: "" }], optional: [] });
  assert.deepEqual(reviewerFilter(raw).required.map(p => p.id), ["me"]);
  assert.equal(matchesReviewers(pr, { mode: "required", reviewer_filter: raw }), true);
  assert.equal(matchesReviewers(pr, { mode: "all" }), true);
});
