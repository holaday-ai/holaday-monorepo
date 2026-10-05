/**
 * Browser eval runner (batch 04 §4.4, batch 08). Runs one executor on a local
 * managed headless Chromium (same stealth + network policy as production) with
 * the selected brain and writes a CSV of success / steps / duration / tokens.
 *
 *   pnpm exec tsx --env-file=<env> scripts/browser-eval/run.ts --brain qwen --smoke
 *   pnpm exec tsx --env-file=<env> scripts/browser-eval/run.ts --executor legacy --out results/legacy.csv
 *
 *   --executor unified (default) — batch-04 unified tool loop
 *   --executor legacy            — production supercar agent-loop (coordinate protocol)
 *
 * Paired mode (batch 11.0): every task runs legacy then unified on the SAME
 * model. Models rotate in order when one returns 403 (free quota exhausted) or
 * reaches --token-budget (default 900k, tracked across runs in --budget-state):
 *
 *   ... run.ts --paired --models qwen3.7-plus,qwen3.6-plus --region intl \
 *       --budget-state results/budget.json --out results/paired.csv
 *
 * Needs the provider key in the environment. Never prints env values.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createPlaywrightUnifiedExecutor } from '../../src/agent/browser-tools/playwright-unified-executor.js';
import {
  type UnifiedBrowserOutcome,
  createResponsesWebSearch,
  runUnifiedBrowserLoop,
} from '../../src/agent/browser-tools/unified-browser-loop.js';
import { runSupercarTask, supercarAbort } from '../../src/agent/supercar/qwen-only-agent-loop.js';
import { PlaywrightExecutor } from '../../src/agent/vision-loop/playwright-executor.js';
import { env } from '../../src/config/env.js';
import type { MessagesAdapter } from '../../src/llm/messages-adapter.js';
import { BUILTIN_MODEL_CATALOG } from '../../src/llm/model-catalog.js';
import { createProductionModelRuntimeWiring } from '../../src/llm/model-runtime-wiring.js';
import { type BrowserEvalTask, classifyFailure, scoreBrowserEval } from './score.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const brainId = arg('brain') ?? 'qwen';
const executorKind = (arg('executor') ?? 'unified') as 'unified' | 'legacy';
const region = arg('region') ?? 'cn';
const taskTimeoutMs = Number(arg('task-timeout-ms') ?? 240_000);
const out =
  arg('out') ??
  `scripts/browser-eval/results/${process.argv.includes('--paired') ? 'paired' : executorKind}-${brainId}-${Date.now()}.csv`;
const suite = JSON.parse(readFileSync(new URL('./tasks.json', import.meta.url), 'utf8')) as {
  smokeIds: string[];
  tasks: BrowserEvalTask[];
};
const ids = process.argv.includes('--smoke') ? suite.smokeIds : arg('ids')?.split(',');
const tasks = ids ? suite.tasks.filter((task) => ids.includes(task.id)) : suite.tasks;
const catalogBrain = BUILTIN_MODEL_CATALOG.find((entry) => entry.id === brainId);
if (!catalogBrain) throw new Error(`unknown brain ${brainId}`);
// --model overrides the browser + vision lane model of the brain (e.g. qwen3.8-flash).
const modelOverride = arg('model');
function brainFor(model: string | undefined) {
  return model
    ? {
        ...(catalogBrain as NonNullable<typeof catalogBrain>),
        laneModels: { ...catalogBrain?.laneModels, browser: model, vision: model },
      }
    : (catalogBrain as NonNullable<typeof catalogBrain>);
}
const paired = process.argv.includes('--paired');
const pairedModels = (arg('models') ?? '')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);
if (paired && pairedModels.length === 0) throw new Error('--paired needs --models a,b,c');
const tokenBudget = Number(arg('token-budget') ?? 900_000);
const budgetStatePath = arg('budget-state');
/** --context baseline reproduces the pre-batch-12 unified context (2 full results, full URLs). */
const contextMode = arg('context') ?? 'default';
if (contextMode !== 'default' && contextMode !== 'baseline')
  throw new Error('--context must be default or baseline');
const unifiedContext = contextMode === 'baseline' ? { fullPageResults: 2, maxUrlChars: 0 } : {};
const concurrency = Number(arg('concurrency') ?? 1);
if (concurrency !== 1)
  throw new Error('--concurrency must be 1: executors and tasks run strictly one at a time');
const delayMs = Number(arg('delay-ms') ?? 2_500);
if (executorKind !== 'unified' && executorKind !== 'legacy')
  throw new Error('--executor must be unified or legacy');

type ReadyRuntime = Extract<
  ReturnType<ReturnType<typeof createProductionModelRuntimeWiring>['resolveCore']>,
  { kind: 'ready' }
>;
const runtimes = new Map<string, ReadyRuntime>();
function runtimeFor(model: string | undefined): ReadyRuntime {
  const key = model ?? '';
  const cached = runtimes.get(key);
  if (cached) return cached;
  const resolved = createProductionModelRuntimeWiring(env).resolveCore({
    actorExternalId: 'browser-eval',
    lane: 'browser',
    ownership: { scope: 'personal', userRegion: region },
    brain: brainFor(model),
  });
  if (resolved.kind !== 'ready')
    throw new Error(`brain ${brainId} unavailable: ${resolved.reasonCode}`);
  runtimes.set(key, resolved);
  return resolved;
}
runtimeFor(paired ? pairedModels[0] : modelOverride);

const HANDOFF_RE = /登录|登陆|扫码|验证码|captcha|log ?in|sign ?in|支付|付款|实名/i;

async function runLegacy(
  executor: PlaywrightExecutor,
  task: BrowserEvalTask,
  adapter: MessagesAdapter,
): Promise<UnifiedBrowserOutcome> {
  let awaiting: string | null = null;
  const taskId = `eval_${task.id}_${Date.now()}`;
  const outcome = await runSupercarTask({
    taskId,
    intent: `${task.instruction}\n（起始页面：${task.startUrl}）`,
    executor,
    preserveExistingPage: true,
    messagesAdapter: adapter,
    timeoutMs: taskTimeoutMs,
    maxIterations: 30,
    isTaskCancelled: () => awaiting !== null,
    onAwaitingUser: (event) => {
      awaiting = event.question;
      // A handoff is the scored outcome: release the parked task now instead
      // of waiting out the 30-minute takeover window (no human in the eval).
      setTimeout(() => supercarAbort(taskId), 0);
    },
  });
  const steps = outcome.iterations;
  if (awaiting !== null || outcome.status === 'awaiting_user') {
    const message = awaiting ?? outcome.question ?? '';
    return {
      status: 'awaiting_user',
      reason: HANDOFF_RE.test(message) ? 'login' : 'other',
      message,
      steps,
    };
  }
  if (outcome.status === 'completed' && outcome.summary)
    return { status: 'completed', summary: outcome.summary, evidence: outcome.summary, steps };
  return { status: 'failed', reason: outcome.reason ?? outcome.status, steps };
}

async function runUnified(
  executor: PlaywrightExecutor,
  task: BrowserEvalTask,
  adapter: MessagesAdapter,
  trace: Array<Record<string, unknown>>,
  runtime: ReadyRuntime,
): Promise<UnifiedBrowserOutcome> {
  const page = await executor.getPage();
  const unified = createPlaywrightUnifiedExecutor(page, {
    ...(unifiedContext.maxUrlChars !== undefined
      ? { maxUrlChars: unifiedContext.maxUrlChars }
      : {}),
  });
  const tools = {
    execute: async (action: Parameters<typeof unified.execute>[0]) => {
      const result = await unified.execute(action);
      trace.push({ type: 'tool', action, ok: result.ok, text: result.text.slice(0, 200) });
      return result;
    },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), taskTimeoutMs);
  try {
    return await runUnifiedBrowserLoop({
      intent: task.instruction,
      adapter,
      execute: tools.execute,
      webSearch: createResponsesWebSearch(runtime.responses('fast')),
      maxSteps: 30,
      ...(unifiedContext.fullPageResults !== undefined
        ? { fullPageResults: unifiedContext.fullPageResults }
        : {}),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** --resume: keep finished runs from an existing --out CSV and skip them. */
const resume = process.argv.includes('--resume');
const previous = new Map<string, string>();
if (resume) {
  try {
    const lines = readFileSync(out, 'utf8').trim().split('\n').slice(1);
    for (const line of lines) {
      const [id, , kind] = line.split(',');
      if (id && kind) previous.set(`${id}|${kind}`, line);
    }
  } catch {
    /* nothing to resume */
  }
}

const rows = [
  'id,category,executor,brain,model,status,success,failureClass,steps,durationMs,inputTokens,outputTokens,modelCalls,quota403,reason,attempts',
];
rows.push(...previous.values());
const summary = { total: 0, modelLayer: 0, environment: 0, counted: 0, succeeded: 0 };
const executor = new PlaywrightExecutor();
const launched = await executor.launchManaged({ headless: true });
if (!launched.ok) throw new Error('browser launch failed');

interface TaskRun {
  success: boolean;
  failureClass: ReturnType<typeof classifyFailure>;
  tokens: number;
  quota403: boolean;
  rateLimited: boolean;
  row: Array<string | number | boolean>;
}

const RATE_LIMIT_WAIT_MS = Number(arg('rate-limit-wait-ms') ?? 60_000);
const MAX_ATTEMPTS = 3;

/**
 * Free-tier models enforce low RPM/TPM limits; the adapter's sub-second 429
 * backoff is too short for them. A run that failed at the model layer because
 * of a 429 is retried after a pause, at most 3 attempts in all; only the final
 * attempt is recorded, every attempt's tokens count toward the budget.
 */
async function runTaskWithRetry(
  task: BrowserEvalTask,
  kind: 'legacy' | 'unified',
  model: string | undefined,
): Promise<TaskRun> {
  let tokens = 0;
  for (let attempt = 1; ; attempt += 1) {
    const run = await runTask(task, kind, model);
    tokens += run.tokens;
    const retry =
      run.failureClass === 'model_layer' &&
      run.rateLimited &&
      !run.quota403 &&
      attempt < MAX_ATTEMPTS;
    if (!retry) {
      recordRun(task, kind, model, run, attempt);
      return { ...run, tokens };
    }
    process.stdout.write(
      `${task.id} ${kind} rate-limited (429), retry ${attempt + 1}/${MAX_ATTEMPTS} in ${RATE_LIMIT_WAIT_MS}ms\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
  }
}

function recordRun(
  task: BrowserEvalTask,
  kind: 'legacy' | 'unified',
  model: string | undefined,
  run: TaskRun,
  attempts: number,
): void {
  summary.total += 1;
  if (run.failureClass === 'model_layer') summary.modelLayer += 1;
  else if (run.failureClass === 'environment') summary.environment += 1;
  else {
    summary.counted += 1;
    if (run.success) summary.succeeded += 1;
  }
  rows.push([...run.row, attempts].join(','));
  process.stdout.write(
    `${task.id} ${kind} ${model ?? ''} success=${run.success} class=${run.failureClass} attempts=${attempts}${run.quota403 ? ' 403' : ''}\n`,
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${rows.join('\n')}\n`);
}

async function runTask(
  task: BrowserEvalTask,
  kind: 'legacy' | 'unified',
  model: string | undefined,
): Promise<TaskRun> {
  const runtime = runtimeFor(model);
  const trace: Array<Record<string, unknown>> = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let modelCalls = 0;
  let quota403 = false;
  let rateLimited = false;
  const base = runtime.messages('vision');
  const adapter: MessagesAdapter = {
    metadata: base.metadata,
    async create(request, options) {
      modelCalls += 1;
      const startedCall = Date.now();
      let response: Awaited<ReturnType<MessagesAdapter['create']>>;
      try {
        response = await base.create(request, options);
      } catch (error) {
        const code = (error as { code?: string }).code ?? (error as Error).name;
        const status = (error as { status?: number | null }).status ?? null;
        if (status === 403) quota403 = true;
        if (status === 429) rateLimited = true;
        trace.push({
          type: 'model_error',
          code,
          status,
          ms: Date.now() - startedCall,
          bytes: JSON.stringify(request).length,
        });
        throw error;
      }
      trace.push({
        type: 'model',
        ms: Date.now() - startedCall,
        stop: response.stopReason,
        calls: response.content.flatMap((block) =>
          block.type === 'tool_use'
            ? [{ name: block.name, input: JSON.stringify(block.input).slice(0, 300) }]
            : [],
        ),
      });
      inputTokens += response.usage.inputTokens ?? 0;
      outputTokens += response.usage.outputTokens ?? 0;
      return response;
    },
  };
  const started = Date.now();
  let outcome: UnifiedBrowserOutcome;
  try {
    await executor.resetPageForTask().catch(() => {});
    const page = await executor.getPage();
    // Start-page navigation is harness work, not the executor under test:
    // retry transient timeouts / interrupted navigations a few times.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await page.goto(task.startUrl, { timeout: 45_000, waitUntil: 'domcontentloaded' });
        break;
      } catch (error) {
        trace.push({ type: 'goto_retry', attempt, error: (error as Error).message.slice(0, 80) });
        if (attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
    outcome =
      kind === 'legacy'
        ? await runLegacy(executor, task, adapter)
        : await runUnified(executor, task, adapter, trace, runtime);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 80) : 'error';
    outcome = { status: 'failed', reason: `harness: ${message}`, steps: 0 };
  }
  trace.push({ type: 'outcome', outcome });
  mkdirSync(`${dirname(out)}/traces`, { recursive: true });
  writeFileSync(
    `${dirname(out)}/traces/${kind}-${task.id}.jsonl`,
    `${trace.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
  );
  const success = scoreBrowserEval(task, outcome);
  const failureClass = classifyFailure(success, outcome, trace, {
    durationMs: Date.now() - started,
    taskTimeoutMs,
  });
  const reason =
    outcome.status === 'failed'
      ? outcome.reason
      : outcome.status === 'awaiting_user'
        ? `handoff:${outcome.reason}`
        : '';
  const row = [
    task.id,
    task.category,
    kind,
    brainId,
    brainFor(model).laneModels.browser ?? '',
    outcome.status,
    success,
    failureClass,
    outcome.steps,
    Date.now() - started,
    inputTokens,
    outputTokens,
    modelCalls,
    quota403,
    JSON.stringify(reason.replace(/\s+/g, ' ').slice(0, 120)),
  ];
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return {
    success,
    failureClass,
    tokens: inputTokens + outputTokens,
    quota403,
    rateLimited,
    row,
  };
}

/** Per-model token use, persisted so the full run continues the smoke run's count. */
function loadBudget(): Record<string, { tokens: number; exhausted: boolean }> {
  if (!budgetStatePath) return {};
  try {
    return JSON.parse(readFileSync(budgetStatePath, 'utf8'));
  } catch {
    return {};
  }
}

interface PairResult {
  id: string;
  category: string;
  model: string;
  legacy: TaskRun | null;
  unified: TaskRun | null;
}

try {
  if (!paired) {
    for (const task of tasks) await runTaskWithRetry(task, executorKind, modelOverride);
  } else {
    const budget = loadBudget();
    const saveBudget = () => {
      if (budgetStatePath) writeFileSync(budgetStatePath, JSON.stringify(budget, null, 2));
    };
    const usable = () =>
      pairedModels.find(
        (model) => !budget[model]?.exhausted && (budget[model]?.tokens ?? 0) < tokenBudget,
      );
    const pairs: PairResult[] = [];
    for (const task of tasks) {
      const model = usable();
      if (!model) {
        process.stdout.write(`${task.id} not run: every model is out of budget\n`);
        pairs.push({
          id: task.id,
          category: task.category,
          model: '',
          legacy: null,
          unified: null,
        });
        continue;
      }
      budget[model] ??= { tokens: 0, exhausted: false };
      const entry = budget[model];
      const pair: PairResult = {
        id: task.id,
        category: task.category,
        model,
        legacy: null,
        unified: null,
      };
      const doneLegacy = previous.get(`${task.id}|legacy`);
      const doneUnified = previous.get(`${task.id}|unified`);
      if (doneLegacy && doneUnified) {
        process.stdout.write(`${task.id} resumed: pair already recorded\n`);
        continue;
      }
      if (doneLegacy) {
        // Same model as the recorded legacy run keeps the pair fair.
        const recordedModel = doneLegacy.split(',')[4] ?? model;
        process.stdout.write(
          `${task.id} resumed: legacy recorded, running unified on ${recordedModel}\n`,
        );
        budget[recordedModel] ??= { tokens: 0, exhausted: false };
        pair.model = recordedModel;
        pair.unified = await runTaskWithRetry(task, 'unified', recordedModel);
        budget[recordedModel].tokens += pair.unified.tokens;
        if (pair.unified.quota403) budget[recordedModel].exhausted = true;
        saveBudget();
        pairs.push(pair);
        continue;
      }
      pair.legacy = await runTaskWithRetry(task, 'legacy', model);
      entry.tokens += pair.legacy.tokens;
      if (pair.legacy.quota403) entry.exhausted = true;
      else {
        pair.unified = await runTaskWithRetry(task, 'unified', model);
        entry.tokens += pair.unified.tokens;
        if (pair.unified.quota403) entry.exhausted = true;
      }
      saveBudget();
      pairs.push(pair);
    }
    writeFileSync(`${out.replace(/\.csv$/, '')}.pairs.json`, JSON.stringify(pairs, null, 2));
    const comparable = pairs.filter(
      (pair) =>
        pair.legacy &&
        pair.unified &&
        pair.legacy.failureClass !== 'model_layer' &&
        pair.unified.failureClass !== 'model_layer' &&
        pair.legacy.failureClass !== 'environment' &&
        pair.unified.failureClass !== 'environment',
    );
    const ok = (kind: 'legacy' | 'unified') =>
      comparable.filter((pair) => pair[kind]?.success).length;
    process.stdout.write(
      `paired summary: pairs=${pairs.length} comparable=${comparable.length} legacy=${ok('legacy')} unified=${ok('unified')}\n`,
    );
  }
} finally {
  await executor.disconnect().catch(() => {});
}
const rate = summary.counted ? ((summary.succeeded / summary.counted) * 100).toFixed(1) : 'n/a';
process.stdout.write(
  `summary executor=${paired ? 'paired' : executorKind} total=${summary.total} counted=${summary.counted} succeeded=${summary.succeeded} successRate=${rate}% excluded_model_layer=${summary.modelLayer} excluded_environment=${summary.environment}\n`,
);
process.stdout.write(`wrote ${out}\n`);
