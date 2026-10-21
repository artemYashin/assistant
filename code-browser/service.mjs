import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { RepositoryBrowser, BrowserError } from './engine.mjs';
const browser = new RepositoryBrowser(process.env.CODE_BROWSER_CACHE || '/cache', {
  maxCacheBytes: Number(process.env.CODE_BROWSER_MAX_CACHE_BYTES) || 2 * 1024 ** 3,
});
const server = createServer(async (req, res) => {
  const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
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
    send(200, await browser.execute(input));
  } catch (error) {
    send(error instanceof BrowserError ? error.status : 503, { error: error instanceof BrowserError ? error.message : 'Сервис просмотра кода недоступен. Проверьте его конфигурацию.' });
  }
});
server.requestTimeout = 150000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT) || 8010, '0.0.0.0');
