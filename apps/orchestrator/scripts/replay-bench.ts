/**
 * REBUILD-3 fixed-sample replay: 读页面 → 出答案 → 核对 → 排版 over recorded bench60 fixtures,
 * no site and no browser. The model is the gateway's `brain` role (real calls: run it only when
 * the model quota is meant to be used).
 *
 *   tsx scripts/replay-bench.ts [--dir test-fixtures/bench60] [--id new-amazon-sg,core-03]
 *                               [--contract on|off] [--region cn|intl] [--out results.json]
 *
 * Fixtures are recorded by real runs with BENCH_RECORD_DIR set (one directory per task id;
 * rename a directory to its question id when the benchmark's task list maps them).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFixtureDirs, readFixture } from '../src/agent/bench-replay/fixture.js';
import { replayFixture } from '../src/agent/bench-replay/replay.js';
import { env } from '../src/config/env.js';
import { modelGateway } from '../src/llm/gateway/model-gateway.js';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};

const root = resolve(arg('--dir') ?? join(here, '../test-fixtures/bench60'));
const ids = (arg('--id') ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const contract = (arg('--contract') ?? 'on') !== 'off';
const region = arg('--region') === 'intl' ? 'intl' : 'cn';
const out = arg('--out');

const runtime = modelGateway({ core: { environment: env } }).resolve('brain', {
  actorExternalId: 'bench-replay',
  ownership: { scope: 'personal', userRegion: region },
});
if (runtime.kind !== 'ready') {
  console.error(`brain model unavailable: ${runtime.reason}`);
  process.exit(2);
}

const dirs = listFixtureDirs(root).filter((dir) => !ids.length || ids.includes(basename(dir)));
if (!dirs.length) {
  console.error(`no fixtures under ${root}${ids.length ? ` for ${ids.join(',')}` : ''}`);
  process.exit(1);
}

const rows: Array<Record<string, unknown>> = [];
for (const dir of dirs) {
  const fixture = readFixture(dir);
  // One minute per item is the target; a replay that runs longer is cut off and reported.
  const signal = AbortSignal.timeout(60_000);
  const result = await replayFixture({
    fixture,
    dir,
    adapter: runtime.messages(),
    answerContract: contract,
    signal,
  });
  const { outcome } = result;
  const row = {
    id: result.id,
    status: outcome.status,
    ms: result.ms,
    priceContract: result.priceContract,
    answerContract: outcome.status === 'completed' ? (outcome.answerContract ?? null) : null,
    partial: outcome.status === 'completed' ? (outcome.partial ?? null) : null,
    misses: result.misses,
    answer:
      outcome.status === 'completed'
        ? outcome.summary
        : 'reason' in outcome
          ? (outcome.reason ?? null)
          : null,
    recorded: fixture.outcome ?? null,
  };
  rows.push(row);
  console.log(
    `${row.id}\t${row.status}\t${row.ms}ms\tcontract=${row.answerContract ?? '-'}\tmisses=${row.misses.length}`,
  );
}

if (out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), `${JSON.stringify({ root, contract, region, rows }, null, 2)}\n`);
}
const slow = rows.filter((row) => (row.ms as number) > 60_000).length;
console.log(`${rows.length} replayed, ${slow} over one minute`);
