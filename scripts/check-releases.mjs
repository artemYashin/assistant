import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const read = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const releases = read("../src/releases.json");
const pkg = read("../package.json");
const lock = read("../package-lock.json");
assert.ok(releases.length > 0, "Release history must not be empty");
assert.equal(
  releases[0].version,
  pkg.version,
  "Current release must match package version",
);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[""].version, pkg.version);
let previous;
for (const release of releases) {
  assert.match(release.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(release.date).toISOString().slice(0, 10), release.date);
  assert.ok(release.title.trim() && release.changes.length);
  const parts = release.version.split(".").map(Number);
  if (previous) {
    const firstDifference = parts.findIndex(
      (part, i) => part !== previous.parts[i],
    );
    assert.ok(
      firstDifference >= 0 &&
        parts[firstDifference] < previous.parts[firstDifference],
      "Releases must have unique descending versions",
    );
    assert.ok(release.date <= previous.date, "Releases must be newest first");
  }
  previous = { parts, date: release.date };
  for (const change of release.changes) {
    assert.ok(["feature", "improvement", "fix"].includes(change.kind));
    assert.ok(typeof change.text === "string" && change.text.trim());
  }
}
console.log(`Release history checked: v${pkg.version}`);
