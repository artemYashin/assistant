import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "vite";
import { createTwoFilesPatch } from "diff";
import { splitDiff } from "../services/frontend/src/entities/repository/index.js";
import type { CodeToken } from "../services/frontend/src/entities/repository/highlight/index.js";

test("production highlight workers initialize without DOM and highlight TS/TSX", async () => {
  const result = await build({
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    logLevel: "silent",
    build: {
      write: false,
      rollupOptions: {
        input: fileURLToPath(new URL("./fixtures/highlight-workers.ts", import.meta.url)),
      },
    },
  });
  assert.ok(!("on" in result));
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((entry) => entry.output);
  const assets = outputs.filter((entry) => entry.fileName.includes(".worker-"));
  assert.equal(assets.length, 3);
  for (const asset of assets) {
    const source = asset.type === "asset" ? String(asset.source) : asset.code;
    let response: unknown;
    const scope = {
      onmessage: undefined as unknown as (event: { data: unknown }) => void,
      postMessage: (value: unknown) => {
        response = value;
      },
    };
    // Deliberately no document/window: browser-specific dependencies can build
    // successfully yet crash before a worker installs its message handler.
    runInNewContext(source, { self: scope }, { timeout: 5000 });
    assert.equal(typeof scope.onmessage, "function", asset.fileName);
    for (const language of ["typescript", "tsx"]) {
      const code =
        language === "tsx"
          ? 'const view = <Panel title="Hello &amp; world" count={2} />;'
          : "const count: number = 2;";
      let lines: CodeToken[][];
      if (asset.fileName.startsWith("assets/diff-highlight.")) {
        const [file] = splitDiff([createTwoFilesPatch("/a", "/a", "", code + "\n")]);
        scope.onmessage({ data: { file, language } });
        lines = Object.values((response as { right: Record<number, CodeToken[]> }).right);
      } else if (asset.fileName.startsWith("assets/repository-search-highlight.")) {
        scope.onmessage({ data: [{ code, language }] });
        lines = (response as CodeToken[][][])[0];
      } else {
        scope.onmessage({ data: { code, language } });
        lines = response as CodeToken[][];
      }
      assert.equal(lines.map((line) => line.map((token) => token.text).join("")).join("\n"), code);
      assert.ok(
        lines.flat().some((token) => token.className.includes("hljs-keyword")),
        asset.fileName,
      );
      if (language === "tsx") {
        assert.ok(
          lines.flat().some((token) => token.className.includes("hljs-attr")),
          asset.fileName,
        );
      }
    }
  }
});
