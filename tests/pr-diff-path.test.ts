import test from "node:test";
import assert from "node:assert/strict";
import { diffFileLabel } from "../src/pr-diff.js";
test("diff paths shorten each long directory but keep full file names", () => {
  assert.deepEqual(
    diffFileLabel("/packages/verylongdirectory/src/VeryLongComponent.tsx"),
    {
      directory: "/pac…ges/ver…ory/src/",
      name: "VeryLongComponent.tsx",
    },
  );
  assert.deepEqual(diffFileLabel("index.ts"), {
    directory: "",
    name: "index.ts",
  });
  assert.deepEqual(diffFileLabel("1234567/file.ts"), {
    directory: "1234567/",
    name: "file.ts",
  });
});
