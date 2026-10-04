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
import { runSupercarTask } from '../../src/agent/supercar/qwen-only-agent-loop.js';
import { PlaywrightExecutor } from '../../src/agent/vision-loop/playwright-executor.js';
import { env } from '../../src/config/env.js';
import type { MessagesAdapter } from '../../src/llm/messages-adapter.js';
import { BUILTIN_MODEL_CATALOG } from '../../src/llm/model-catalog.js';
import { createProductionModelRuntimeWiring } from '../../src/llm/model-runtime-wiring.js';
import { type BrowserEvalTask, scoreBrowserEval } from './score.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const brainId = arg('brain') ?? 'qwen';
const executorKind = (arg('executor') ?? 'unified') as 'unified' | 'legacy';
const region = arg('region') ?? 'cn';
const taskTimeoutMs = Number(arg('task-timeout-ms') ?? 240_000);
const out =
  arg('out') ?? `scripts/browser-eval/results/${executorKind}-${brainId}-${Date.now()}.csv`;
const suite = JSON.parse(readFileSync(new URL('./tasks.json', import.meta.url), 'utf8')) as {
  smokeIds: string[];
  tasks: BrowserEvalTask[];
};
const ids = process.argv.includes('--smoke') ? suite.smokeIds : arg('ids')?.split(',');
const tasks = ids ? suite.tasks.filter((task) => ids.includes(task.id)) : suite.tasks;
const brain = BUILTIN_MODEL_CATALOG.find((entry) => entry.id === brainId);
if (!brain) throw new Error(`unknown brain ${brainId}`);
if (executorKind !== 'unified' && executorKind !== 'legacy')
  throw new Error('--executor must be unified or legacy');

const runtime = createProductionModelRuntimeWiring(env).resolveCore({
  actorExternalId: 'browser-eval',
  lane: 'browser',
  ownership: { scope: 'personal', userRegion: region },
  brain,
});
if (runtime.kind !== 'ready')
  throw new Error(`brain ${brainId} unavailable: ${runtime.reasonCode}`);

const HANDOFF_RE = /登录|登陆|扫码|验证码|captcha|log ?in|sign ?in|支付|付款|实名/i;

async function runLegacy(
  executor: PlaywrightExecutor,
  task: BrowserEvalTask,
  adapter: MessagesAdapter,
): Promise<UnifiedBrowserOutcome> {
  let awaiting: string | null = null;
  const outcome = await runSupercarTask({
    taskId: `eval_${task.id}_${Date.now()}`,
    intent: `${task.instruction}\n（起始页面：${task.startUrl}）`,
    executor,
    preserveExistingPage: true,
    messagesAdapter: adapter,
    timeoutMs: taskTimeoutMs,
    maxIterations: 30,
    isTaskCancelled: () => awaiting !== null,
    onAwaitingUser: (event) => {
      awaiting = event.question;
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
): Promise<UnifiedBrowserOutcome> {
  const page = await executor.getPage();
  const tools = createPlaywrightUnifiedExecutor(page);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), taskTimeoutMs);
  try {
    return await runUnifiedBrowserLoop({
      intent: task.instruction,
      adapter,
      execute: tools.execute,
      webSearch: createResponsesWebSearch(
        runtime.kind === 'ready' ? runtime.responses('fast') : (null as never),
      ),
      maxSteps: 30,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

const rows = [
  'id,category,executor,brain,status,success,steps,durationMs,inputTokens,outputTokens,modelCalls,reason',
];
const executor = new PlaywrightExecutor();
const launched = await executor.launchManaged({ headless: true });
if (!launched.ok) throw new Error('browser launch failed');
try {
  for (const task of tasks) {
    let inputTokens = 0;
    let outputTokens = 0;
    let modelCalls = 0;
    const base = runtime.messages('vision');
    const adapter: MessagesAdapter = {
      metadata: base.metadata,
      async create(request, options) {
        modelCalls += 1;
        const response = await base.create(request, options);
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
      await page.goto(task.startUrl, { timeout: 45_000, waitUntil: 'domcontentloaded' });
      outcome =
        executorKind === 'legacy'
          ? await runLegacy(executor, task, adapter)
          : await runUnified(executor, task, adapter);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 80) : 'error';
      outcome = { status: 'failed', reason: `harness: ${message}`, steps: 0 };
    }
    const success = scoreBrowserEval(task, outcome);
    const reason =
      outcome.status === 'failed'
        ? outcome.reason
        : outcome.status === 'awaiting_user'
          ? `handoff:${outcome.reason}`
          : '';
    rows.push(
      [
        task.id,
        task.category,
        executorKind,
        brainId,
        outcome.status,
        success,
        outcome.steps,
        Date.now() - started,
        inputTokens,
        outputTokens,
        modelCalls,
        JSON.stringify(reason.replace(/\s+/g, ' ').slice(0, 120)),
      ].join(','),
    );
    process.stdout.write(`${task.id} ${executorKind} ${outcome.status} success=${success}\n`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${rows.join('\n')}\n`);
  }
} finally {
  await executor.disconnect().catch(() => {});
}
process.stdout.write(`wrote ${out}\n`);
