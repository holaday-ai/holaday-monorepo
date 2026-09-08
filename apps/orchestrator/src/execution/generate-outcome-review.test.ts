import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGenerateTask } from '../agent/generate-runner.js';
import type { ResponsesAdapter } from '../llm/responses-adapter.js';

import { _resetLedgerRegistryForTest, getLedger } from './evidence-ledger.js';
import {
  _resetExecutionPipelineForTest,
  initExecution,
  recordEvidence,
} from './execution-pipeline.js';
import { reloadFeatureFlagsForTest, setFeatureFlagsForTest } from './feature-flags.js';
import { reviewGenerateOutcome } from './generate-outcome-review.js';

const completedOutcome = (summary: string, sourceUrls?: ReadonlyArray<string>) => ({
  status: 'completed' as const,
  summary,
  ...(sourceUrls ? { sourceUrls } : {}),
  inputTokens: 10,
  outputTokens: 20,
  durationMs: 30,
});

describe('reviewGenerateOutcome', () => {
  beforeEach(() => {
    _resetLedgerRegistryForTest();
    _resetExecutionPipelineForTest();
    setFeatureFlagsForTest({
      EVIDENCE_LEDGER: false,
      EXECUTION_CONTRACT: false,
      EXECUTION_VERIFIER: false,
    });
  });

  afterEach(() => reloadFeatureFlagsForTest());

  it('caps an explicit partial generation even without a visible truncation notice', async () => {
    const reviewed = await reviewGenerateOutcome({
      taskId: 'tsk_generation_partial',
      intent: '解释这个概念',
      outcome: {
        ...completedOutcome('合成解释。'.repeat(40)),
        generation: { completeness: 'partial', stopReason: 'timeout' },
      },
    });
    expect(reviewed.terminalStatus).toBe('partial_success');
    expect(reviewed.failedChecks).toContainEqual({
      type: 'GENERATION_INCOMPLETE',
      detail: '生成未完整结束，当前内容为部分草稿。',
    });
    expect(reviewed.outcome.generation).toEqual({ completeness: 'partial', stopReason: 'timeout' });
  });

  it('does not infer partial generation from words in a complete answer', async () => {
    const reviewed = await reviewGenerateOutcome({
      taskId: 'tsk_generation_complete',
      intent: '解释截断的意思',
      outcome: {
        ...completedOutcome('截断是指内容未完整显示。'),
        generation: { completeness: 'complete', stopReason: 'end_turn' },
      },
    });
    expect(reviewed.terminalStatus).toBe('completed');
  });

  it('does not weaken a deterministic hard failure because generation was partial', async () => {
    setFeatureFlagsForTest({
      EVIDENCE_LEDGER: true,
      EXECUTION_CONTRACT: true,
      EXECUTION_VERIFIER: true,
    });
    const taskId = 'tsk_partial_hard_failure';
    initExecution({
      taskId,
      intent: '解释概念',
      executionMode: 'generate',
      constraints: ['no_form_submit'],
    });
    recordEvidence(taskId, {
      fact: 'submitted form on /synthetic',
      sourceType: 'tool_result',
      sourceDetail: 'synthetic',
      confidence: 'observed',
    });
    const reviewed = await reviewGenerateOutcome({
      taskId,
      intent: '解释概念',
      outcome: {
        ...completedOutcome('合成解释。'.repeat(40)),
        generation: { completeness: 'partial', stopReason: 'continuation_failed' },
      },
    });
    expect(reviewed.verification?.failureLevel).toBe('hard_fail');
    expect(reviewed.terminalStatus).toBe('failed');
  });

  it('carries a real runner continuation-limit result through the real review', async () => {
    const metadata = {
      provider: 'alibaba-model-studio' as const,
      region: 'cn' as const,
      deploymentScope: 'china_mainland' as const,
      model: 'qwen3.8-plus',
      endpointKind: 'public' as const,
      protocol: 'responses' as const,
    };
    const adapter: ResponsesAdapter = {
      metadata,
      stream: vi.fn(async () => ({
        id: 'synthetic',
        metadata,
        text: '合成草稿。',
        sources: [],
        usage: { inputTokens: 1, outputTokens: 2 },
        status: 'incomplete' as const,
        incompleteReason: 'max_output_tokens' as const,
      })),
    };
    const outcome = await runGenerateTask({
      taskId: 'tsk_real_partial',
      userId: 'synthetic',
      intent: '写一份合成策划报告',
      responsesAdapter: adapter,
      logger: pino({ level: 'silent' }),
    });
    const reviewed = await reviewGenerateOutcome({
      taskId: 'tsk_real_partial',
      intent: '写一份合成策划报告',
      outcome,
    });
    expect(reviewed.outcome.summary).toContain('合成草稿。合成草稿。合成草稿。');
    expect(reviewed.outcome.generation).toEqual({
      completeness: 'partial',
      stopReason: 'continuation_limit',
    });
    expect(reviewed.terminalStatus).toBe('partial_success');
    expect(adapter.stream).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])(
    'still rejects incomplete real product rows when verifier=%s',
    async (enabled) => {
      setFeatureFlagsForTest({
        EVIDENCE_LEDGER: enabled,
        EXECUTION_CONTRACT: enabled,
        EXECUTION_VERIFIER: enabled,
      });
      const taskId = 'synthetic_product_review';
      const intent = '不采购，只整理3款京东商品的名称、价格和链接';
      initExecution({
        taskId,
        intent,
        executionMode: 'generate',
        expertWorkflowId: 'content-topic',
      });
      const reviewed = await reviewGenerateOutcome({
        taskId,
        intent,
        outcome: completedOutcome('三款商品分别是便签、笔筒和文件夹，没有提供价格和商品链接。'),
      });
      expect(reviewed.terminalStatus).not.toBe('completed');
      expect(reviewed.failedChecks).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'ecommerce_rows' })]),
      );
    },
  );

  it('applies the always-on source gate after a generate task resumes', async () => {
    const reviewed = await reviewGenerateOutcome({
      taskId: 'tsk_resume_source',
      intent: '研究三家 SaaS 产品并给出来源链接',
      outcome: completedOutcome('A 产品最值得采用。'),
    });

    expect(reviewed.terminalStatus).toBe('partial_success');
    expect(reviewed.failedChecks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'source_count' })]),
    );
  });

  it('sanitises leaked tool markup before verification and persistence', async () => {
    const reviewed = await reviewGenerateOutcome({
      taskId: 'tsk_resume_clean',
      intent: '把这句话改写得更自然',
      outcome: completedOutcome('改写结果。<tool_use>{"name":"x"}</tool_use>'),
    });

    expect(reviewed.outcome.summary).toBe('改写结果。');
    expect(reviewed.terminalStatus).toBe('completed');
  });

  it('keeps the expert verification contract active after clarification', async () => {
    setFeatureFlagsForTest({
      EVIDENCE_LEDGER: true,
      EXECUTION_CONTRACT: true,
      EXECUTION_VERIFIER: true,
    });
    initExecution({
      taskId: 'tsk_resume_expert',
      intent: '给 SaaS landing page 优化建议',
      executionMode: 'generate',
      expertMode: 'expert',
    });

    const reviewed = await reviewGenerateOutcome({
      taskId: 'tsk_resume_expert',
      intent: '给 SaaS landing page 优化建议',
      outcome: completedOutcome('行业平均转化率是 8%，应直接采用。'),
    });

    expect(reviewed.terminalStatus).toBe('failed');
    expect(reviewed.failedChecks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'expert_claim_provenance' })]),
    );
  });

  it('grounds provider-returned search URLs before verifying a fresh research answer', async () => {
    setFeatureFlagsForTest({
      EVIDENCE_LEDGER: true,
      EXECUTION_CONTRACT: true,
      EXECUTION_VERIFIER: true,
    });
    initExecution({
      taskId: 'tsk_generate_search_source',
      intent: '2026年5月最新的AI行业新闻是什么',
      executionMode: 'generate',
    });

    const sourceUrl = 'https://example.com/latest-ai-news';
    const reviewed = await reviewGenerateOutcome({
      taskId: 'tsk_generate_search_source',
      intent: '2026年5月最新的AI行业新闻是什么',
      outcome: completedOutcome(
        `AI 行业新闻摘要。\n\n### 检索来源（请核对）\n- [行业报道](<${sourceUrl}>)`,
        [sourceUrl],
      ),
    });

    expect(getLedger('tsk_generate_search_source')?.getGroundedUrls()).toContain(sourceUrl);
    expect(reviewed.terminalStatus).toBe('completed');
    expect(reviewed.failedChecks).toEqual([]);
  });
});
