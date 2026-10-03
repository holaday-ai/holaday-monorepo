import { describe, expect, it } from 'vitest';
import type {
  MessagesAdapter,
  NeutralMessagesRequest,
  NeutralMessagesResponse,
} from '../../llm/messages-adapter.js';
import { REDACTED_INPUT_VALUE } from '../action-capture-redaction.js';
import { acceptPathMatch } from '../replay/model-assist.js';
import { summariseEvolutionMetrics } from './drizzle-evolution-store.js';
import { generalizeDeterministically, generalizeGroup } from './generalize.js';
import { fillPlaceholders, instantiateStep } from './path-template.js';
import { validateTemplateAgainstTrajectories } from './template-validator.js';
import {
  type CaptureRowForTrajectory,
  type Trajectory,
  buildTrajectory,
  groupTrajectories,
} from './trajectory.js';

function trajectory(taskId: number, query: string, extra: Partial<Trajectory> = {}): Trajectory {
  return {
    taskId,
    siteDomain: 'shop.example',
    intent: `找${query}`,
    steps: [
      {
        op: 'navigate',
        locator: null,
        url: `https://shop.example/s?kw=${encodeURIComponent(query)}&src=home`,
        value: null,
        submit: false,
        wait: null,
      },
      {
        op: 'type',
        locator: { role: 'textbox', name: '搜索商品' },
        url: null,
        value: query,
        submit: true,
        wait: { kind: 'text', text: '搜索结果' },
      },
      {
        op: 'click',
        locator: { role: 'link', name: `${query} 详情` },
        url: null,
        value: null,
        submit: false,
        wait: { kind: 'text', text: '商品详情' },
      },
    ],
    outcome: { evidenceTexts: ['商品详情'] },
    ...extra,
  };
}

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

function fakeAdapter(text: string): MessagesAdapter & { calls: number } {
  const adapter = {
    calls: 0,
    metadata: { provider: 'openai', model: 'fake' } as MessagesAdapter['metadata'],
    async create(_req: NeutralMessagesRequest): Promise<NeutralMessagesResponse> {
      adapter.calls += 1;
      return {
        id: 'x',
        metadata: adapter.metadata,
        content: [{ type: 'text', text }],
        stopReason: 'end_turn',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
  return adapter;
}

describe('trajectory grouping', () => {
  it('groups same-site runs whose skeletons match once typed values are masked', () => {
    const groups = groupTrajectories([
      trajectory(1, '耳机'),
      trajectory(2, '键盘'),
      trajectory(3, '鼠标'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.capabilityKey).toMatch(/^auto_[0-9a-f]{16}$/);
    expect(groups[0]?.trajectories.map((t) => t.taskId)).toEqual([1, 2, 3]);
  });

  it('requires at least two distinct tasks', () => {
    expect(groupTrajectories([trajectory(1, '耳机')])).toHaveLength(0);
    expect(groupTrajectories([trajectory(1, '耳机'), trajectory(1, '耳机')])).toHaveLength(0);
  });

  it('builds trajectories only from 0062 replay descriptors and never from redacted input', () => {
    const base: CaptureRowForTrajectory = {
      taskId: 9,
      actionIndex: 0,
      stepType: 'type',
      siteDomain: 'shop.example',
      entryUrl: null,
      inputValue: REDACTED_INPUT_VALUE,
      replayJson: { op: 'type', locator: { role: 'textbox', name: '密码' } },
      outcomeJson: null,
    };
    expect(buildTrajectory({ id: 9, intent: 'x' }, [base])).toEqual({
      ok: false,
      reason: 'redacted_input',
    });
    expect(buildTrajectory({ id: 9, intent: 'x' }, [{ ...base, replayJson: null }])).toEqual({
      ok: false,
      reason: 'legacy_capture_without_locator',
    });
  });
});

describe('deterministic template validation', () => {
  const group = () =>
    must(groupTrajectories([trajectory(1, '降噪耳机'), trajectory(2, '机械键盘')])[0]);

  it('diff generaliser parameterises typed text, its URL echo and its locator echo', () => {
    const template = generalizeDeterministically(group());
    expect(template).not.toBeNull();
    expect(template?.params.map((p) => p.name)).toEqual(['query']);
    expect(template?.steps[0]).toMatchObject({
      op: 'navigate',
      url: 'https://shop.example/s?kw={{query}}&src=home',
    });
    expect(template?.steps[1]).toMatchObject({ op: 'type', text: '{{query}}', submit: true });
    expect(template?.steps[2]).toMatchObject({
      op: 'click',
      target: { role: 'link', name: '{{query}} 详情' },
    });
    const bound = instantiateStep(must(must(template).steps[0]), { query: '蓝牙 音箱' });
    expect(bound).toMatchObject({
      url: 'https://shop.example/s?kw=%E8%93%9D%E7%89%99%20%E9%9F%B3%E7%AE%B1&src=home',
    });
  });

  it('rejects a template that bakes a typed user value in as a constant', () => {
    const template = must(generalizeDeterministically(group()));
    const baked = structuredClone(template);
    baked.steps[1] = {
      op: 'type',
      target: { role: 'textbox', name: '搜索商品' },
      text: '降噪耳机',
      submit: true,
    };
    const result = validateTemplateAgainstTrajectories(baked, group().trajectories);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/typed text must be a param/);
  });

  it('rejects undeclared / unused params and op mismatches', () => {
    const template = must(generalizeDeterministically(group()));
    const broken = structuredClone(template);
    broken.params.push({ name: 'unused', description: 'x', example: 'y' });
    broken.steps[2] = { op: 'click', target: { role: 'button', name: '{{nope}}' } };
    const result = validateTemplateAgainstTrajectories(broken, group().trajectories);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const text = result.errors.join('\n');
      expect(text).toMatch(/undeclared param \{\{nope\}\}/);
      expect(text).toMatch(/unused param unused/);
      expect(text).toMatch(/role button ≠ captured link/);
    }
  });

  it('never accepts a path containing a sensitive step (login / pay / order)', () => {
    const risky = [1, 2].map((id) => {
      const t = trajectory(id, id === 1 ? '耳机' : '键盘');
      t.steps.push({
        op: 'click',
        locator: { role: 'button', name: '立即支付' },
        url: null,
        value: null,
        submit: false,
        wait: null,
      });
      return t;
    });
    const g = must(groupTrajectories(risky)[0]);
    expect(generalizeDeterministically(g)).toBeNull();
    const safe = must(
      generalizeDeterministically(
        must(groupTrajectories([trajectory(1, '耳机'), trajectory(2, '键盘')])[0]),
      ),
    );
    safe.steps.push({ op: 'click', target: { role: 'button', name: '立即支付' } });
    const result = validateTemplateAgainstTrajectories(safe, g.trajectories);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/sensitive step/);
  });
});

describe('generalizeGroup (Qwen first, verified; deterministic fallback)', () => {
  it('falls back to the diff generaliser when the model output does not reproduce the trajectories', async () => {
    const g = must(groupTrajectories([trajectory(1, '降噪耳机'), trajectory(2, '机械键盘')])[0]);
    const adapter = fakeAdapter(
      '{"schemaVersion":1,"siteDomain":"shop.example","description":"x","params":[],"steps":[{"op":"back"}]}',
    );
    const out = await generalizeGroup(g, { adapter });
    expect(adapter.calls).toBe(1);
    expect(out.ok).toBe(true);
    expect(out.generalizer).toBe('deterministic');
    expect(out.modelCalls).toBe(1);
    expect(out.modelErrors?.length).toBeGreaterThan(0);
  });

  it('accepts a valid model template as-is', async () => {
    const g = must(groupTrajectories([trajectory(1, '降噪耳机'), trajectory(2, '机械键盘')])[0]);
    const proposal = {
      ...must(generalizeDeterministically(g)),
      description: '在示例商城按关键词搜索并打开详情',
    };
    const out = await generalizeGroup(g, {
      adapter: fakeAdapter(`\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\``),
    });
    expect(out.generalizer).toBe('qwen');
    expect(out.template?.description).toBe('在示例商城按关键词搜索并打开详情');
  });

  it('uses no model call at all without an adapter', async () => {
    const g = must(groupTrajectories([trajectory(1, '降噪耳机'), trajectory(2, '机械键盘')])[0]);
    const out = await generalizeGroup(g, { adapter: null });
    expect(out).toMatchObject({ ok: true, generalizer: 'deterministic', modelCalls: 0 });
  });
});

describe('reuse matcher acceptance + metrics', () => {
  const candidates = [
    { pathId: 7, description: 'd', params: [{ name: 'query', description: 'q', example: 'e' }] },
  ];

  it('accepts only a known path with every param filled', () => {
    expect(acceptPathMatch({ pathId: 7, params: { query: ' 耳机 ' } }, candidates)).toEqual({
      pathId: 7,
      params: { query: '耳机' },
    });
    expect(acceptPathMatch({ pathId: 8, params: { query: '耳机' } }, candidates)).toBeNull();
    expect(acceptPathMatch({ pathId: 7, params: {} }, candidates)).toBeNull();
    expect(acceptPathMatch({ pathId: null }, candidates)).toBeNull();
  });

  it('summarises dashboard metrics with null rates when there is no data', () => {
    const empty = summariseEvolutionMetrics({
      byStatus: new Map(),
      canaryRuns: 0,
      canaryPassed: 0,
      reuseAttempts: 0,
      reuseHits: 0,
      reuseRepaired: 0,
      modelCallsSaved: 0,
      windowDays: 30,
    });
    expect(empty.canary.passRate).toBeNull();
    expect(empty.reuse.hitRate).toBeNull();
    const full = summariseEvolutionMetrics({
      byStatus: new Map([
        ['verified', 3],
        ['draft', 1],
        ['stale', 1],
      ]),
      canaryRuns: 9,
      canaryPassed: 8,
      reuseAttempts: 4,
      reuseHits: 3,
      reuseRepaired: 1,
      modelCallsSaved: 12,
      windowDays: 30,
    });
    expect(full.paths).toEqual({ total: 5, draft: 1, verified: 3, stale: 1 });
    expect(full.canary.passRate).toBe(88.9);
    expect(full.reuse.hitRate).toBe(75);
  });

  it('fills placeholders and reports a missing param', () => {
    expect(fillPlaceholders('{{a}}-{{a}}', { a: 'x' })).toBe('x-x');
    expect(() => fillPlaceholders('{{b}}', {})).toThrow(/missing value/);
  });
});
