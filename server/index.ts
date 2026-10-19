import { Store } from "./store.js";
import { createApp } from "./app.js";
const store = new Store(process.env.DATA_DIR || "./data");
const { app, sync } = createApp(store);
const server = app.listen(
  Number(process.env.PORT || 3000),
  process.env.BIND_HOST || "127.0.0.1",
  () => console.log(`Orbit: http://localhost:${process.env.PORT || 3000}`),
);
let stopped = false;
let timer: ReturnType<typeof setTimeout>;
async function tick() {
  if (stopped) return;
  try {
    await sync();
  } catch {}
  if (!stopped) timer = setTimeout(tick, store.settings().syncSeconds * 1000);
}
timer = setTimeout(tick, 10000);
function stop() {
  stopped = true;
  clearTimeout(timer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
