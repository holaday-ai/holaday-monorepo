import { createHash } from 'node:crypto';
export function observeCutoverChild(child) {
  let buffer = Buffer.alloc(0),
    final,
    outputUnproven = false,
    protocolFrames = 0,
    stderrBytes = 0;
  const stderr = createHash('sha256');
  child.stderr.on('data', (b) => {
    stderrBytes += b.length;
    stderr.update(b);
  });
  child.stdout.on('data', (b) => {
    buffer = Buffer.concat([buffer, b]);
    for (;;) {
      const end = buffer.indexOf(10);
      if (end < 0) break;
      if (end > 256 * 1024) {
        outputUnproven = true;
        buffer = Buffer.alloc(0);
        return;
      }
      const line = buffer.subarray(0, end);
      buffer = buffer.subarray(end + 1);
      try {
        const v = JSON.parse(line);
        if (v.protocol === 1) protocolFrames++;
        else if (v.kind === 'first-cutover-execution-result') {
          if (final) outputUnproven = true;
          final = v;
        } else outputUnproven = true;
      } catch {
        outputUnproven = true;
      }
    }
    if (buffer.length > 256 * 1024) {
      outputUnproven = true;
      buffer = Buffer.alloc(0);
    }
  });
  const exited = new Promise((resolve) => {
    child.once('error', () => resolve({ code: null, signal: null, startError: true }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return {
    exited,
    summary: () => ({
      final,
      outputUnproven: outputUnproven || buffer.length !== 0,
      protocolFrames,
      stderrBytes,
      stderrDigest: stderr.digest('hex'),
    }),
  };
}
