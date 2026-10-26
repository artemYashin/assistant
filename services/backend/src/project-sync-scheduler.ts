import type { Store, Context } from "./store.js";
import { syncAllowed } from "./sync-schedule.js";

/** Independent deadlines; a shared source is deduplicated by the sync pass. */
export class ProjectSyncScheduler {
  private next = new Map<string, number>();
  constructor(
    private store: Store,
    private clock = () => Date.now(),
  ) {}
  async run(sync: (contexts: Context[]) => Promise<unknown>) {
    const raw = this.store.rawSettings();
    const contexts = this.store.contexts().filter((c) => c.client && c.project);
    if (!contexts.length) contexts.push({ client: raw.client, project: raw.project });
    const due = contexts.filter((context) => {
      const key = JSON.stringify(context);
      if (!syncAllowed(this.store.settings(context).syncSchedule, new Date(this.clock()))) {
        this.next.delete(key);
        return false;
      }
      return this.clock() >= (this.next.get(key) || 0);
    });
    if (!due.length) return;
    try {
      await sync(due);
    } finally {
      for (const context of due)
        this.next.set(
          JSON.stringify(context),
          this.clock() + this.store.settings(context).syncSeconds * 1000,
        );
    }
  }
}
