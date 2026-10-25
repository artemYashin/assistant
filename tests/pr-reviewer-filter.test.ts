import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesReviewers,
  reviewerFilter,
} from "../server/pr-reviewer-filter.js";
test("removed synthetic PAT owner never matches; explicit selections survive", () => {
  const pr = { reviewers: [{ id: "me", isRequired: true }] };
  assert.equal(matchesReviewers(pr, { mode: "required" }), false);
  const raw = JSON.stringify({
    required: [
      { id: "$self", name: "Self", email: "" },
      { id: "me", name: "Me", email: "" },
    ],
    optional: [],
  });
  assert.deepEqual(
    reviewerFilter(raw).required.map((p) => p.id),
    ["me"],
  );
  assert.equal(
    matchesReviewers(pr, { mode: "required", reviewer_filter: raw }),
    true,
  );
  assert.equal(matchesReviewers(pr, { mode: "all" }), true);
});
test("Created by OR Required OR Optional matches immutable Azure IDs, including author-only selection", () => {
  const person = (id: string) => ({
    id,
    name: id,
    email: "same@example.invalid",
  });
  const monitor = {
    mode: "required",
    reviewer_filter: JSON.stringify({
      required: [person("required")],
      optional: [person("optional")],
      createdBy: [person("author"), person("other")],
    }),
  };
  assert.equal(
    matchesReviewers({ createdBy: { id: "AUTHOR" }, reviewers: [] }, monitor),
    true,
  );
  assert.equal(matchesReviewers({ createdBy: { id: "other" } }, monitor), true);
  assert.equal(
    matchesReviewers(
      {
        createdBy: { id: "unknown" },
        reviewers: [{ id: "required", isRequired: true }],
      },
      monitor,
    ),
    true,
  );
  assert.equal(
    matchesReviewers(
      { reviewers: [{ id: "optional", isRequired: false }] },
      monitor,
    ),
    true,
  );
  assert.equal(
    matchesReviewers(
      {
        createdBy: {
          id: "unknown",
          displayName: "author",
          uniqueName: "same@example.invalid",
        },
        reviewers: [{ id: "required", isRequired: false }],
      },
      monitor,
    ),
    false,
  );
  assert.equal(matchesReviewers({}, monitor), false);
  const onlyAuthor = {
    mode: "required",
    reviewer_filter: JSON.stringify({
      required: [],
      optional: [],
      createdBy: [person("author")],
    }),
  };
  assert.equal(
    matchesReviewers({ createdBy: { id: "author" } }, onlyAuthor),
    true,
  );
  assert.equal(
    matchesReviewers(
      { reviewers: [{ id: "author", isRequired: true }] },
      onlyAuthor,
    ),
    false,
  );
  assert.deepEqual(
    reviewerFilter(
      JSON.stringify({ required: [person("required")], optional: [] }),
    ).createdBy,
    [],
  );
  assert.equal(matchesReviewers({}, { ...monitor, mode: "all" }), true);
});
