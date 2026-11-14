/**
 * REBUILD-3: replays one fixture — 读页面 → 出答案 → 核对 → 排版 — with no site and no browser.
 *
 * The real browser loop runs on the recorded tool results (replay-executor.ts). The model is
 * whatever adapter the caller passes: the gateway's `brain` for a real replay
 * (scripts/replay-bench.ts), a scripted fake in tests.
 */
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { isPriceTask } from '../answer-contract/price-task.js';
import {
  type UnifiedBrowserOutcome,
  runUnifiedBrowserLoop,
} from '../browser-tools/unified-browser-loop.js';
import type { UnifiedBrowserAction } from '../browser-tools/unified-tools.js';
import type { BenchFixture } from './fixture.js';
import { createReplayExecutor } from './replay-executor.js';

export interface ReplayResult {
  id: string;
  outcome: UnifiedBrowserOutcome;
  ms: number;
  /** Recorded steps the replay served, and calls the fixture had nothing for. */
  served: number[];
  misses: string[];
  priceContract: boolean;
}

export async function replayFixture(input: {
  fixture: BenchFixture;
  /** The fixture directory (screenshots are read from it). */
  dir?: string;
  adapter: MessagesAdapter;
  /** Price tasks answer through the price contract (as with ANSWER_CONTRACT_PRICE on). */
  answerContract?: boolean;
  maxSteps?: number;
  turnTimeoutMs?: number;
  signal?: AbortSignal;
  now?: () => number;
}): Promise<ReplayResult> {
  const now = input.now ?? Date.now;
  const started = now();
  const { fixture } = input;
  const replay = createReplayExecutor(fixture, input.dir ? { dir: input.dir } : {});
  const asked = fixture.userIntent ?? fixture.intent;
  const priceContract = !!input.answerContract && isPriceTask(asked);
  const searches = fixture.steps.some((step) => step.tool === 'web_search');
  const reads = fixture.steps.some((step) => step.tool === 'read_url');
  const outcome = await runUnifiedBrowserLoop({
    intent: fixture.intent,
    ...(fixture.userIntent ? { userIntent: fixture.userIntent } : {}),
    ...(fixture.observationV2 ? { observationV2: true } : {}),
    adapter: input.adapter,
    execute: (action: UnifiedBrowserAction) =>
      replay.execute(action as unknown as { tool: string } & Record<string, unknown>),
    currentPageUrl: replay.currentUrl,
    ...(searches ? { webSearch: replay.webSearch } : {}),
    ...(reads ? { readPage: replay.readPage } : {}),
    requireBrowserEvidence: true,
    rescue: false,
    maxSteps: input.maxSteps ?? Math.min(40, fixture.steps.length + 8),
    turnTimeoutMs: input.turnTimeoutMs ?? 50_000,
    modelRetry: { delaysMs: [] },
    ...(priceContract ? { answerContract: 'price' as const } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return {
    id: fixture.id,
    outcome,
    ms: now() - started,
    served: [...replay.served],
    misses: [...replay.misses],
    priceContract,
  };
}
