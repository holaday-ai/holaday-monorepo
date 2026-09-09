import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareCoreAdmission } from '../agent/core-task-admission.js';
import { prepareCoreSettlement } from '../agent/core-task-settlement.js';
import { runGenerateTask } from '../agent/generate-runner.js';
import type { MessagesAdapter, NeutralMessagesRequest } from '../llm/messages-adapter.js';
import type { NeutralResponsesRequest, ResponsesAdapter } from '../llm/responses-adapter.js';
import { CoreExecutionRegistry } from './core-execution-registry.js';
import { reloadFeatureFlagsForTest, setFeatureFlagsForTest } from './feature-flags.js';
import {
  type ReviewableGenerateOutcome,
  reviewGenerateOutcome,
} from './generate-outcome-review.js';
import {
  type TaskVerificationContext,
  createTaskVerificationContext,
} from './task-verification-context.js';

const logger = pino({ level: 'silent' });
const PLAN =
  '1. 整理用户已提供的合成资料，标明缺失的信息。\n2. 按确认后的范围整理报告，输出可供复核的结论；未确认事项先询问用户。';
const metadata = {
  provider: 'alibaba-model-studio' as const,
  region: 'cn' as const,
  deploymentScope: 'china_mainland' as const,
  endpointKind: 'public' as const,
};

function fixture(overrides: Partial<TaskVerificationContext> = {}) {
  const fields = {
    initialRequest: `对比合成行业，输出研究报告。${'背景材料。'.repeat(120)}`,
    userTurns: ['限制为已有材料，不编造新事实。'],
    phase: 'draft' as const,
    workflow: {
      id: 'synthetic-fixed-report',
      sections: [{ id: 'result', title: '最终调研结论', required: true, sourceAnnotation: true }],
    },
    referencePlan: null,
    ...overrides,
  };
  const {
    materials = [
      {
        kind: 'text' as const,
        source: 'file' as const,
        key: 'file:synthetic',
        text: '合成材料：只有甲和乙两种输入。',
      },
    ],
    schemaVersion: _schema,
    executionId: _id,
    executionRevision: _revision,
    ...requirements
  } = fields;
  const admission = prepareCoreAdmission({
    scope: { taskId: 'core_wait_synthetic', userId: 7 },
    before: { status: 'executing', executionId: null, executionRevision: 0, recordVersion: 0 },
    requirements: { ...requirements, fileIds: ['synthetic_file'] },
  });
  const context = createTaskVerificationContext({
    schemaVersion: 1,
    executionId: admission.executionId,
    executionRevision: 1,
    ...requirements,
    materials,
  });
  const registry = new CoreExecutionRegistry();
  const handle = registry.begin({
    taskId: admission.scope.taskId,
    expertMode: 'expert',
    verificationContext: context,
  });
  return { admission, context, registry, handle };
}

// Only external model transport is replaced. All generation, verification and
// settlement validation code is real; this is not a database/production test.
function transports(
  text = PLAN,
  semanticReply = '{"status":"pass","issues":[]}',
  onSemantic?: () => void,
  sourceUrls: string[] = [],
) {
  const generation: NeutralResponsesRequest[] = [];
  const semantic: NeutralMessagesRequest[] = [];
  const responses: ResponsesAdapter = {
    metadata: { ...metadata, model: 'qwen3.8-plus', protocol: 'responses' },
    async stream(request) {
      generation.push(request);
      return {
        id: 'synthetic_generation',
        metadata: this.metadata,
        text,
        status: 'completed',
        sources: sourceUrls.map((url) => ({
          url,
          title: '合成参考',
          provenance: 'web_search' as const,
        })),
        usage: { inputTokens: 10, outputTokens: 20 },
      };
    },
  };
  const messages: MessagesAdapter = {
    metadata: { ...metadata, model: 'qwen3.8-flash', protocol: 'messages' },
    async create(request) {
      semantic.push(request);
      onSemantic?.();
      return {
        id: 'synthetic_review',
        metadata: this.metadata,
        content: [{ type: 'text', text: semanticReply }],
        stopReason: 'end_turn',
        usage: {
          inputTokens: 10,
          outputTokens: 10,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
  return { responses, messages, generation, semantic };
}

async function generate(f: ReturnType<typeof fixture>, t: ReturnType<typeof transports>) {
  return runGenerateTask({
    taskId: f.handle.taskId,
    userId: 'synthetic',
    intent: '废弃摘要',
    verificationContext: f.context,
    logger,
    responsesAdapter: t.responses,
  });
}
async function review(
  f: ReturnType<typeof fixture>,
  t: ReturnType<typeof transports>,
  outcome: ReviewableGenerateOutcome,
) {
  return reviewGenerateOutcome({
    taskId: f.handle.taskId,
    intent: '废弃摘要',
    outcome,
    semanticAdapter: t.messages,
    logger,
    coreExecution: { registry: f.registry, handle: f.handle },
  });
}
function settle(f: ReturnType<typeof fixture>, r: Awaited<ReturnType<typeof review>>) {
  if (!r.verification || !r.outcome.generation) throw new Error('missing core review');
  const common = {
    admission: f.admission,
    generation: r.outcome.generation,
    verification: r.verification,
    sourceTrust: r.sourceTrust,
  };
  return r.terminalStatus === 'awaiting_user'
    ? prepareCoreSettlement({
        ...common,
        status: 'awaiting_user',
        result: {
          question: r.outcome.summary,
          ...(f.context.phase === 'draft' || f.context.phase === 'revise'
            ? { planText: r.outcome.summary }
            : {}),
        },
      })
    : prepareCoreSettlement({
        ...common,
        status: 'failed',
        result: { reason: r.outcome.reason ?? '' },
      });
}

beforeEach(() =>
  setFeatureFlagsForTest({
    EVIDENCE_LEDGER: true,
    EXECUTION_CONTRACT: true,
    EXECUTION_VERIFIER: true,
    EXPERT_WORKFLOW: true,
  }),
);
afterEach(() => reloadFeatureFlagsForTest());

describe('core intermediate output review', () => {
  it.each([
    ['known question', '请确认您提供的转化率18%是否准确？', 'awaiting_user'],
    ['new number', '请确认您提供的转化率25%是否准确？', 'failed'],
    ['assertion', '您提供的转化率18%已经证明是准确的。', 'failed'],
    ['mixed assertion', '平均收益将提高3倍。请确认您提供的转化率18%是否准确？', 'failed'],
    ['wrong metric', '请确认您提供的市场增长率18%是否准确？', 'failed'],
  ])('distinguishes grounded input clarification from %s', async (_label, text, status) => {
    const f = fixture({
      phase: 'direct',
      workflow: null,
      initialRequest: '核对合成指标：转化率=18%。',
      userTurns: [],
    });
    const t = transports(`[AWAITING_USER_INPUT]${text}`);
    const r = await review(f, t, await generate(f, t));
    expect(r.terminalStatus).toBe(status);
    expect(settle(f, r).status).toBe(status);
    expect(t.semantic).toHaveLength(status === 'awaiting_user' ? 1 : 0);
  });

  it.each(['plan', 'clarification'] as const)(
    'rejects %s beyond its atomic waiting storage budget before semantic review',
    async (kind) => {
      const f = fixture({ phase: kind === 'plan' ? 'draft' : 'direct', workflow: null });
      // P2 duplicates a plan into question + planText (96 KiB combined); a
      // clarification occupies one existing 65,535-byte TEXT column.
      const text =
        kind === 'plan'
          ? `1. ${'合'.repeat(17_000)}`
          : `[AWAITING_USER_INPUT]${'问'.repeat(22_000)}`;
      const t = transports(text);
      const r = await review(f, t, await generate(f, t));
      expect(r.terminalStatus).toBe('failed');
      expect(r.verification?.inputCoverage).toEqual({
        complete: false,
        codes: ['VERIFICATION_INPUT_LIMIT'],
      });
      expect(t.semantic).toHaveLength(0);
      expect(settle(f, r).verification.issueCodes).toContain('VERIFICATION_INPUT_LIMIT');
    },
  );

  it.each([
    { completeness: 'partial', stopReason: 'timeout' },
    { completeness: 'complete', stopReason: 'end_turn' },
    { completeness: 'complete', stopReason: 'awaiting_user', injected: true },
  ])('refuses contradictory waiting generation metadata %j', async (generation) => {
    const f = fixture();
    const t = transports();
    const outcome = await generate(f, t);
    await expect(
      review(f, t, {
        ...outcome,
        generation: generation as NonNullable<ReviewableGenerateOutcome['generation']>,
      }),
    ).rejects.toThrow('VERIFICATION_CONTEXT_INVALID');
    expect(t.semantic).toHaveLength(0);
  });

  it('checks a real typed intake question even when no generation model was needed', async () => {
    const f = fixture({
      phase: 'direct',
      initialRequest: '帮我复盘这场抖音直播',
      userTurns: [],
      workflow: { id: 'douyin-review', sections: [] },
    });
    const t = transports();
    const outcome = await generate(f, t);
    expect(outcome.status).toBe('awaiting_user');
    expect(t.generation).toHaveLength(0);
    const r = await review(f, t, outcome);
    expect(settle(f, r).status).toBe('awaiting_user');
    expect(t.semantic).toHaveLength(1);
  });

  it('does not weaken final workflow checks when intermediate review is available', async () => {
    const f = fixture({ phase: 'direct', initialRequest: '请整理完整合成报告', userTurns: [] });
    const t = transports(PLAN.repeat(8));
    const r = await review(f, t, await generate(f, t));
    expect(r.terminalStatus).not.toBe('completed');
    expect(
      r.verification?.checks.some(
        (check) => !check.passed && check.criterionId.includes('section'),
      ),
    ).toBe(true);
    expect(settle(f, r).verification.issueCodes).toContain('DETERMINISTIC_CHECK_FAILED');
  });

  it('keeps provider URL-only evidence when the real runner asks for clarification', async () => {
    const f = fixture({ phase: 'direct', workflow: null });
    const t = transports(
      '[AWAITING_USER_INPUT]这是合成参考 https://example.com/synthetic ，请确认您需要核对的对象。',
      undefined,
      undefined,
      ['https://example.com/synthetic'],
    );
    const outcome = await generate(f, t);
    expect(outcome.sourceUrls).toEqual(['https://example.com/synthetic']);
    const r = await review(f, t, outcome);
    expect(settle(f, r).verification.issueCodes).toContain('VERIFICATION_MATERIALS_INCOMPLETE');
    expect(t.semantic).toHaveLength(0);
  });

  it.each(['draft', 'revise'] as const)(
    'verifies and prepares an atomic %s without demanding the final report',
    async (phase) => {
      const f = fixture({ phase });
      const t = transports();
      const r = await review(f, t, await generate(f, t));
      expect(r.verification).toMatchObject({
        executionId: f.admission.executionId,
        executionRevision: 1,
        passed: true,
        semanticStatus: 'pass',
        inputCoverage: { complete: true },
      });
      expect(r.terminalStatus).toBe('awaiting_user');
      const payload = JSON.parse(t.semantic[0]?.messages[0]?.content as string);
      expect(payload.deliveryStage).toBe('plan');
      expect(payload.context.initialRequest).toBe(f.context.initialRequest);
      expect(payload.context.userTurns).toEqual(['限制为已有材料，不编造新事实。']);
      expect(payload.context.workflow.sections[0].title).toBe('最终调研结论');
      expect(payload.context.materials[0].text).toBe('合成材料：只有甲和乙两种输入。');
      expect(payload.answerDraft).toBe(r.outcome.summary);
      expect(JSON.stringify(t.semantic[0])).not.toContain('废弃摘要');
      expect(settle(f, r)).toMatchObject({
        status: 'awaiting_user',
        verificationPassed: true,
        verification: { semanticStatus: 'pass' },
        result: { planText: r.outcome.summary },
      });
      expect(f.registry.read(f.handle)?.contract.outputRequirement?.kind).toBe('comparison');
    },
  );

  it('reviews a concise clarification instead of requiring a complete report', async () => {
    const f = fixture({ phase: 'direct', workflow: null });
    const t = transports('[AWAITING_USER_INPUT]请提供行业范围？');
    const r = await review(f, t, await generate(f, t));
    expect(r.verification).toMatchObject({ passed: true, semanticStatus: 'pass' });
    expect(JSON.parse(t.semantic[0]?.messages[0]?.content as string).deliveryStage).toBe(
      'clarification',
    );
    expect(settle(f, r).awaitingQuestion).toBe('请提供行业范围？');
  });

  it('allows asking about inconsistent input without certifying it as a final numeric result', async () => {
    const f = fixture({
      phase: 'direct',
      workflow: null,
      initialRequest: '分析合成材料：GMV=100000，订单数=1000，客单价=20。',
      userTurns: [],
    });
    const t = transports(
      '[AWAITING_USER_INPUT]提供的成交额与订单、客单价计算不一致，请确认哪一项需要更正？',
    );
    const r = await review(f, t, await generate(f, t));
    expect(r.verification).toMatchObject({ semanticStatus: 'pass' });
    expect(settle(f, r).status).toBe('awaiting_user');
    expect(JSON.stringify(t.semantic[0])).toContain('GMV=100000');
  });

  it('does not certify a model-rejected plan or retain its text in failed settlement', async () => {
    const f = fixture();
    const t = transports(
      PLAN,
      '{"status":"reject","issues":[{"code":"UNSUPPORTED_CONCLUSION","fixable":false,"summary":"SYNTHETIC_PRIVATE_REASON"}]}',
    );
    const r = await review(f, t, await generate(f, t));
    expect(r.terminalStatus).toBe('failed');
    expect(r.verification?.semanticStatus).toBe('reject');
    const op = settle(f, r);
    expect(op.verification.issueCodes).toContain('UNSUPPORTED_CONCLUSION');
    expect(JSON.stringify(op)).not.toContain(PLAN);
    expect(JSON.stringify(op)).not.toContain('SYNTHETIC_PRIVATE_REASON');
  });

  it('keeps semantic unavailability explicit while preserving the existing waiting policy', async () => {
    const f = fixture();
    const t = transports(PLAN, 'invalid response');
    const r = await review(f, t, await generate(f, t));
    expect(settle(f, r).verification.semanticStatus).toBe('unavailable');
    expect(r.terminalStatus).toBe('awaiting_user');
  });

  it.each([
    ['unobserved URL', `${PLAN}\n来源：https://unobserved.example/synthetic`],
    ['nonexistent file', `${PLAN}\nPDF已生成：synthetic.pdf，点击下载。`],
    ['unsupported expert claim', `${PLAN}\n行业平均转化率为18%，预计收入提高3倍。`],
    ['empty question', '[AWAITING_USER_INPUT]...'],
  ])('does not skip deterministic safety for %s', async (_label, text) => {
    const f = fixture({ phase: 'direct', workflow: null });
    const t = transports(
      text.startsWith('[AWAITING_USER_INPUT]') ? text : `[AWAITING_USER_INPUT]${text}`,
    );
    const r = await review(f, t, await generate(f, t));
    expect(r.terminalStatus).toBe('failed');
    expect(r.verification?.passed).toBe(false);
    expect(t.semantic).toHaveLength(0);
    expect(settle(f, r).verificationPassed).toBe(false);
  });

  it('retains missing-material coverage and refuses unverified waiting content', async () => {
    const f = fixture({
      materials: [
        { kind: 'unavailable', key: 'file:synthetic', source: 'file', reason: 'non_text' },
      ],
    });
    const t = transports();
    const r = await review(f, t, await generate(f, t));
    expect(r.terminalStatus).toBe('failed');
    expect(settle(f, r).verification.issueCodes).toContain('VERIFICATION_MATERIALS_INCOMPLETE');
    expect(t.semantic).toHaveLength(0);
  });

  it.each(['released', 'superseded', 'flag_disabled'] as const)(
    'rejects %s ownership during waiting semantic review',
    async (change) => {
      const f = fixture();
      const t = transports(PLAN, '{"status":"pass","issues":[]}', () => {
        if (change === 'released') f.registry.release(f.handle);
        if (change === 'superseded')
          f.registry.begin({
            taskId: f.handle.taskId,
            verificationContext: {
              ...f.context,
              executionId: 'synthetic_newer',
              executionRevision: 2,
            },
          });
        if (change === 'flag_disabled') setFeatureFlagsForTest({ EXECUTION_VERIFIER: false });
      });
      const r = await review(f, t, await generate(f, t));
      expect(r.terminalStatus).toBe('failed');
      expect(r.outcome.summary).toBe('');
      expect(settle(f, r).verification.issueCodes).toContain('VERIFICATION_CONTEXT_INVALID');
      expect(r.verification).toMatchObject({
        executionId: f.admission.executionId,
        executionRevision: 1,
      });
      if (change === 'superseded') expect(f.registry.release(f.handle)).toBe(false);
    },
  );

  it('makes a failed generation persistable without sending rejected body or reason to semantic review', async () => {
    const f = fixture();
    const t = transports('');
    const outcome = await generate(f, t);
    expect(outcome.status).toBe('failed');
    const r = await review(f, t, {
      ...outcome,
      summary: 'SYNTHETIC_REJECTED_BODY',
      reason: 'SYNTHETIC_PRIVATE_REASON',
    });
    expect(r.verification).toMatchObject({
      passed: false,
      semanticStatus: 'unavailable',
      executionId: f.admission.executionId,
      executionRevision: 1,
    });
    expect(t.semantic).toHaveLength(0);
    expect(r.outcome.summary).toBe('');
    const op = settle(f, r);
    expect(op.verification.issueCodes).toContain('GENERATION_INCOMPLETE');
    expect(op.verification.issueCodes).not.toContain('DETERMINISTIC_CHECK_FAILED');
    expect(op.result.reason).toBe('生成未完成，请稍后重试');
    expect(JSON.stringify(op)).not.toContain('SYNTHETIC_REJECTED_BODY');
    expect(JSON.stringify(op)).not.toContain('SYNTHETIC_PRIVATE_REASON');
  });
});
