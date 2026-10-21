import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { RepositoryBrowser, BrowserError } from './engine.mjs';
const browser = new RepositoryBrowser(process.env.CODE_BROWSER_CACHE || '/cache', {
  recoverLocks: process.env.CODE_BROWSER_EXCLUSIVE_CACHE === '1',
  maxCacheBytes: Number(process.env.CODE_BROWSER_MAX_CACHE_BYTES ?? 20 * 1024 ** 3),
  fetchDepth: Number(process.env.CODE_BROWSER_FETCH_DEPTH ?? 1),
});
const server = createServer(async (req, res) => {
  const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
  let streaming = false;
  const event = data => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(data) + '\n'); };
  try {
    const key = (await readFile(process.env.CODE_BROWSER_KEY_FILE || '/control/key', 'utf8')).trim();
    const expected = Buffer.from('Bearer ' + key), actual = Buffer.from(req.headers.authorization || '');
    if (key.length < 32 || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return send(401, { error: 'Unauthorized' });
    if (req.method !== 'POST' || req.url !== '/v1/repository') return send(404, { error: 'Not found' });
    const chunks = []; let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length; chunks.push(chunk);
      if (bytes > 16000) throw new BrowserError('Запрос слишком большой', 413);
    }
    let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new BrowserError('Некорректный JSON'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BrowserError('Некорректный запрос');
    streaming = req.headers.accept === 'application/x-ndjson';
    if (streaming) {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
    }
    let lastTime = 0, lastStage = '', lastQueue = '';
    const report = progress => {
      if (!streaming) return;
      const now = Date.now();
      const queue = `${progress.queuePosition}:${progress.queueLength}`;
      if (progress.stage !== lastStage || queue !== lastQueue || now - lastTime >= 150 || progress.percent === 100) {
        lastTime = now; lastStage = progress.stage; lastQueue = queue;
        event({ type: 'progress', progress });
      }
    };
    const disconnected = new AbortController();
    const detach = () => disconnected.abort();
    res.once('close', detach);
    let result;
    try { result = await browser.execute(input, report, disconnected.signal); }
    finally { res.off('close', detach); }
    if (streaming) { event({ type: 'result', data: result }); res.end(); }
    else send(200, result);
  } catch (error) {
    const message = error instanceof BrowserError ? error.message : 'Сервис просмотра кода недоступен. Проверьте его конфигурацию.';
    if (streaming) { event({ type: 'error', error: message }); res.end(); }
    else send(error instanceof BrowserError ? error.status : 503, { error: message });
  }
});
server.requestTimeout = 35 * 60 * 1000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT) || 8010, '0.0.0.0');
