import { promises as fs } from 'node:fs';
import path from 'node:path';

// Called only in the serialized queue of the service holding the cache-wide flock.
// Never infer staleness from age: even a very old lock may belong to a live fetch.
export async function recoverShallowLock(gitDir, { procRoot = '/proc', report = () => {} } = {}) {
  const lock = path.join(gitDir, 'shallow.lock');
  let original;
  try { original = await fs.lstat(lock); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!original.isFile()) throw new Error('Блокировка Git имеет неожиданный тип; автоматическое восстановление отменено.');
  try {
    for (const pid of (await fs.readdir(procRoot)).filter(name => /^\d+$/.test(name))) {
      let name;
      try { name = (await fs.readFile(path.join(procRoot, pid, 'comm'), 'utf8')).trim(); }
      catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') continue; throw error; }
      if (/^git(?:$|-)/.test(name)) throw new Error('Git ещё работает. Дождитесь завершения загрузки и повторите запрос; блокировка сохранена.');
    }
  } catch (error) {
    throw new Error(error.message.startsWith('Git ещё') ? error.message : 'Не удалось проверить работающие процессы Git. Блокировка сохранена; повторите запрос позже.');
  }
  const current = await fs.lstat(lock);
  if (current.ino !== original.ino || current.dev !== original.dev || current.mtimeMs !== original.mtimeMs || current.size !== original.size) {
    throw new Error('Блокировка Git изменилась во время проверки. Повторите запрос позже.');
  }
  report({ stage: 'recovering' });
  await fs.unlink(lock);
  console.info('[code-browser] Removed abandoned shallow.lock under exclusive cache ownership');
  return true;
}
