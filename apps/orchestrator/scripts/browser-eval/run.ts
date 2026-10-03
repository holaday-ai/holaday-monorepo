/**
 * Browser eval runner (batch 04 §4.4). Runs the unified browser loop on a local
 * headless Chromium with the selected brain and writes a CSV of
 * success / steps / duration / tokens.
 *
 *   pnpm exec tsx scripts/browser-eval/run.ts --brain qwen --smoke
 *   pnpm exec tsx scripts/browser-eval/run.ts --brain claude --ids be-06,be-10 --out /tmp/eval.csv
 *
 * Needs the provider key in the environment (DASHSCOPE_* / ANTHROPIC_API_KEY /
 * OPENAI_API_KEY). Real paid calls: run only when BOSS decides.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createPlaywrightUnifiedExecutor } from '../../src/agent/browser-tools/playwright-unified-executor.js';
import {
  createResponsesWebSearch,
  runUnifiedBrowserLoop,
} from '../../src/agent/browser-tools/unified-browser-loop.js';
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
const region = arg('region') ?? 'cn';
const out = arg('out') ?? `browser-eval-${brainId}-${Date.now()}.csv`;
const suite = JSON.parse(readFileSync(new URL('./tasks.json', import.meta.url), 'utf8')) as {
  smokeIds: string[];
  tasks: BrowserEvalTask[];
};
const ids = process.argv.includes('--smoke') ? suite.smokeIds : arg('ids')?.split(',');
const tasks = ids ? suite.tasks.filter((task) => ids.includes(task.id)) : suite.tasks;
const brain = BUILTIN_MODEL_CATALOG.find((entry) => entry.id === brainId);
if (!brain) throw new Error(`unknown brain ${brainId}`);

const runtime = createProductionModelRuntimeWiring(env).resolveCore({
  actorExternalId: 'browser-eval',
  lane: 'browser',
  ownership: { scope: 'personal', userRegion: region },
  brain,
});
if (runtime.kind !== 'ready')
  throw new Error(`brain ${brainId} unavailable: ${runtime.reasonCode}`);

const rows = ['id,category,brain,status,success,steps,durationMs,inputTokens,outputTokens'];
const browser = await chromium.launch({ headless: true });
try {
  for (const task of tasks) {
    let inputTokens = 0;
    let outputTokens = 0;
    const base = runtime.messages('vision');
    const adapter: MessagesAdapter = {
      metadata: base.metadata,
      async create(request, options) {
        const response = await base.create(request, options);
        inputTokens += response.usage.inputTokens ?? 0;
        outputTokens += response.usage.outputTokens ?? 0;
        return response;
      },
    };
    const page = await browser.newPage();
    const started = Date.now();
    let outcome: Awaited<ReturnType<typeof runUnifiedBrowserLoop>>;
    try {
      await page.goto(task.startUrl, { timeout: 45_000, waitUntil: 'domcontentloaded' });
      const tools = createPlaywrightUnifiedExecutor(page);
      outcome = await runUnifiedBrowserLoop({
        intent: task.instruction,
        adapter,
        execute: tools.execute,
        webSearch: createResponsesWebSearch(runtime.responses('fast')),
        maxSteps: 30,
      });
    } catch {
      outcome = { status: 'failed', reason: 'start page unreachable', steps: 0 };
    } finally {
      await page.close();
    }
    const success = scoreBrowserEval(task, outcome);
    rows.push(
      [
        task.id,
        task.category,
        brainId,
        outcome.status,
        success,
        outcome.steps,
        Date.now() - started,
        inputTokens,
        outputTokens,
      ].join(','),
    );
    process.stdout.write(`${task.id} ${outcome.status} success=${success}\n`);
  }
} finally {
  await browser.close();
}
writeFileSync(out, `${rows.join('\n')}\n`);
process.stdout.write(`wrote ${out}\n`);
