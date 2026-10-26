export const workers = [
  new Worker(new URL("../../src/entities/repository/workers/diff-highlight.worker.ts", import.meta.url), {
    type: "module",
  }),
  new Worker(
    new URL("../../src/entities/repository/workers/repository-highlight.worker.ts", import.meta.url),
    { type: "module" },
  ),
  new Worker(
    new URL("../../src/entities/repository/workers/repository-search-highlight.worker.ts", import.meta.url),
    { type: "module" },
  ),
];
