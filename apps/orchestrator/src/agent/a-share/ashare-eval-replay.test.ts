/**
 * 批次 10.5 — A股 18+2 评测集离线回放（闸门 + 路由）.
 *
 * 整条链路用生产代码：lane gate → matcher（上下文内/外）→ runner（取数 → 生成 → regex 闸门 →
 * 意图判官 → 降级/放行）→ 组装；模型来自真实的 `createProductionModelRuntimeWiring(...)
 * .resolveCore({ lane: 'generate' })`，只把千问 Messages 工厂替换成脚本化 adapter。
 * 不发网络、不读 .env、不调真实模型、不请求真实行情。
 *
 * 设 ASHARE_REPLAY_REPORT=<path> 时把逐条结果写成 JSON（报告用）。
 */

import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import type {
  MessagesAdapter,
  NeutralMessagesRequest,
  NeutralMessagesResponse,
} from '../../llm/messages-adapter.js';
import { createProductionModelRuntimeWiring } from '../../llm/model-runtime-wiring.js';
import { replayClient } from './ashare-eval-replay.client.js';
import {
  REPLAY_CASES,
  type ReplayCase,
  type ReplayRoute,
  SKILL_COMMAND_CASES,
} from './ashare-eval-replay.fixtures.js';
import { buildIndexCard } from './ashare-fact-card.js';
import { INTENT_JUDGE_SYSTEM } from './ashare-intent-judge.js';
import { ashareMessagesAdapter, createAshareModelCallers } from './ashare-model-callers.js';
import { ashareQaHandlesMode } from './ashare-qa-lane-gate.js';
import { resolveAshareInContext, resolveAshareQa } from './ashare-qa-matcher.js';
import {
  ASHARE_QA_GUIDANCE,
  type AshareQaResult,
  runAsharePanorama,
  runAshareQa,
} from './ashare-qa-runner.js';
import type { AshareQaMatch, ResolvedStock } from './ashare-qa-types.js';

const NOW = new Date('2026-06-15T07:00:00Z');

// ───────── 合成模型环境（无真实 key）─────────
const SYNTHETIC_ENV = {
  NODE_ENV: 'test' as const,
  MODEL_RUNTIME_POLICY: 'qwen_only' as const,
  QWEN_CORE_ROLLOUT_MODE: 'all' as const,
  QWEN_CORE_ENABLED_LANES: '',
  QWEN_CORE_ALLOWLIST: '',
  QWEN_MESSAGES_ADAPTER_ENABLED: true,
  QWEN_RESPONSES_ADAPTER_ENABLED: true,
  DASHSCOPE_API_KEY: '',
  DASHSCOPE_WORKSPACE_ID: '',
  DASHSCOPE_INTL_API_KEY: 'synthetic-intl-key',
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
  DASHSCOPE_INTL_RESPONSES_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_INTL_WORKSPACE_ID: '',
  DASHSCOPE_CN_API_KEY: 'synthetic-cn-key',
  DASHSCOPE_CN_ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
  DASHSCOPE_CN_RESPONSES_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_CN_WORKSPACE_ID: '',
  QWEN_REASONING_MODEL: 'qwen3.8-max',
  QWEN_STANDARD_MODEL: 'qwen3.7-plus',
  QWEN_FAST_MODEL: 'qwen3.8-flash',
  QWEN_CODING_MODEL: 'qwen3-coder-plus',
  QWEN_VERIFIER_MODEL: 'qwen3.8-flash',
  QWEN_VERIFY_FAST_MODEL: 'qwen3.8-flash',
  QWEN_VERIFY_STRICT_MODEL: 'qwen3.8-max',
  QWEN_VISION_MODEL: 'qwen3.8-max',
};

interface ScriptedCall {
  kind: 'interpret' | 'judge';
  model: string;
  request: NeutralMessagesRequest;
}

/** 走真实目录 wiring，只替换千问 Messages 工厂 → 脚本化 adapter。 */
function catalogAdapter(script: { interpret?: string; judge?: string }) {
  const calls: ScriptedCall[] = [];
  const wiring = createProductionModelRuntimeWiring(SYNTHETIC_ENV, {
    createMessages: ({ environment }) => {
      const model = environment.QWEN_STANDARD_MODEL;
      const adapter: MessagesAdapter = {
        metadata: {
          provider: 'alibaba-model-studio',
          model,
          region: 'cn',
          deploymentScope: 'china_mainland',
          endpointKind: 'public',
          protocol: 'messages',
        },
        create: async (request): Promise<NeutralMessagesResponse> => {
          const kind = request.system === INTENT_JUDGE_SYSTEM ? 'judge' : 'interpret';
          calls.push({ kind, model, request });
          const text = script[kind];
          if (text === undefined) throw new Error(`unscripted ${kind} call`);
          return {
            id: `msg_${calls.length}`,
            metadata: adapter.metadata,
            content: [{ type: 'text', text }],
            stopReason: 'end_turn',
            usage: {
              inputTokens: null,
              outputTokens: null,
              cacheReadInputTokens: null,
              cacheCreationInputTokens: null,
              complete: false,
            },
          };
        },
      };
      return adapter;
    },
  });
  const runtime = wiring.resolveCore({
    actorExternalId: 'usr_replay',
    lane: 'generate',
    ownership: { scope: 'personal', userRegion: 'cn' },
  });
  const adapter = ashareMessagesAdapter(runtime);
  if (!adapter) throw new Error('generate lane not ready in synthetic env');
  return { adapter, calls, runtime };
}

/** name-search mock：问句里出现已知简称即命中。含「今天国际」以复现 E16 首测误配诱因。 */
const NAME_TABLE: ReadonlyArray<[string, ResolvedStock]> = [
  ['贵州茅台', { symbol: '600519', displayName: '贵州茅台' }],
  ['茅台', { symbol: '600519', displayName: '贵州茅台' }],
  ['宁德时代', { symbol: '300750', displayName: '宁德时代' }],
  ['迪生力', { symbol: '603335', displayName: '迪生力' }],
  ['今天', { symbol: '300532', displayName: '今天国际' }],
];
const searchCalls: string[] = [];
async function replaySearch(q: string): Promise<ResolvedStock[]> {
  searchCalls.push(q);
  const hit = NAME_TABLE.find(([alias]) => q.includes(alias));
  return hit ? [hit[1]] : [];
}

// ───────── 路由：镜像 tasks.ts a-share 分叉的选择顺序（match → index → guidance → general）─────────
async function routeOf(
  c: Pick<ReplayCase, 'intent' | 'executionMode' | 'skillEnabled'>,
): Promise<{ route: ReplayRoute; match: AshareQaMatch | null }> {
  if (!ashareQaHandlesMode(c.executionMode)) return { route: 'general', match: null };
  if (c.skillEnabled) {
    const r = await resolveAshareInContext(
      { intent: c.intent, watchlist: [], now: NOW },
      replaySearch,
    );
    if (r.match) return { route: r.match.deep ? 'ashare_panorama' : 'ashare_qa', match: r.match };
    if (r.indexIntent) return { route: 'ashare_index', match: null };
    if (r.hasSignal) return { route: 'ashare_qa_guidance', match: null };
    return { route: 'general', match: null };
  }
  const m = await resolveAshareQa(
    { intent: c.intent, roleId: null, watchlist: [], now: NOW },
    replaySearch,
  );
  if (m) return { route: m.deep ? 'ashare_panorama' : 'ashare_qa', match: m };
  return { route: 'general', match: null };
}

async function runLane(
  match: AshareQaMatch,
  script: { interpret?: string; judge?: string },
): Promise<{ result: AshareQaResult; calls: ScriptedCall[]; degradeLogs: number }> {
  const { adapter, calls } = catalogAdapter(script);
  let degradeLogs = 0;
  const callers = createAshareModelCallers(adapter, { judgeEnabled: script.judge !== undefined });
  const runner = match.deep ? runAsharePanorama : runAshareQa;
  const result = await runner(
    {
      client: replayClient(),
      skillMarkdown: '你是严谨的 A股信息分析助手。',
      ...callers,
      logger: {
        info: () => {},
        warn: (obj) => {
          if (obj.event === 'ashare_qa_degrade') degradeLogs += 1;
        },
      },
      now: NOW,
    },
    match,
  );
  return { result, calls, degradeLogs };
}

// ───────── 结果收集（报告用）─────────
interface ReplayRow {
  id: string;
  route: ReplayRoute;
  expectedRoute: ReplayRoute;
  scored: boolean;
  dataSource: string;
  modelSource: string;
  modelCalls: string[];
  degraded: boolean | null;
  reason: string | null;
  pass: boolean;
}
const rows: ReplayRow[] = [];

afterAll(() => {
  const out = process.env.ASHARE_REPLAY_REPORT;
  if (out) writeFileSync(out, JSON.stringify(rows, null, 2));
});

describe('A股 18+2 评测集离线回放（闸门 + 路由，模型目录 generate 通道）', () => {
  it.each(REPLAY_CASES.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const { route, match } = await routeOf(c);
    const row: ReplayRow = {
      id: c.id,
      route,
      expectedRoute: c.route,
      scored: c.scored,
      dataSource: c.dataSource,
      modelSource: c.modelSource,
      modelCalls: [],
      degraded: null,
      reason: null,
      pass: false,
    };
    rows.push(row);
    expect(route).toBe(c.route);

    if (route === 'ashare_index') {
      // E16：指数 lane 不做 name-search（不会把「今天」配成今天国际），无 LLM、无闸门。
      expect(searchCalls).not.toContain(c.intent);
      const card = await buildIndexCard({ client: replayClient(), now: NOW });
      expect(card).toContain('A股大盘速览');
      expect(card).not.toContain('今天国际');
      row.pass = true;
      return;
    }
    if (route === 'ashare_qa_guidance') {
      // 静态引导：零 LLM（无 adapter 调用），话术自带红线声明 + 免责。
      expect(ASHARE_QA_GUIDANCE).toContain('不提供买卖建议、不预测涨跌');
      expect(ASHARE_QA_GUIDANCE).toContain('免责声明');
      row.pass = true;
      return;
    }
    if (route === 'general') {
      row.pass = true;
      return;
    }

    if (!match) throw new Error('lane route without match');
    const { result, calls, degradeLogs } = await runLane(match, {
      interpret: c.interpretOutput,
      judge: c.judgeOutput,
    });
    row.modelCalls = calls.map((x) => `${x.kind}@${x.model}/t${x.request.temperature}`);
    row.degraded = result.degraded;
    row.reason = result.reason ?? null;

    // 路由：所有模型调用都经目录 generate 通道（千问 standard 档），参数与原内联闭包一致。
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.model).toBe('qwen3.7-plus');
      expect(call.request.thinking).toEqual({ type: 'disabled' });
      expect(call.request.temperature).toBe(call.kind === 'judge' ? 0 : 0.3);
    }
    // 顺序：先生成，判官（若被调用）一定在生成之后。
    expect(calls[0]?.kind).toBe('interpret');

    const e = c.expect;
    if (!e) throw new Error(`${c.id} missing expectations`);
    expect(result.degraded).toBe(e.degraded);
    expect(result.interpreted).toBe(e.interpreted);
    if (e.reason) expect(result.reason).toBe(e.reason);
    expect(degradeLogs).toBe(e.degraded ? 1 : 0); // 降级必打日志 + 计数
    if (e.judgeCalled !== undefined) {
      expect(calls.some((x) => x.kind === 'judge')).toBe(e.judgeCalled);
    }
    for (const s of e.contains ?? []) expect(result.answer).toContain(s);
    for (const s of e.notContains ?? []) expect(result.answer).not.toContain(s);
    expect(result.answer).toContain('免责声明');
    row.pass = true;
  });

  it('18+2 计分用例全覆盖（E01–E16、E19、E20 计分；E17/E18 占位）', () => {
    const scored = REPLAY_CASES.filter((c) => c.scored).map((c) => c.id);
    expect(scored).toEqual([
      'E01',
      'E02',
      'E03',
      'E04',
      'E05',
      'E06',
      'E07',
      'E08',
      'E09',
      'E10',
      'E11',
      'E12',
      'E13',
      'E14',
      'E15',
      'E16',
      'E19',
      'E20',
    ]);
    const ids = new Set(REPLAY_CASES.map((c) => c.id));
    expect(ids.has('E17') && ids.has('E18')).toBe(true);
  });
});

describe('5 个 fork 技能（comps/dcf/earnings/sector/thesis）现状回放', () => {
  it.each(SKILL_COMMAND_CASES.map((c) => [`${c.skill}: ${c.intent}`, c] as const))(
    '%s',
    async (_label, c) => {
      const { route, match } = await routeOf({
        intent: c.intent,
        executionMode: 'generate',
        skillEnabled: true,
      });
      const row: ReplayRow = {
        id: `skill:${c.skill}:${c.intent}`,
        route,
        expectedRoute: c.route,
        scored: false,
        dataSource: 'mock',
        modelSource: c.interpretOutput ? 'mock' : 'n/a',
        modelCalls: [],
        degraded: null,
        reason: null,
        pass: route === c.route,
      };
      rows.push(row);
      expect(route).toBe(c.route);
      if (route === 'ashare_qa' && match) {
        // 无专属执行器：落轻量速览（①②③），不产出 DCF/对标等方法论报告。
        expect(match.deep).toBe(false);
        if (c.interpretOutput) {
          const { result, calls } = await runLane(match, { interpret: c.interpretOutput });
          row.modelCalls = calls.map((x) => `${x.kind}@${x.model}/t${x.request.temperature}`);
          row.degraded = result.degraded;
          row.reason = result.reason ?? null;
          expect(result.degraded).toBe(true);
          expect(result.reason).toBe(c.expectDegradedReason);
          expect(result.answer).not.toContain('目标价');
        }
      }
    },
  );
});
