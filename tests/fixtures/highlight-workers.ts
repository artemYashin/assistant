export const workers = [
  new Worker(new URL("../../src/diff-highlight.worker.ts", import.meta.url), {
    type: "module",
  }),
  new Worker(
    new URL("../../src/repository-highlight.worker.ts", import.meta.url),
    { type: "module" },
  ),
  new Worker(
    new URL("../../src/repository-search-highlight.worker.ts", import.meta.url),
    { type: "module" },
  ),
];
