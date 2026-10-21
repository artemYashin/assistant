// One serialized cache writer, with multiple observers for identical work.
// Credentials belong in the caller's hashed key, never in progress payloads.
export class QueueError extends Error {}
export class RepositoryJobs {
  constructor({ limit = 5, waitMs = 60000 } = {}) {
    this.limit = limit; this.waitMs = waitMs; this.jobs = [];
  }
  publish(job, event) {
    job.progress = { ...event, startedAt: job.startedAt };
    this.notify(job);
  }
  notify(job) {
    const event = { ...job.progress, queuePosition: this.jobs.indexOf(job), queueLength: this.jobs.length };
    for (const listener of job.listeners) { try { listener(event); } catch { /* A disconnected observer cannot fail a job. */ } }
  }
  positions() { for (const job of this.jobs) this.notify(job); }
  run(key, perform, report = () => {}, signal) {
    let job = this.jobs.find(job => job.key === key);
    if (!job) {
      if (this.jobs.length >= this.limit) return Promise.reject(new QueueError('Сервис занят. Повторите через несколько секунд.'));
      job = { key, perform, listeners: new Set(), startedAt: Date.now(), running: false, progress: { stage: 'queued', startedAt: Date.now() } };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      this.jobs.push(job);
      job.timer = setTimeout(() => {
        if (job.running) return;
        this.jobs.splice(this.jobs.indexOf(job), 1);
        job.reject(new QueueError('Очередь сервиса занята больше минуты. Дождитесь текущей загрузки и повторите запрос.'));
        this.positions();
      }, this.waitMs);
      queueMicrotask(() => this.start());
      this.positions();
    }
    if (!signal?.aborted) job.listeners.add(report);
    this.notify(job);
    const detach = () => job.listeners.delete(report);
    signal?.addEventListener('abort', detach, { once: true });
    return job.promise.finally(() => { detach(); signal?.removeEventListener('abort', detach); });
  }
  start() {
    const job = this.jobs[0];
    if (!job || job.running) return;
    job.running = true; clearTimeout(job.timer);
    this.publish(job, { stage: 'preparing' });
    Promise.resolve().then(() => job.perform(event => this.publish(job, event))).then(job.resolve, job.reject).finally(() => {
      this.jobs.shift();
      this.positions();
      this.start();
    });
  }
}
