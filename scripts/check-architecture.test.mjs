import test from "node:test";
import assert from "node:assert/strict";
import { architectureErrors, imports } from "./check-architecture.mjs";
const policy = { legacyFiles: [], exceptions: [] };
test("public downward dependencies and internal relative imports are allowed", () => {
  assert.deepEqual(
    architectureErrors(
      {
        "services/frontend/src/pages/tickets/index.ts": 'export * from "./ui/Page.js";',
        "services/frontend/src/pages/tickets/ui/Page.tsx":
          'import { Ticket } from "../../../entities/ticket/index.js";',
        "services/frontend/src/entities/ticket/index.ts": "export const Ticket = 1;",
      },
      policy,
    ),
    [],
  );
});
test("upward and cross-slice dependencies are rejected", () => {
  assert.match(
    architectureErrors(
      {
        "services/frontend/src/entities/ticket/index.ts": 'import "../../features/edit/index.js";',
      },
      policy,
    ).join(),
    /upward/,
  );
  assert.match(
    architectureErrors(
      { "services/frontend/src/features/edit/index.ts": 'import "../delete/index.js";' },
      policy,
    ).join(),
    /cross-slice/,
  );
});
test("deep imports are rejected even from legacy consumers", () => {
  assert.match(
    architectureErrors(
      { "services/frontend/src/Old.ts": 'import "./entities/ticket/model/value.js";' },
      { ...policy, legacyFiles: ["services/frontend/src/Old.ts"] },
    ).join(),
    /public index/,
  );
});
test("new root modules and legacy dependencies need explicit migration", () => {
  assert.match(
    architectureErrors({ "services/frontend/src/New.ts": "export {};" }, policy).join(),
    /new code/,
  );
  const files = { "services/frontend/src/features/edit/index.ts": 'import "../../api.js";' };
  assert.match(architectureErrors(files, policy).join(), /legacy/);
  assert.deepEqual(
    architectureErrors(files, {
      ...policy,
      exceptions: ["services/frontend/src/features/edit/index.ts -> services/frontend/src/api.js"],
    }),
    [],
  );
});
test("shared components may compose other shared public APIs, not domain entities", () => {
  assert.deepEqual(
    architectureErrors(
      {
        "services/frontend/src/shared/ui/select/index.ts": 'import "../avatar/index.js";',
        "services/frontend/src/shared/ui/avatar/index.ts": "export {};",
      },
      policy,
    ),
    [],
  );
  assert.match(
    architectureErrors(
      {
        "services/frontend/src/shared/ui/select/index.ts":
          'import "../../../entities/ticket/index.js";',
      },
      policy,
    ).join(),
    /upward/,
  );
});
test("scanner includes dynamic imports, type imports, reexports and worker URLs", () => {
  assert.deepEqual(
    imports(
      "file.ts",
      'export * from "./a.js"; import("./b.js"); type X = import("./c.js").X; new Worker(new URL("./d.ts", import.meta.url)); require("./e.js");',
    ),
    ["./a.js", "./b.js", "./c.js", "./d.ts", "./e.js"],
  );
});
test("bootstrap only enters through app public API", () => {
  assert.deepEqual(
    architectureErrors(
      {
        "services/frontend/src/main.tsx": 'import "./app/index.js";',
        "services/frontend/src/app/index.ts": "export {};",
      },
      policy,
    ),
    [],
  );
  assert.match(
    architectureErrors({ "services/frontend/src/main.tsx": 'import "./Old.js";' }, policy).join(),
    /bootstrap/,
  );
});
