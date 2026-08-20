import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _resetLedgerRegistryForTest, getLedger } from './evidence-ledger.js';
import { _resetExecutionPipelineForTest, initExecution } from './execution-pipeline.js';
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
