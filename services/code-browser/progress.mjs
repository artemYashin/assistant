// Parse only known numeric Git progress. Never expose stderr, URLs or credentials.
export function gitProgressParser(report) {
  let pending = "";
  const stages = {
    "Counting objects": "counting",
    "Compressing objects": "compressing",
    "Receiving objects": "receiving",
    "Resolving deltas": "resolving",
    "Unpacking objects": "unpacking",
  };
  return (chunk) => {
    pending += chunk.toString("utf8");
    const lines = pending.split(/[\r\n]/);
    pending = lines.pop().slice(-4096);
    for (const line of lines) {
      const match =
        /^(?:remote: )?(Counting objects|Compressing objects|Receiving objects|Resolving deltas|Unpacking objects):\s+(\d{1,3})%/.exec(
          line,
        );
      if (!match || Number(match[2]) > 100) continue;
      const event = { stage: stages[match[1]], percent: Number(match[2]) };
      if (event.stage === "receiving") {
        const counts = /\((\d+)\/(\d+)\)/.exec(line);
        if (
          counts &&
          Number.isSafeInteger(Number(counts[2])) &&
          Number(counts[1]) <= Number(counts[2])
        ) {
          event.receivedObjects = Number(counts[1]);
          event.totalObjects = Number(counts[2]);
        }
        const bytes =
          /,\s*([\d.]+)\s+(bytes|KiB|MiB|GiB|TiB)(?:\s*\|\s*([\d.]+)\s+(bytes|KiB|MiB|GiB|TiB)\/s)?/.exec(
            line,
          );
        const units = { bytes: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 };
        if (bytes) {
          const size = Math.round(Number(bytes[1]) * units[bytes[2]]);
          const speed =
            bytes[3] === undefined ? undefined : Math.round(Number(bytes[3]) * units[bytes[4]]);
          if (Number.isSafeInteger(size) && size >= 0) event.receivedBytes = size;
          if (Number.isSafeInteger(speed) && speed >= 0) event.bytesPerSecond = speed;
        }
      }
      report(event);
    }
  };
}
