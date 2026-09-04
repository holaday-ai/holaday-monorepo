import { describe, expect, it, vi } from 'vitest';

import type {
  MessagesAdapter,
  NeutralMessagesRequest,
  NeutralMessagesRequestOptions,
} from '../llm/messages-adapter.js';
import type { VerificationResult } from './answer-verifier.js';
import { EvidenceLedger } from './evidence-ledger.js';
import { buildContract } from './execution-contract.js';
import {
  DEFAULT_LLM_VERIFIER_TIMEOUT_MS,
  MAX_SAFE_VERIFIER_SUMMARY_CHARS,
  buildUserPayload,
  mergeDeterministicAndSemantic,
  shouldRunLlmVerifier,
  verifyWithLlm,
} from './llm-verifier.js';

const QWEN_METADATA = {
  provider: 'alibaba-model-studio' as const,
  model: 'qwen3.8-flash',
  region: 'intl' as const,
  deploymentScope: 'international' as const,
  endpointKind: 'public' as const,
  protocol: 'messages' as const,
};

function makeAdapter(
  input: {
    text?: string;
    rejectWith?: Error;
    hang?: boolean;
  } = {},
): { adapter: MessagesAdapter; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(
    async (_request: NeutralMessagesRequest, options?: NeutralMessagesRequestOptions) => {
      if (input.hang) {
        return new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            const error = new Error('PRIVATE_PROVIDER_TIMEOUT_BODY');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }
      if (input.rejectWith) throw input.rejectWith;
      return {
        id: 'msg_test',
        metadata: QWEN_METADATA,
        content: [
          {
            type: 'text' as const,
            text: input.text ?? '{"status":"pass","issues":[]}',
          },
        ],
        stopReason: 'end_turn' as const,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  );
  return { adapter: { metadata: QWEN_METADATA, create }, create };
}

function verifierFixture() {
  const contract = buildContract({
    taskId: 'tsk_semantic',
    intent: '分析这份材料并给出结论',
    executionMode: 'generate',
    expertMode: 'expert',
  });
  const ledger = new EvidenceLedger(contract.taskId);
  ledger.add({
    fact: '用户提供了合成测试材料',
    sourceType: 'user_input',
    sourceDetail: 'fixture',
    confidence: 'observed',
  });
  return { contract, ledger, answerText: '这是一份合成测试结论。'.repeat(30) };
}

const DETERMINISTIC_PASS: VerificationResult = {
  taskId: 'tsk_merge',
  passed: true,
  tier: 'deterministic',
  checks: [
    {
      criterionId: 'det.structure',
      passed: true,
      checker: 'deterministic',
      detail: 'structure ok',
    },
  ],
};

const DETERMINISTIC_FAIL: VerificationResult = {
  taskId: 'tsk_merge',
  passed: false,
  tier: 'deterministic',
  checks: [
    {
      criterionId: 'det.source',
      passed: false,
      checker: 'deterministic',
      detail: 'source missing',
      severity: 'hard_fail',
    },
  ],
  failureLevel: 'hard_fail',
};

describe('shouldRunLlmVerifier', () => {
  it('runs only for a deterministic pass on a full contract', () => {
    const { contract } = verifierFixture();
    expect(shouldRunLlmVerifier(DETERMINISTIC_PASS, contract)).toBe(true);
    expect(shouldRunLlmVerifier(DETERMINISTIC_FAIL, contract)).toBe(false);
  });
});

describe('verifyWithLlm', () => {
  it('uses the neutral Qwen Messages request without exposing a legacy model name', async () => {
    const fixture = verifierFixture();
    const { adapter, create } = makeAdapter();

    await expect(verifyWithLlm({ ...fixture, adapter })).resolves.toEqual({
      status: 'pass',
      issues: [],
    });

    const request = create.mock.calls[0]?.[0] as NeutralMessagesRequest;
    const options = create.mock.calls[0]?.[1] as NeutralMessagesRequestOptions;
    expect(request).toMatchObject({
      maxTokens: 768,
      temperature: 0,
      thinking: { type: 'disabled' },
    });
    expect(JSON.stringify(request)).not.toMatch(/claude|anthropic|openai/i);
    expect(options.timeoutMs).toBe(DEFAULT_LLM_VERIFIER_TIMEOUT_MS);
    expect(options.maxRetries).toBe(0);
  });

  it('uses a safe fixed summary instead of model-authored text', async () => {
    const fixture = verifierFixture();
    const { adapter } = makeAdapter({
      text: JSON.stringify({
        status: 'warn',
        issues: [
          {
            code: 'AMBIGUOUS_EVIDENCE',
            fixable: true,
            summary: `PRIVATE_USER_TEXT${'x'.repeat(400)}`,
          },
        ],
      }),
    });

    const result = await verifyWithLlm({ ...fixture, adapter });
    expect(result.status).toBe('warn');
    expect(result.issues[0]).toEqual({
      code: 'AMBIGUOUS_EVIDENCE',
      fixable: true,
      summary: '关键证据关系不明确。',
    });
    expect(result.issues[0]?.summary.length).toBeLessThanOrEqual(MAX_SAFE_VERIFIER_SUMMARY_CHARS);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_USER_TEXT');
  });

  it.each([
    ['missing_region', null],
    ['invalid_json', makeAdapter({ text: 'PRIVATE_USER_TEXT not-json' }).adapter],
    ['provider_error', makeAdapter({ rejectWith: new Error('PRIVATE_PROVIDER_BODY') }).adapter],
  ])('reports %s as unavailable without raw details', async (_case, adapter) => {
    const result = await verifyWithLlm({ ...verifierFixture(), adapter });
    expect(result).toEqual({ status: 'unavailable', issues: [] });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_/);
  });

  it('reports timeout as unavailable even if the adapter does not settle', async () => {
    const { adapter } = makeAdapter({ hang: true });
    const startedAt = Date.now();
    const result = await verifyWithLlm({
      ...verifierFixture(),
      adapter,
      timeoutMs: 30,
    });
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(result).toEqual({ status: 'unavailable', issues: [] });
  });

  it('rejects unknown issue codes and inconsistent pass payloads', async () => {
    const unknown = makeAdapter({
      text: '{"status":"reject","issues":[{"code":"PRIVATE_CODE","fixable":false,"summary":"x"}]}',
    }).adapter;
    const passWithIssue = makeAdapter({
      text: '{"status":"pass","issues":[{"code":"IRRELEVANT_OUTPUT","fixable":true,"summary":"x"}]}',
    }).adapter;
    await expect(verifyWithLlm({ ...verifierFixture(), adapter: unknown })).resolves.toEqual({
      status: 'unavailable',
      issues: [],
    });
    await expect(verifyWithLlm({ ...verifierFixture(), adapter: passWithIssue })).resolves.toEqual({
      status: 'unavailable',
      issues: [],
    });
  });

  it('keeps the outbound answer bounded', () => {
    const fixture = verifierFixture();
    const payload = JSON.parse(
      buildUserPayload({ ...fixture, answerText: 'a'.repeat(10_000) }),
    ) as { answerDraft: string };
    expect(payload.answerDraft.length).toBeLessThan(2_100);
  });
});

describe('mergeDeterministicAndSemantic', () => {
  it('never upgrades a deterministic failure', () => {
    const merged = mergeDeterministicAndSemantic(DETERMINISTIC_FAIL, {
      status: 'pass',
      issues: [],
    });
    expect(merged.passed).toBe(false);
    expect(merged.failureLevel).toBe(DETERMINISTIC_FAIL.failureLevel);
  });

  it('keeps deterministic pass/fail unchanged when semantic review is unavailable', () => {
    const merged = mergeDeterministicAndSemantic(DETERMINISTIC_PASS, {
      status: 'unavailable',
      issues: [],
    });
    expect(merged.passed).toBe(true);
    expect(merged.tier).toBe('deterministic');
    expect(merged.semanticStatus).toBe('unavailable');
  });

  it('can warn without rejecting and can only tighten a pass into reject', () => {
    const warn = mergeDeterministicAndSemantic(DETERMINISTIC_PASS, {
      status: 'warn',
      issues: [
        {
          code: 'AMBIGUOUS_EVIDENCE',
          fixable: true,
          summary: '关键证据关系不明确。',
        },
      ],
    });
    expect(warn.passed).toBe(true);
    expect(warn.semanticStatus).toBe('warn');

    const reject = mergeDeterministicAndSemantic(DETERMINISTIC_PASS, {
      status: 'reject',
      issues: [
        {
          code: 'UNSUPPORTED_CONCLUSION',
          fixable: false,
          summary: '结论缺少足够材料支持。',
        },
      ],
    });
    expect(reject.passed).toBe(false);
    expect(reject.failureLevel).toBe('needs_clarification');
  });
});
