import { ProjectSyncScheduler } from "./project-sync-scheduler.js";
import { Store } from "./store.js";
import { createApp } from "./app.js";
const store = new Store(process.env.DATA_DIR || "./data");
const { app, sync, agent, reviewAgent, pullRequests, codeBrowser } = createApp(store);
const server = app.listen(
  Number(process.env.PORT || 43871),
  process.env.BIND_HOST || "127.0.0.1",
  () => console.log(`Orbit: http://localhost:${process.env.PORT || 43871}`),
);
let stopped = false;
let syncWork: Promise<unknown> = Promise.resolve();
let reviewWork: Promise<unknown> = Promise.resolve();
let codeWork: Promise<unknown> = Promise.resolve();
let codeTimer: ReturnType<typeof setTimeout>;
async function codeTick() {
  if (stopped) return;
  codeWork = codeBrowser.syncDue();
  try {
    await codeWork;
  } catch {}
  if (!stopped) codeTimer = setTimeout(codeTick, 30000);
}
codeTimer = setTimeout(codeTick, 15000);
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
const scheduler = new ProjectSyncScheduler(store);
async function tick() {
  if (stopped) return;
  try {
    syncWork = scheduler.run(sync);
    await syncWork;
  } catch {}
  if (!stopped) timer = setTimeout(tick, 30000);
}
timer = setTimeout(tick, 10000);
function stop() {
  stopped = true;
  clearTimeout(timer);
  clearTimeout(reviewTimer);
  clearTimeout(codeTimer);
  pullRequests.shutdown();
  agent.stop();
  reviewAgent.stop();
  server.close(async () => {
    await Promise.allSettled([syncWork, reviewWork, codeWork]);
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
