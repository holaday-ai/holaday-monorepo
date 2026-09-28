import { runFirstCutoverRecoveryTool } from './browser-first-cutover-recovery-runtime.mjs';

// Bundled only into the reviewed, copied recovery tool tree. Not a host CLI:
// its fixed root and socket refer to the dedicated network-none MySQL target.
try {
  if (process.argv.length !== 2) throw new Error('arguments');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error('input');
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks);
  if (!Buffer.from(input.toString('utf8')).equals(input)) throw new Error('encoding');
  const result = await runFirstCutoverRecoveryTool(JSON.parse(input.toString('utf8')));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write('CUTOVER_RECOVERY_TOOL_UNPROVEN\n');
  process.exitCode = 1;
}
