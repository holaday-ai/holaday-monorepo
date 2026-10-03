import { existsSync } from 'node:fs';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  MessagesAdapter,
  NeutralMessagesRequest,
  NeutralMessagesResponse,
} from '../../llm/messages-adapter.js';
import type { CreateActionCaptureInput } from '../task-action-capture-repository.js';
import type { PlaybookBrowserTools } from '../replay/browser-tools.js';
import { createModelPathMatcher, createModelStepRepairer } from '../replay/model-assist.js';
import { PlaywrightBrowserTools } from '../replay/playwright-browser-tools.js';
import { type ShopFixture, startShopFixture } from './__fixtures__/shop-fixture.js';
import { BrowserActionCaptureRecorder, type CaptureSink } from './capture-recorder.js';
import { InMemoryEvolutionStore } from './evolution-store.js';
import { resolveLocator } from './locator.js';
import type { PathTemplate } from './path-template.js';
import {
  type BrowserSession,
  runCanaryRound,
  runSedimentSweep,
  tryReuseVerifiedPath,
} from './self-evolution.js';
import { type CaptureRowForTrajectory, buildTrajectory } from './trajectory.js';

/**
 * Batch 06 acceptance: 沉淀 → verified → 确定性回放 → 失败局部修复, end to end
 * against a local static-page fixture in headless Chromium. All model calls go
 * to fake adapters (no network, no spend).
 */

const STEP_WAIT_MS = 1_500;
const hasChromium = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

class MemoryCaptureSink implements CaptureSink {
  rows: Array<CreateActionCaptureInput & { outcomeJson?: unknown }> = [];
  async create(input: CreateActionCaptureInput) {
    this.rows.push({ ...input });
  }
  async setOutcome(taskId: number, outcome: unknown) {
    const own = this.rows.filter((r) => r.taskId === taskId);
    const last = own[own.length - 1];
    if (last) last.outcomeJson = outcome;
  }
}

type FakeReply = (request: NeutralMessagesRequest) => string;

class FakeAdapter implements MessagesAdapter {
  readonly metadata = {
    provider: 'alibaba-model-studio',
    model: 'fake-qwen',
    region: 'cn',
    deploymentScope: 'china_mainland',
    endpointKind: 'public',
    protocol: 'messages',
  } as unknown as MessagesAdapter['metadata'];
  calls: NeutralMessagesRequest[] = [];
  constructor(private readonly reply: FakeReply) {}
  async create(request: NeutralMessagesRequest): Promise<NeutralMessagesResponse> {
    this.calls.push(request);
    return {
      id: `fake-${this.calls.length}`,
      metadata: this.metadata,
      content: [{ type: 'text', text: this.reply(request) }],
      stopReason: 'end_turn',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: null,
        cacheCreationInputTokens: null,
        complete: true,
      },
    };
  }
}

function userText(request: NeutralMessagesRequest): string {
  const first = request.messages[0];
  return typeof first?.content === 'string' ? first.content : '';
}

describe.skipIf(!hasChromium)('playbook self-evolution loop (local fixture, headless)', () => {
  let browser: Browser;
  let shop: ShopFixture;

  const openBrowser = async (): Promise<BrowserSession> => {
    // Fresh context per session = isolated (no cookies / storage shared).
    const context = await browser.newContext();
    const page = await context.newPage();
    return {
      tools: new PlaywrightBrowserTools(page, { timeoutMs: STEP_WAIT_MS }),
      close: () => context.close(),
    };
  };

  beforeAll(async () => {
    shop = await startShopFixture();
    browser = await chromium.launch({ headless: true, timeout: 15_000 });
  });

  afterAll(async () => {
    await browser?.close();
    await shop?.close();
  });

  /** What a batch-04 executor run looks like from the capture hook's side. */
  async function runCapturedTask(
    sink: MemoryCaptureSink,
    taskId: number,
    query: string,
  ): Promise<void> {
    const session = await openBrowser();
    const tools: PlaybookBrowserTools = session.tools;
    const recorder = new BrowserActionCaptureRecorder(sink, { taskId, executorSource: 'cloud' });
    try {
      const home = `${shop.baseUrl}/`;
      await tools.navigate(home);
      await recorder.recordToolCall({ op: 'navigate', url: home });

      let snap = await tools.snapshot();
      const box = resolveLocator(snap, { role: 'textbox', name: '搜索商品' });
      if (box.kind !== 'found') throw new Error('fixture: search box missing');
      await tools.type(box.element.ref, query);
      await recorder.recordToolCall({ op: 'type', ref: box.element.ref, snapshot: snap, text: query });

      snap = await tools.snapshot();
      const btn = resolveLocator(snap, { role: 'button', name: '搜索' });
      if (btn.kind !== 'found') throw new Error('fixture: search button missing');
      await tools.click(btn.element.ref);
      await tools.wait_for({ text: '搜索结果' });
      await recorder.recordToolCall({
        op: 'click',
        ref: btn.element.ref,
        snapshot: snap,
        wait: { kind: 'text', text: '搜索结果' },
      });

      snap = await tools.snapshot();
      const link = resolveLocator(snap, { role: 'link', name: `${query} 详情` });
      if (link.kind !== 'found') throw new Error('fixture: result link missing');
      await tools.click(link.element.ref);
      await tools.wait_for({ text: '商品详情' });
      await recorder.recordToolCall({
        op: 'click',
        ref: link.element.ref,
        snapshot: snap,
        wait: { kind: 'text', text: '商品详情' },
      });

      const finalSnap = await tools.snapshot();
      await recorder.recordOutcome({ finalUrl: finalSnap.url, evidenceTexts: ['商品详情', query] });
    } finally {
      await session.close();
    }
  }

  function qwenTemplate(): PathTemplate {
    return {
      schemaVersion: 1,
      siteDomain: '127.0.0.1',
      description: '在测试商城搜索商品并打开商品详情',
      params: [{ name: 'query', description: '商品关键词', example: '蓝牙音箱' }],
      steps: [
        { op: 'navigate', url: `${shop.baseUrl}/` },
        { op: 'type', target: { role: 'textbox', name: '搜索商品' }, text: '{{query}}' },
        {
          op: 'click',
          target: { role: 'button', name: '搜索' },
          wait: { kind: 'text', text: '搜索结果' },
        },
        {
          op: 'click',
          target: { role: 'link', name: '{{query}} 详情' },
          wait: { kind: 'text', text: '商品详情' },
        },
      ],
      success: { textContains: ['商品详情'] },
    };
  }

  it('captures → sediments (Qwen, verified deterministically) → canary ×3 → verified → deterministic reuse → local repair → new version', async () => {
    const store = new InMemoryEvolutionStore();
    const sink = new MemoryCaptureSink();

    // ---- 1. 捕获: two successful runs of the same capability ----------------
    await runCapturedTask(sink, 101, '降噪耳机');
    await runCapturedTask(sink, 102, '机械键盘');
    expect(sink.rows).toHaveLength(8);
    expect(sink.rows.every((r) => r.executorSource === 'cloud')).toBe(true);
    const typeRow = sink.rows.find((r) => r.stepType === 'type');
    expect(typeRow?.replayJson).toMatchObject({ op: 'type', locator: { role: 'textbox', name: '搜索商品' } });
    expect(typeRow?.inputValue).toBe('降噪耳机'); // type=search, not sensitive

    const intents: Record<number, string> = { 101: '帮我找降噪耳机', 102: '帮我找机械键盘' };
    for (const taskId of [101, 102]) {
      const rows: CaptureRowForTrajectory[] = sink.rows
        .filter((r) => r.taskId === taskId)
        .map((r) => ({
          taskId: r.taskId,
          actionIndex: r.actionIndex,
          stepType: r.stepType,
          siteDomain: r.siteDomain ?? null,
          entryUrl: r.entryUrl ?? null,
          inputValue: r.inputValue ?? null,
          replayJson: r.replayJson,
          outcomeJson: r.outcomeJson ?? null,
        }));
      const built = buildTrajectory({ id: taskId, intent: intents[taskId] as string }, rows);
      if (!built.ok) throw new Error(`trajectory rejected: ${built.reason}`);
      store.trajectories.push(built.trajectory);
    }

    // ---- 2. 沉淀: Qwen (fake generate lane) proposes, validator accepts -------
    const qwen = new FakeAdapter(() => JSON.stringify(qwenTemplate()));
    const sediment = await runSedimentSweep({ store, adapter: qwen, minSupport: 2 });
    expect(sediment.groups).toBe(1);
    expect(sediment.created).toHaveLength(1);
    expect(sediment.created[0]?.generalizer).toBe('qwen');
    expect(qwen.calls).toHaveLength(1);
    const draft = store.paths[0];
    expect(draft?.status).toBe('draft');
    expect(draft?.sourceTaskIds.sort()).toEqual([101, 102]);
    // Re-running with no new evidence is a no-op (idempotent sweep).
    const again = await runSedimentSweep({ store, adapter: qwen, minSupport: 2 });
    expect(again.created).toHaveLength(0);
    expect(again.skippedNoNewEvidence).toBe(1);

    // ---- 3. 验证: N=3 consecutive isolated canary passes → verified ----------
    for (let round = 1; round <= 3; round += 1) {
      const [report] = await runCanaryRound({
        store,
        openBrowser,
        passThreshold: 3,
        locatorWaitMs: STEP_WAIT_MS,
      });
      expect(report?.passed).toBe(true);
      expect(report?.streak).toBe(round);
      expect(report?.status).toBe(round < 3 ? 'draft' : 'verified');
    }
    expect(store.paths[0]?.status).toBe('verified');
    expect(store.canary.filter((c) => c.passed)).toHaveLength(3);

    // ---- 4a. 复用: deterministic replay; only the matcher call hits the model --
    const matcherModel = new FakeAdapter((req) => {
      const query = userText(req).includes('无线鼠标') ? '无线鼠标' : '蓝牙音箱';
      return JSON.stringify({ pathId: store.paths.find((p) => p.status === 'verified')?.id, params: { query } });
    });
    const repairModel = new FakeAdapter(() => '{"ref":null}');
    {
      const session = await openBrowser();
      try {
        const reuse = await tryReuseVerifiedPath({
          store,
          tools: session.tools,
          intent: '帮我找蓝牙音箱',
          siteDomain: '127.0.0.1',
          taskId: 201,
          matcher: createModelPathMatcher(matcherModel),
          repairer: createModelStepRepairer(repairModel),
          locatorWaitMs: STEP_WAIT_MS,
        });
        expect(reuse.status).toBe('replayed');
        expect(reuse.handled).toBe(true);
        expect(reuse.replay?.outcome).toBe('success');
        expect(reuse.replay?.stepsDeterministic).toBe(4);
        expect(reuse.modelCalls).toBe(1); // matcher only
        expect(repairModel.calls).toHaveLength(0);
        const finalSnap = await session.tools.snapshot();
        expect(decodeURIComponent(finalSnap.url)).toContain('/item?name=蓝牙音箱');
      } finally {
        await session.close();
      }
    }
    expect(store.replays[0]).toMatchObject({ outcome: 'success', modelCalls: 1, modelCallsSaved: 4 });

    // ---- 4b. 站点改版: one step breaks → snapshot to the model → local repair --
    shop.variant = 'v2';
    const fixingModel = new FakeAdapter((req) => {
      // Point at the renamed button in the element list the executor sent.
      const line = userText(req)
        .split('\n')
        .find((l) => /^e\d+ button "查找"$/.test(l.trim()));
      return JSON.stringify({ ref: line ? line.trim().split(' ')[0] : null });
    });
    const verifiedBefore = store.paths.find((p) => p.status === 'verified');
    {
      const session = await openBrowser();
      try {
        const reuse = await tryReuseVerifiedPath({
          store,
          tools: session.tools,
          intent: '帮我找无线鼠标',
          siteDomain: '127.0.0.1',
          taskId: 202,
          matcher: createModelPathMatcher(matcherModel),
          repairer: createModelStepRepairer(fixingModel),
          locatorWaitMs: 500,
        });
        expect(reuse.replay?.outcome).toBe('repaired');
        expect(reuse.handled).toBe(true);
        expect(reuse.replay?.stepsRepaired).toBe(1);
        expect(reuse.replay?.failedStepIndex).toBeUndefined();
        expect(fixingModel.calls).toHaveLength(1);
        expect(reuse.modelCalls).toBe(2); // matcher + one local repair
        expect(reuse.newVersionPathId).toBeDefined();
      } finally {
        await session.close();
      }
    }
    // The repair is recorded as a NEW VERSION; the old version is retired.
    const old = store.paths.find((p) => p.id === verifiedBefore?.id);
    const next = store.paths.find((p) => p.parentPathId === verifiedBefore?.id && p.generalizer === 'repair');
    expect(old?.status).toBe('stale');
    expect(next?.status).toBe('verified');
    expect(next?.version).toBe((old?.version ?? 0) + 1);
    expect(next?.template.steps[2]).toMatchObject({ op: 'click', target: { role: 'button', name: '查找' } });
    // Param placeholders survive the repair (the template stays generic).
    expect(next?.template.steps[3]).toMatchObject({ target: { name: '{{query}} 详情' } });
    expect(store.replays[1]).toMatchObject({ outcome: 'repaired', repairedPathId: next?.id, modelCallsSaved: 3 });

    // ---- 4c. The new version replays deterministically (no repair needed) ----
    {
      const session = await openBrowser();
      try {
        const reuse = await tryReuseVerifiedPath({
          store,
          tools: session.tools,
          intent: '帮我找蓝牙音箱',
          siteDomain: '127.0.0.1',
          taskId: 203,
          matcher: createModelPathMatcher(
            new FakeAdapter(() => JSON.stringify({ pathId: next?.id, params: { query: '蓝牙音箱' } })),
          ),
          repairer: createModelStepRepairer(repairModel),
          locatorWaitMs: STEP_WAIT_MS,
        });
        expect(reuse.replay?.outcome).toBe('success');
        expect(repairModel.calls).toHaveLength(0);
      } finally {
        await session.close();
      }
    }

    // ---- 3'. Canary keeps guarding: the redesigned site still passes v-next --
    const [canaryAfter] = await runCanaryRound({
      store,
      openBrowser,
      passThreshold: 3,
      locatorWaitMs: STEP_WAIT_MS,
    });
    expect(canaryAfter?.pathId).toBe(next?.id);
    expect(canaryAfter?.passed).toBe(true);
  }, 120_000);

  it('canary failure demotes a verified path to stale (no model involved)', async () => {
    shop.variant = 'v1';
    const store = new InMemoryEvolutionStore();
    const template = qwenTemplate();
    template.steps[2] = { op: 'click', target: { role: 'button', name: '不存在的按钮' } };
    const path = await store.createTemplatePath({
      siteDomain: '127.0.0.1',
      capabilityKey: 'auto_test',
      template,
      generalizer: 'qwen',
      sourceTaskIds: [1, 2],
      status: 'verified',
      canaryPassStreak: 5,
    });
    const [report] = await runCanaryRound({ store, openBrowser, passThreshold: 3, locatorWaitMs: 300 });
    expect(report?.passed).toBe(false);
    expect(report?.failureReason).toMatch(/locator_not_found/);
    expect(store.paths.find((p) => p.id === path.id)).toMatchObject({ status: 'stale', canaryPassStreak: 0 });
  }, 60_000);
});
