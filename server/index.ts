import { Store } from "./store.js";
import { createApp } from "./app.js";
const store = new Store(process.env.DATA_DIR || "./data");
const { app, sync, agent, pullRequests } = createApp(store);
const server = app.listen(
  Number(process.env.PORT || 3000),
  process.env.BIND_HOST || "127.0.0.1",
  () => console.log(`Orbit: http://localhost:${process.env.PORT || 3000}`),
);
let stopped = false;
let syncWork: Promise<unknown> = Promise.resolve();
let reviewWork: Promise<unknown> = Promise.resolve();
let reviewTimer: ReturnType<typeof setTimeout>;
async function reviewTick() {
  if (stopped) return;
  reviewWork = pullRequests.reviewNext();
  try {
    await reviewWork;
  } catch {}
  if (!stopped) reviewTimer = setTimeout(reviewTick, 2000);
}
reviewTimer = setTimeout(reviewTick, 2000);
let timer: ReturnType<typeof setTimeout>;
async function tick() {
  if (stopped) return;
  try {
    syncWork = sync();
    await syncWork;
  } catch {}
  if (!stopped) timer = setTimeout(tick, store.settings().syncSeconds * 1000);
}
timer = setTimeout(tick, 10000);
function stop() {
  stopped = true;
  clearTimeout(timer);
  clearTimeout(reviewTimer);
  pullRequests.shutdown();
  agent.stop();
  server.close(async () => {
    await Promise.allSettled([syncWork, reviewWork]);
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
