// Parse only known numeric Git progress. Never expose stderr, URLs or credentials.
export function gitProgressParser(report) {
  let pending = '';
  const stages = { 'Counting objects': 'counting', 'Compressing objects': 'compressing', 'Receiving objects': 'receiving', 'Resolving deltas': 'resolving', 'Unpacking objects': 'unpacking' };
  return chunk => {
    pending += chunk.toString('utf8');
    const lines = pending.split(/[\r\n]/);
    pending = lines.pop().slice(-4096);
    for (const line of lines) {
      const match = /^(?:remote: )?(Counting objects|Compressing objects|Receiving objects|Resolving deltas|Unpacking objects):\s+(\d{1,3})%/.exec(line);
      if (match && Number(match[2]) <= 100) report({ stage: stages[match[1]], percent: Number(match[2]) });
    }
  };
}
