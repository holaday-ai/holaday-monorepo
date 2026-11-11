/**
 * REBUILD-3 fixed-sample replay: 读页面 → 出答案 → 核对 → 排版 over recorded bench60 fixtures,
 * no site and no browser. Two model modes (src/agent/bench-replay/model-replies.ts):
 *
 *   --models live      (default) the gateway's `brain` role — real calls, spends quota; add
 *                      --record-models to write each run's replies as model-replies.json
 *   --models recorded  the replies in model-replies.json — no model call, reproducible; for
 *                      rule / checker / renderer regressions
 *
 *   tsx scripts/replay-bench.ts [--dir test-fixtures/bench60] [--id new-amazon-sg,core-03]
 *                               [--contract on|off] [--region cn|intl] [--out results.json]
 *                               [--models live|recorded] [--record-models]
 *
 * Fixtures are recorded by real runs with BENCH_RECORD_DIR set (one directory per task id;
 * rename a directory to its question id when the benchmark's task list maps them).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFixtureDirs, readFixture } from '../src/agent/bench-replay/fixture.js';
import {
  type ReplayingModel,
  readModelReplies,
  recordingModel,
  replayingModel,
  writeModelReplies,
} from '../src/agent/bench-replay/model-replies.js';
import { replayFixture } from '../src/agent/bench-replay/replay.js';

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
const recordedModels = arg('--models') === 'recorded';
const recordModels = process.argv.includes('--record-models');
if (recordedModels && recordModels) {
  console.error('--record-models needs --models live');
  process.exit(2);
}

// Recorded mode never loads the env or resolves a model: nothing can be called.
const runtime = recordedModels
  ? null
  : await (async () => {
      const { env } = await import('../src/config/env.js');
      const { modelGateway } = await import('../src/llm/gateway/model-gateway.js');
      return modelGateway({ core: { environment: env } }).resolve('brain', {
        actorExternalId: 'bench-replay',
        ownership: { scope: 'personal', userRegion: region },
      });
    })();
if (runtime && runtime.kind !== 'ready') {
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
  let replaying: ReplayingModel | null = null;
  let recording: ReturnType<typeof recordingModel> | null = null;
  let adapter: Parameters<typeof replayFixture>[0]['adapter'];
  if (recordedModels) {
    const replies = readModelReplies(dir);
    if (!replies) {
      console.log(
        `${basename(dir)}\tskipped\tno model-replies.json (record one with --record-models)`,
      );
      continue;
    }
    replaying = replayingModel(replies);
    adapter = replaying.adapter;
  } else {
    const live = runtime!.kind === 'ready' ? runtime!.messages() : null;
    if (!live) process.exit(2);
    recording = recordModels ? recordingModel(live) : null;
    adapter = recording?.adapter ?? live;
  }
  // One minute per item is the target; a replay that runs longer is cut off and reported.
  const signal = AbortSignal.timeout(60_000);
  const result = await replayFixture({
    fixture,
    dir,
    adapter,
    answerContract: contract,
    signal,
  });
  if (recording) writeModelReplies(dir, recording.replies(), adapter.metadata.model);
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
    ...(replaying
      ? {
          models: 'recorded',
          modelReplies: {
            served: replaying.served(),
            diverged: replaying.diverged(),
            exhausted: replaying.exhausted(),
          },
        }
      : { models: 'live' }),
  };
  rows.push(row);
  console.log(
    `${row.id}\t${row.status}\t${row.ms}ms\tcontract=${row.answerContract ?? '-'}\tmisses=${row.misses.length}`,
  );
}

if (out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(
    resolve(out),
    `${JSON.stringify({ root, contract, region, models: recordedModels ? 'recorded' : 'live', rows }, null, 2)}\n`,
  );
}
const slow = rows.filter((row) => (row.ms as number) > 60_000).length;
console.log(`${rows.length} replayed, ${slow} over one minute`);
