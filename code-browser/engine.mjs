import { RepositoryJobs, QueueError, CancelledError } from './jobs.mjs';
import { recoverShallowLock } from './recovery.mjs';
import { gitDiagnostic } from './diagnostics.mjs';
import { gitProgressParser } from './progress.mjs';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const hash = s => createHash('sha256').update(s).digest('hex');
const FILE_LIMIT = 2 * 1024 * 1024;
const SNAPSHOT_LIMIT = 128 * 1024 * 1024;
export class BrowserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function safePath(value) {
  return typeof value === 'string' && !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') &&
    value.split('/').every(p => p && p !== '.' && p !== '..' && p.toLowerCase() !== '.git');
}
export function run(command, args, { signal: abortSignal, cwd, env, input, limit = 16 * 1024 * 1024, timeout = 30000, accept = [0], onProgress, timeoutMessage } = {}) {
  return new Promise((resolve, reject) => {
    if (abortSignal?.aborted) return reject(new CancelledError());
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let chunks = [], size = 0, stderr = '', failure, killTimer;
    const killGroup = signal => { try { process.kill(-child.pid, signal); } catch { child.kill(signal); } };
    const cancel = () => {
      failure = new CancelledError();
      killGroup('SIGTERM');
      killTimer = setTimeout(() => killGroup('SIGKILL'), 2000);
    };
    abortSignal?.addEventListener('abort', cancel, { once: true });
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); abortSignal?.removeEventListener('abort', cancel); };
    const stop = message => { failure = new BrowserError(message, 422); try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const timer = setTimeout(() => stop(timeoutMessage || 'Операция превысила время ожидания. Повторите позже.'), timeout);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > limit) stop('Результат слишком большой. Уточните запрос или выберите меньший репозиторий.');
      else chunks.push(chunk);
    });
    const parseProgress = onProgress ? gitProgressParser(onProgress) : null;
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16384); parseProgress?.(chunk); });
    child.on('error', () => { cleanup(); reject(new BrowserError('Git/ripgrep недоступен в сервисе просмотра кода.', 503)); });
    child.on('close', (code, signal) => {
      cleanup();
      if (failure) return reject(failure);
      if (!accept.includes(code)) {
        const operation = command === 'rg' ? 'rg' : args.find(arg => !arg.startsWith('--git-dir='));
        const message = gitDiagnostic(stderr, env, operation, code, signal);
        if (!(operation === 'merge-base' && code === 1)) console.error('[code-browser]', message);
        return reject(new BrowserError(message, /401|403|authentication failed|access denied/i.test(stderr) ? 403 : 502));
      }
      resolve(Buffer.concat(chunks));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
async function diskSize(root, signal) {
  if (signal?.aborted) throw new CancelledError();
  let total = 0;
  for (const item of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    const file = path.join(root, item.name);
    total += item.isDirectory() ? await diskSize(file, signal) : (await fs.lstat(file)).size;
  }
  return total;
}
export class RepositoryBrowser {
  constructor(root, { allowLocal = false, recoverLocks = false, fetchDepth = 1, maxCacheBytes = 20 * 1024 ** 3 } = {}) {
    if (!Number.isInteger(fetchDepth) || fetchDepth < 1 || fetchDepth > 1000) throw new Error('CODE_BROWSER_FETCH_DEPTH must be an integer from 1 to 1000');
    if (!Number.isSafeInteger(maxCacheBytes) || maxCacheBytes <= 0) throw new Error('CODE_BROWSER_MAX_CACHE_BYTES must be a positive safe integer');
    this.fetchDepth = fetchDepth;
    this.recoverLocks = recoverLocks; this.root = root; this.allowLocal = allowLocal; this.maxCacheBytes = maxCacheBytes;
    this.cancelledRequests = new Map(); this.jobs = new RepositoryJobs(); this.branchesCache = new Map();
  }
  async execute(input, report = () => {}, signal) {
    // Reopening the page must get its branch selector without waiting behind its
    // own fetch. During that fetch the last known catalog remains sufficient.
    const identity = hash(JSON.stringify([input.url, input.token]));
    for (const [id, expires] of this.cancelledRequests) if (expires < Date.now()) this.cancelledRequests.delete(id);
    if (input.operation === 'cancel') {
      for (const id of input.cancelledRequestIds || []) this.cancelledRequests.set(id, Date.now() + 10 * 60000);
      const cancelled = await this.jobs.cancel(job => job.scope === identity && (job.branch === (input.branch || '') || job.operation === 'branches'));
      return { cancelled };
    }
    if (input.requestId && this.cancelledRequests.has(input.requestId)) throw new BrowserError('Операция Git отменена.', 409);
    const branchKey = hash(input.url + input.token);
    const catalog = this.branchesCache.get(branchKey);
    if (input.operation === 'branches' && !input.refresh && catalog) return catalog.result;
    const keyFor = operation => identity + ':' + hash(JSON.stringify({
      operation, branch: input.branch || '', path: input.path || '', query: input.query || '',
      mode: input.mode || 'name', offset: input.offset || 0, revision: input.revision || '',
      refresh: operation === 'branches' ? !!input.refresh : false,
    }));
    let key = keyFor(input.operation);
    if (input.operation === 'status') {
      // A Pull already returns the status of the updated snapshot.
      const pull = this.jobs.jobs.find(job => job.key === keyFor('pull'));
      const status = this.jobs.jobs.find(job => job.key === keyFor('status'));
      key = pull?.key || status?.key || key;
    }
    try { return await this.jobs.run(key, (progress, jobSignal) => this.perform(input, progress, jobSignal), report, signal, { scope: identity, branch: input.branch || '', operation: input.operation }); }
    catch (error) { if (error instanceof CancelledError) throw new BrowserError(error.message, 409); if (error instanceof QueueError) throw new BrowserError(error.message, 429); throw error; }
  }
  async perform(input, report, signal) {
    const checkCancelled = () => { if (signal?.aborted) throw new CancelledError(); };
    checkCancelled();
    report({ stage: "preparing" });
    const fetchTimeoutSeconds = input.fetchTimeoutSeconds ?? 300;
    if (!Number.isInteger(fetchTimeoutSeconds) || fetchTimeoutSeconds < 60 || fetchTimeoutSeconds > 1800) throw new BrowserError('Тайм-аут Git должен быть от 60 до 1800 секунд');
    const networkOptions = { timeout: fetchTimeoutSeconds * 1000, timeoutMessage: `Git не успел загрузить данные за ${fetchTimeoutSeconds / 60} мин. Увеличьте тайм-аут в «Заказчики и проекты → Репозиторий» и повторите запрос. Локальная версия не обновлена.` };
    const { url, token, operation, branch = '', path: filePath = '', query = '', mode = 'name', offset = 0 } = input;
    if (input.localOnly && (input.refresh || !['branches', 'status', 'tree', 'file', 'search'].includes(operation))) throw new BrowserError('Разрешено только чтение локального снимка', 403);
    if (!['branches', 'status', 'pull', 'tree', 'file', 'search'].includes(operation)) throw new BrowserError('Неизвестная операция');
    if (typeof url !== 'string' || url.length > 2000 || typeof filePath !== 'string' || filePath.length > 4096 ||
      (input.revision !== undefined && (typeof input.revision !== 'string' || !/^[0-9a-f]{40,64}$/.test(input.revision)))) throw new BrowserError('Некорректный запрос');
    let remote; try { remote = new URL(url); } catch { throw new BrowserError('Некорректный URL'); }
    if (!(remote.protocol === 'https:' || (this.allowLocal && remote.protocol === 'file:')) || remote.username || remote.password || remote.search || remote.hash) throw new BrowserError('Разрешён только HTTPS URL репозитория без credentials');
    if (typeof token !== 'string' || token.length > 2000 || /[\r\n\0]/.test(token)) throw new BrowserError('Некорректный токен');
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || typeof query !== 'string' || query.length > 200 || /[\r\n\0]/.test(query)) throw new BrowserError('Некорректный поиск');
    if (filePath && !safePath(filePath)) throw new BrowserError('Некорректный путь');
    const repo = path.join(this.root, hash(url));
    const gitDir = path.join(repo, 'git');
    await fs.mkdir(repo, { recursive: true });
    const env = { PATH: process.env.PATH, HOME: '/nonexistent', LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '6',
      GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(':' + token).toString('base64')}`,
      GIT_CONFIG_KEY_1: 'http.followRedirects', GIT_CONFIG_VALUE_1: 'false',
      GIT_CONFIG_KEY_2: 'credential.helper', GIT_CONFIG_VALUE_2: '',
      GIT_CONFIG_KEY_3: 'core.hooksPath', GIT_CONFIG_VALUE_3: '/dev/null',
      GIT_CONFIG_KEY_4: 'protocol.allow', GIT_CONFIG_VALUE_4: 'never',
      GIT_CONFIG_KEY_5: `protocol.${this.allowLocal && remote.protocol === 'file:' ? 'file' : 'https'}.allow`, GIT_CONFIG_VALUE_5: 'always' };
    const git = (args, options = {}) => run('git', ['--git-dir=' + gitDir, ...args], { env, signal, ...options });
    if (input.localOnly && !await fs.stat(gitDir).catch(() => null)) throw new BrowserError('Локальный репозиторий ещё не загружен. Откройте страницу кода.', 409);
    if (!await fs.stat(gitDir).catch(() => null)) await run('git', ['init', '--bare', gitDir], { env, signal });
    if (operation === 'branches') {
      const key = hash(url + token); const cached = this.branchesCache.get(key);
      const catalogPath = path.join(repo, 'branches-' + hash(token) + '.json');
      if (!input.refresh) {
        if (cached) return cached.result;
        const saved = await fs.readFile(catalogPath, 'utf8').then(JSON.parse).catch(() => null);
        if (saved && Array.isArray(saved.branches) && saved.branches.every(b => typeof b === 'string') && typeof saved.defaultBranch === 'string') {
          this.branchesCache.set(key, { time: Date.now(), result: saved });
          return saved;
        }
      }
      if (input.localOnly) throw new BrowserError('Нет локального списка веток. Откройте страницу кода.', 409);
      report({ stage: 'connecting' });
      const output = (await git(['ls-remote', '--symref', url, 'HEAD', 'refs/heads/*'], networkOptions)).toString();
      const branches = output.split('\n').flatMap(line => /^[0-9a-f]{40,64}\trefs\/heads\//.test(line) ? [line.split('\t')[1].slice(11)] : []).sort();
      const result = { branches: branches.slice(0, 5000), more: branches.length > 5000, defaultBranch: /^ref: refs\/heads\/(.+)\tHEAD$/m.exec(output)?.[1] || branches[0] || '', checkedAt: new Date().toISOString() };
      checkCancelled();
      const temporaryCatalog = catalogPath + '.' + randomUUID() + '.tmp';
      await fs.writeFile(temporaryCatalog, JSON.stringify(result));
      await fs.rename(temporaryCatalog, catalogPath);
      this.branchesCache.set(key, { time: Date.now(), result });
      if (this.branchesCache.size > 30) this.branchesCache.delete(this.branchesCache.keys().next().value);
      return result;
    }
    if (typeof branch !== 'string' || !branch || branch.length > 500 || branch.startsWith('-') || /[\r\n\0]/.test(branch)) throw new BrowserError('Выберите ветку');
    await git(['check-ref-format', 'refs/heads/' + branch]);
    const branchKey = hash(branch), stateFile = path.join(repo, branchKey + '.json');
    let state = await fs.readFile(stateFile, 'utf8').then(JSON.parse).catch(() => null);
    if (input.localOnly && !state) throw new BrowserError('Ветка ещё не загружена локально. Откройте её на странице кода.', 409);
    const remoteRef = 'refs/orbit/remote/' + branchKey;
    if (!state || operation === 'pull' || (operation === 'status' && input.refresh)) {
      const quotaMessage = size => `Кеш кода занимает ${(size / 1024 ** 3).toFixed(2)} GiB при лимите ${(this.maxCacheBytes / 1024 ** 3).toFixed(2)} GiB. Скачанные данные сохранены. Увеличьте CODE_BROWSER_MAX_CACHE_BYTES в .env и пересоздайте сервис code-browser, затем повторите загрузку.`;
      const before = await diskSize(this.root, signal);
      if (before >= this.maxCacheBytes) throw new BrowserError(quotaMessage(before), 507);
      if (this.recoverLocks) {
        try { await recoverShallowLock(gitDir, { report }); }
        catch (error) { throw new BrowserError(error.message, 409); }
      }
      report({ stage: 'fetching' });
      await git(['fetch', '--progress', '--no-tags', '--no-recurse-submodules', '--depth=' + this.fetchDepth, url, '+refs/heads/' + branch + ':' + remoteRef], { ...networkOptions, onProgress: report });
      const after = await diskSize(this.root, signal);
      if (after > this.maxCacheBytes) throw new BrowserError(quotaMessage(after), 507);
      report({ stage: 'finalizing' });
      const remoteSha = (await git(['rev-parse', remoteRef])).toString().trim();
      const sha = operation === 'pull' || !state ? remoteSha : state.sha;
      // Keep the displayed snapshot reachable even after fetching new commits.
      await git(['update-ref', 'refs/orbit/cached/' + branchKey, sha]);
      state = { sha, remoteSha, checkedAt: new Date().toISOString(), branch };
      checkCancelled();
      const tmp = stateFile + '.tmp'; await fs.writeFile(tmp, JSON.stringify(state)); await fs.rename(tmp, stateFile);
    }
    if (operation === 'status' || operation === 'pull') {
      let behind = state.sha === state.remoteSha ? 0 : null;
      if (behind === null) {
        try {
          await git(['merge-base', '--is-ancestor', state.sha, state.remoteSha]);
          behind = Number((await git(['rev-list', '--count', state.sha + '..' + state.remoteSha])).toString().trim());
        } catch { checkCancelled(); /* Shallow or rewritten history: never invent a count. */ }
      }
      return { ...state, behind, current: state.sha === state.remoteSha };
    }
    if (input.revision && input.revision !== state.sha) throw new BrowserError('Снимок обновился в другом окне. Нажмите «Проверить обновления».', 409);
    report({ stage: 'tree' });
    const manifest = (await git(['ls-tree', '-rzl', state.sha])).toString('utf8').split('\0').filter(Boolean).map(line => {
      const match = /^(\d+) (\w+) ([0-9a-f]+) +([\d-]+)\t([\s\S]+)$/.exec(line);
      if (!match) throw new BrowserError('Не удалось прочитать дерево Git', 502);
      return { mode: match[1], type: match[2], oid: match[3], size: Number(match[4]) || 0, path: match[5] };
    });
    if (operation === 'tree') {
      const prefix = filePath ? filePath + '/' : ''; const entries = new Map();
      for (const file of manifest) {
        if (!file.path.startsWith(prefix)) continue;
        const rest = file.path.slice(prefix.length), name = rest.split('/')[0];
        const directory = rest.includes('/');
        entries.set(name, { name, path: prefix + name, type: directory ? 'directory' : file.mode === '120000' ? 'symlink' : file.type === 'commit' ? 'submodule' : 'file', size: directory ? 0 : file.size });
      }
      const sorted = [...entries.values()].sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name));
      return { sha: state.sha, entries: sorted.slice(offset, offset + 200), more: sorted.length > offset + 200, total: sorted.length };
    }
    if (operation === 'file') {
      report({ stage: 'file' });
      const file = manifest.find(file => file.path === filePath);
      if (!file) throw new BrowserError('Файл не найден в выбранном снимке', 404);
      if (file.type !== 'blob') return { sha: state.sha, path: filePath, unavailable: 'Это подмодуль; его содержимое автоматически не загружается.' };
      if (file.size > FILE_LIMIT) return { sha: state.sha, path: filePath, size: file.size, unavailable: 'Файл больше 2 MiB. Предпросмотр отключён.' };
      const bytes = await git(['cat-file', 'blob', file.oid], { limit: FILE_LIMIT });
      let text;
      try { if (bytes.includes(0)) throw Error(); text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { return { sha: state.sha, path: filePath, size: file.size, unavailable: 'Бинарный файл или текст не в UTF-8.' }; }
      return { sha: state.sha, path: filePath, size: file.size, text, symlink: file.mode === '120000', lfs: text.startsWith('version https://git-lfs.github.com/spec/v1') };
    }
    if (!query.trim()) throw new BrowserError('Введите поисковый запрос');
    if (mode === 'name') {
      report({ stage: 'searching' });
      const found = manifest.filter(file => file.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      return { sha: state.sha, results: found.slice(offset, offset + 200).map(file => ({ path: file.path })), more: found.length > offset + 200, total: found.length };
    }
    if (mode !== 'content') throw new BrowserError('Неизвестный режим поиска');
    const snapshots = path.join(repo, 'snapshots'), snapshot = path.join(snapshots, state.sha);
    let coverage = await fs.readFile(path.join(snapshot, 'coverage.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (!coverage) {
      report({ stage: 'snapshot' });
      await fs.mkdir(snapshots, { recursive: true });
      const tmp = path.join(snapshots, 'tmp-' + randomUUID()), content = path.join(tmp, 'files');
      await fs.mkdir(content, { recursive: true });
      try {
        let total = 0; const selected = [];
        for (const file of manifest) {
          if (!/^100(644|755)$/.test(file.mode) || !safePath(file.path) || file.size > FILE_LIMIT || selected.length >= 20000 || total + file.size > SNAPSHOT_LIMIT) continue;
          selected.push(file); total += file.size;
        }
        if (await diskSize(this.root, signal) + total > this.maxCacheBytes) throw new BrowserError('Недостаточно места в лимите кеша для поискового снимка.', 507);
        const blobs = await git(['cat-file', '--batch'], { input: selected.map(f => f.oid).join('\n') + '\n', limit: SNAPSHOT_LIMIT + 4 * 1024 * 1024, timeout: 60000 });
        let cursor = 0, included = 0, processed = 0;
        for (const file of selected) {
          checkCancelled();
          processed++;
          if (processed === 1 || processed % 50 === 0 || processed === selected.length) report({ stage: 'snapshot', percent: Math.floor((processed - 1) / selected.length * 100) });
          const end = blobs.indexOf(10, cursor); const header = blobs.subarray(cursor, end).toString().split(' ');
          if (end < 0 || header[0] !== file.oid || header[1] !== 'blob' || Number(header[2]) !== file.size) throw new BrowserError('Неполный снимок Git', 502);
          const bytes = blobs.subarray(end + 1, end + 1 + file.size); cursor = end + file.size + 2;
          try { if (bytes.includes(0)) continue; new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { continue; }
          const dest = path.join(content, file.path);
          await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.writeFile(dest, bytes); included++;
        }
        report({ stage: 'snapshot', percent: 100 });
        coverage = { totalFiles: manifest.length, searchedFiles: included, skippedFiles: manifest.length - included };
        await fs.writeFile(path.join(tmp, 'coverage.json'), JSON.stringify(coverage)); await fs.rename(tmp, snapshot);
        const old = await Promise.all((await fs.readdir(snapshots)).filter(s => s !== state.sha).map(async name => ({ name, time: (await fs.stat(path.join(snapshots, name))).mtimeMs })));
        old.sort((a, b) => b.time - a.time);
        for (const item of old.slice(1)) await fs.rm(path.join(snapshots, item.name), { recursive: true, force: true });
      } catch (error) { await fs.rm(tmp, { recursive: true, force: true }); throw error; }
    }
    report({ stage: 'searching' });
    const output = await run('rg', ['--json', '--hidden', '--no-ignore', '--fixed-strings', '--ignore-case', '--max-count', '20', '--', query, '.'], { signal, cwd: path.join(snapshot, 'files'), env: { PATH: process.env.PATH, LANG: 'C.UTF-8' }, accept: [0, 1], limit: 8 * 1024 * 1024 });
    const matches = output.toString().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(item => item.type === 'match');
    const results = [];
    let previousPath, lines;
    for (const { data } of matches.slice(offset, offset + 200)) {
      checkCancelled();
      const filePath = data.path.text.replace(/^\.\//, '');
      if (!safePath(filePath)) continue;
      if (previousPath !== filePath) {
        lines = (await fs.readFile(path.join(snapshot, 'files', filePath), 'utf8')).split(/\r?\n/);
        previousPath = filePath;
      }
      const start = Math.max(0, data.line_number - 3);
      results.push({ path: filePath, line: data.line_number, text: data.lines.text.slice(0, 500).trimEnd(),
        context: lines.slice(start, data.line_number + 2).map((text, index) => ({ number: start + index + 1, text: text.slice(0, 500) })) });
    }
    return { sha: state.sha, results, more: matches.length > offset + 200, total: matches.length, coverage, perFileLimit: 20 };
  }
}
