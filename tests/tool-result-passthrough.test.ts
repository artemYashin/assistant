import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, AppError } from "../server/store.js";
import { sessionConfig } from "../server/agent.js";

test("tool wrapper preserves large structured and binary results and handles failures", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-tool-result-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const structured = {
    rows: Array.from({ length: 1000 }, (_, id) => ({
      id,
      text: "Complete content ".repeat(10),
    })),
    nextOffset: 1000,
  };
  const binary = {
    resultType: "success",
    textResultForLlm: "Image",
    binaryResultsForLlm: [
      { type: "image", mimeType: "image/png", data: "a".repeat(50000) },
    ],
  };
  const results = [structured, binary, "x".repeat(50000)];
  const tools = sessionConfig(
    store,
    { client: "", project: "" },
    undefined,
    undefined,
    undefined,
    undefined,
    [
      ...results.map((result, i) => ({
        name: `result_${i}`,
        description: "Test result",
        handler: async () => result,
      })),
      {
        name: "failure",
        description: "Test error",
        handler: async () => {
          throw new AppError(400, "Expected failure");
        },
      },
    ],
  ).tools!;
  for (const [i, result] of results.entries()) {
    assert.ok(JSON.stringify(result).length > 24000);
    const actual = await tools.find((tool) => tool.name === `result_${i}`)!
      .handler!({}, {} as any);
    assert.strictEqual(actual, result);
  }
  const failure = (await tools.find((tool) => tool.name === "failure")!
    .handler!({}, {} as any)) as any;
  assert.equal(failure.success, false);
});
