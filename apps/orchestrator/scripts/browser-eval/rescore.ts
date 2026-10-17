/**
 * Re-applies the current classifyFailure to an eval CSV from its traces (no
 * task is re-run), so runs recorded before a classifier change are judged by
 * the same rule. Writes <csv>.rescored.csv and prints the class counts.
 *
 *   pnpm exec tsx scripts/browser-eval/rescore.ts results/b08-38max/full-legacy.csv [--task-timeout-ms 240000]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { UnifiedBrowserOutcome } from '../../src/agent/browser-tools/unified-browser-loop.js';
import { classifyFailure } from './score.js';

const csvPath = process.argv[2];
if (!csvPath) throw new Error('usage: rescore.ts <csv>');
const timeoutIndex = process.argv.indexOf('--task-timeout-ms');
const taskTimeoutMs = timeoutIndex > 0 ? Number(process.argv[timeoutIndex + 1]) : 240_000;
const [header, ...lines] = readFileSync(csvPath, 'utf8').trim().split('\n');
const cols = (header ?? '').split(',');
const at = (name: string) => cols.indexOf(name);
const counts: Record<string, number> = {};
const changed: string[] = [];
const out = lines.map((line) => {
  const cells = line.split(',');
  const id = cells[at('id')] ?? '';
  const executor = cells[at('executor')] ?? '';
  const trace = readFileSync(join(dirname(csvPath), 'traces', `${executor}-${id}.jsonl`), 'utf8')
    .trim()
    .split('\n')
    .map((entry) => JSON.parse(entry) as Record<string, unknown>);
  const outcome = (trace.findLast((entry) => entry.type === 'outcome')?.outcome ?? {
    status: 'failed',
    reason: 'missing',
    steps: 0,
  }) as UnifiedBrowserOutcome;
  const next = classifyFailure(cells[at('success')] === 'true', outcome, trace, {
    durationMs: Number(cells[at('durationMs')]),
    taskTimeoutMs,
  });
  const before = cells[at('failureClass')];
  if (before !== next) changed.push(`${id} ${executor}: ${before} → ${next}`);
  cells[at('failureClass')] = next;
  counts[next] = (counts[next] ?? 0) + 1;
  return cells.join(',');
});
writeFileSync(csvPath.replace(/\.csv$/, '.rescored.csv'), `${[header, ...out].join('\n')}\n`);
const total = lines.length;
console.log(
  `rows=${total} ${Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(
      ' ',
    )} model_layer_rate=${(((counts.model_layer ?? 0) / Math.max(total, 1)) * 100).toFixed(1)}%`,
);
for (const line of changed) console.log(`changed ${line}`);
