/** Offline evidence validation only. This command never opens a browser or calls a model. */
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { summarizeProductionSuite } from './production-score.js';
const taskSchema = z.object({
  id: z.string(),
  scope: z.enum(['public', 'fixture']),
  requiredActions: z.array(z.string()),
  expectedText: z.array(z.string()).optional(),
  expectedFields: z.record(z.string()).optional(),
  actionCounts: z.record(z.number().int().positive()).optional(),
  receipt: z.object({ minBytes: z.number().positive() }).optional(),
  blocker: z.string().optional(),
  nonEmptyFields: z.array(z.string()).optional(),
});
const evidenceSchema = z.object({
  id: z.string(),
  status: z.enum(['completed', 'awaiting_user', 'failed']),
  answer: z.string(),
  observedText: z.string(),
  actions: z.array(z.string()),
  screenshot: z.string(),
  elapsedMs: z.number().finite().nonnegative(),
  fields: z.record(z.string()).optional(),
  blocker: z.string().optional(),
  receipt: z
    .object({
      bytes: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      file: z.string(),
    })
    .optional(),
});
const [suitePath, evidencePath, outPath, group = 'extended'] = process.argv.slice(2);
if (!suitePath || !evidencePath || !outPath || !['core', 'extended'].includes(group))
  throw new Error('Usage: tsx production-report.ts SUITE RESULTS OUTPUT [core|extended]');
const suiteBytes = await readFile(suitePath);
const suite = z
  .object({ core: z.array(taskSchema), extended: z.array(taskSchema) })
  .parse(JSON.parse(suiteBytes.toString()));
const evidenceBytes = await readFile(evidencePath);
const rows = z.array(evidenceSchema).parse(JSON.parse(evidenceBytes.toString()));
const tasks = group === 'core' ? suite.core : suite.extended;
for (const entries of [tasks, rows])
  if (new Set(entries.map((e) => e.id)).size !== entries.length)
    throw new Error('Duplicate case id');
if (rows.some((r) => !tasks.some((t) => t.id === r.id))) throw new Error('Unknown evidence case');
const root = await realpath(path.dirname(evidencePath));
const hashes: Record<string, string> = {};
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function asset(name: string) {
  const resolved = await realpath(path.resolve(root, name));
  if (!resolved.startsWith(root + path.sep)) throw new Error('Evidence path escapes bundle');
  const bytes = await readFile(resolved);
  hashes[name] = digest(bytes);
  return bytes;
}
for (const row of rows) {
  const png = await asset(row.screenshot);
  if (
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    !png.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
  )
    throw new Error(`Invalid screenshot: ${row.id}`);
  if (row.receipt) {
    const file = await asset(row.receipt.file);
    if (file.length !== row.receipt.bytes || digest(file) !== row.receipt.sha256)
      throw new Error(`Receipt mismatch: ${row.id}`);
  }
}
const report = {
  ...summarizeProductionSuite(tasks, rows),
  group,
  suiteSha256: digest(suiteBytes),
  resultsSha256: digest(evidenceBytes),
  assets: hashes,
  generatedAt: new Date().toISOString(),
};
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, assets: `${Object.keys(hashes).length} verified files` }));
// Output is a measured result, not an assertion that a release gate passed.
