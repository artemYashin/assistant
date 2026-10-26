import test from "node:test";
import assert from "node:assert/strict";
import { architectureErrors, imports } from "./check-architecture.mjs";
const policy = { legacyFiles: [], exceptions: [] };
test("public downward dependencies and internal relative imports are allowed", () => {
  assert.deepEqual(architectureErrors({
    "src/pages/tickets/index.ts": 'export * from "./ui/Page.js";',
    "src/pages/tickets/ui/Page.tsx": 'import { Ticket } from "../../../entities/ticket/index.js";',
    "src/entities/ticket/index.ts": 'export const Ticket = 1;',
  }, policy), []);
});
test("upward and cross-slice dependencies are rejected", () => {
  assert.match(architectureErrors({ "src/entities/ticket/index.ts": 'import "../../features/edit/index.js";' }, policy).join(), /upward/);
  assert.match(architectureErrors({ "src/features/edit/index.ts": 'import "../delete/index.js";' }, policy).join(), /cross-slice/);
});
test("deep imports are rejected even from legacy consumers", () => {
  assert.match(architectureErrors({ "src/Old.ts": 'import "./entities/ticket/model/value.js";' }, { ...policy, legacyFiles: ["src/Old.ts"] }).join(), /public index/);
});
test("new root modules and legacy dependencies need explicit migration", () => {
  assert.match(architectureErrors({ "src/New.ts": "export {};" }, policy).join(), /new code/);
  const files = { "src/features/edit/index.ts": 'import "../../api.js";' };
  assert.match(architectureErrors(files, policy).join(), /legacy/);
  assert.deepEqual(architectureErrors(files, { ...policy, exceptions: ["src/features/edit/index.ts -> src/api.js"] }), []);
});
test("shared components may compose other shared public APIs, not domain entities", () => {
  assert.deepEqual(architectureErrors({ "src/shared/ui/select/index.ts": 'import "../avatar/index.js";', "src/shared/ui/avatar/index.ts": "export {};" }, policy), []);
  assert.match(architectureErrors({ "src/shared/ui/select/index.ts": 'import "../../../entities/ticket/index.js";' }, policy).join(), /upward/);
});
test("scanner includes dynamic imports, type imports, reexports and worker URLs", () => {
  assert.deepEqual(imports("file.ts", 'export * from "./a.js"; import("./b.js"); type X = import("./c.js").X; new Worker(new URL("./d.ts", import.meta.url)); require("./e.js");'), ["./a.js", "./b.js", "./c.js", "./d.ts", "./e.js"]);
});
test("bootstrap only enters through app public API", () => {
  assert.deepEqual(architectureErrors({ "src/main.tsx": 'import "./app/index.js";', "src/app/index.ts": "export {};" }, policy), []);
  assert.match(architectureErrors({ "src/main.tsx": 'import "./Old.js";' }, policy).join(), /bootstrap/);
});
