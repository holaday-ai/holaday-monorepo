import { describe, expect, it } from 'vitest';
import type { VerificationResult } from '../execution/answer-verifier.js';
import { deriveFinalStatus } from '../execution/execution-pipeline.js';
import { prepareCoreAdmission } from './core-task-admission.js';
import * as settlement from './core-task-settlement.js';

function input() {
  const admission = prepareCoreAdmission({
    scope: { taskId: 'tsk_synthetic', userId: 7 },
    before: { status: 'executing', executionId: null, executionRevision: 0, recordVersion: 0 },
    requirements: {
      initialRequest: '整理合成资料',
      userTurns: [],
      phase: 'direct',
      workflow: null,
      referencePlan: null,
      fileIds: [],
    },
  });
  const verification: VerificationResult = {
    taskId: admission.scope.taskId,
    executionId: admission.executionId,
    executionRevision: admission.executionRevision,
    passed: true,
    tier: 'llm',
    semanticStatus: 'pass',
    inputCoverage: { complete: true, codes: [] },
    checks: [],
  };
  return {
    admission,
    status: 'completed' as const,
    result: { summary: '合成结果' },
    generation: { completeness: 'complete' as const, stopReason: 'end_turn' as const },
    verification,
  };
}

describe('core settlement preparation', () => {
  it('does not preserve a source-blocked draft when a fixable verifier failure masks source blocking in legacy status logic', () => {
    const original = input();
    original.verification.passed = false;
    original.verification.failureLevel = 'fixable';
    original.verification.checks = [
      {
        criterionId: 'synthetic',
        criterionType: 'url_grounding',
        checker: 'deterministic',
        passed: false,
        severity: 'fixable',
        detail: '合成失败',
      },
    ];
    const sourceTrust = {
      requiresReview: true,
      blocking: true,
      failedChecks: [{ type: 'ecommerce_rows', detail: '合成阻断' }],
    };
    // Legacy precedence masks this combination; the core hard-failure contract must not.
    expect(deriveFinalStatus('completed', original.verification, sourceTrust)).toBe(
      'partial_success',
    );
    expect(() =>
      settlement.prepareCoreSettlement({ ...original, status: 'partial_success', sourceTrust }),
    ).toThrow('CORE_SETTLEMENT_INVALID');
  });
  it.each(['ecommerce_rows', 'result_count', 'url_count'])(
    'cannot persist a draft that existing structural gate rejects: %s',
    (criterionType) => {
      const original = input();
      original.verification.passed = false;
      original.verification.failureLevel = 'fixable';
      original.verification.checks = [
        {
          criterionId: 'synthetic',
          criterionType,
          passed: false,
          checker: 'deterministic',
          severity: 'fixable',
          detail: '合成结构失败',
        },
      ];
      expect(deriveFinalStatus('completed', original.verification)).toBe('failed');
      expect(() =>
        settlement.prepareCoreSettlement({ ...original, status: 'partial_success' }),
      ).toThrow('CORE_SETTLEMENT_INVALID');
    },
  );

  it('preserves the existing non-blocking URL source exception with explicit source review', () => {
    const original = input();
    original.verification.passed = false;
    original.verification.failureLevel = 'fixable';
    original.verification.checks = [
      {
        criterionId: 'synthetic',
        criterionType: 'url_count',
        passed: false,
        checker: 'deterministic',
        severity: 'fixable',
        detail: '合成来源不足',
      },
    ];
    const sourceTrust = {
      requiresReview: true,
      blocking: false,
      failedChecks: [{ type: 'source_count', detail: 'SYNTHETIC_PRIVATE_SOURCE_DETAIL' }],
    };
    expect(deriveFinalStatus('completed', original.verification, sourceTrust)).toBe(
      'partial_success',
    );
    const op = settlement.prepareCoreSettlement({
      ...original,
      status: 'partial_success',
      sourceTrust,
    });
    expect(op.result.summary).toBe('合成结果');
    expect(op.verification.issueCodes).toContain('SOURCE_TRUST_FAILED');
    expect(JSON.stringify(op)).not.toContain('SYNTHETIC_PRIVATE_SOURCE_DETAIL');
  });

  it('cannot complete a result that the source review requires to remain partial', () => {
    const original = input();
    const sourceTrust = {
      requiresReview: true,
      blocking: false,
      failedChecks: [{ type: 'source_count', detail: '合成来源不足' }],
    };
    expect(() => settlement.prepareCoreSettlement({ ...original, sourceTrust })).toThrow(
      'CORE_SETTLEMENT_INVALID',
    );
    const op = settlement.prepareCoreSettlement({
      ...original,
      status: 'partial_success',
      sourceTrust,
    });
    expect(op.verificationPassed).toBe(false);
    expect(op.verification.failureLevel).toBe('fixable');
  });

  it('does not retain a source-blocked candidate and records a fixed quality failure', () => {
    const original = input();
    const sourceTrust = {
      requiresReview: true,
      blocking: true,
      failedChecks: [{ type: 'ecommerce_rows', detail: 'SYNTHETIC_PRIVATE_SOURCE_DETAIL' }],
    };
    expect(() =>
      settlement.prepareCoreSettlement({ ...original, status: 'partial_success', sourceTrust }),
    ).toThrow('CORE_SETTLEMENT_INVALID');
    const op = settlement.prepareCoreSettlement({
      ...original,
      status: 'failed',
      sourceTrust,
      result: { reason: 'SYNTHETIC_PRIVATE_SOURCE_DETAIL' },
    });
    expect(op.result).toEqual({ tickCount: 1, reason: '质量校验未通过' });
    expect(op.verification.failureLevel).toBe('hard_fail');
    expect(op.verification.issueCodes).toContain('SOURCE_TRUST_FAILED');
  });

  it.each(['question', 'planText'])(
    'rejects an awaiting %s beyond MySQL TEXT capacity without truncation',
    (field) => {
      const original = input();
      expect(() =>
        settlement.prepareCoreSettlement({
          ...original,
          status: 'awaiting_user',
          generation: { completeness: 'complete', stopReason: 'awaiting_user' },
          result: { question: '合成问题', [field]: '界'.repeat(21_846) },
        }),
      ).toThrow('CORE_SETTLEMENT_INVALID');
    },
  );

  it('retains a complete answer at the 96 KiB JSON body boundary', () => {
    const original = input();
    const summary = '界'.repeat(32_768);
    expect(
      settlement.prepareCoreSettlement({ ...original, result: { summary } }).result.summary,
    ).toBe(summary);
  });
  // Removing the factory must fail as a behavior assertion, not a module-load error.
  it('provides a server-only settlement preparation boundary', () => {
    expect(settlement.prepareCoreSettlement).toBeTypeOf('function');
  });

  it('snapshots only safe content and metadata with one stable commit identity', () => {
    const original = input();
    original.verification.suggestedFix = 'SYNTHETIC_PRIVATE_DETAIL';
    original.verification.checks.push({
      criterionId: 'semantic.overall',
      checker: 'llm',
      passed: true,
      detail: 'SYNTHETIC_PRIVATE_DETAIL',
    });
    const op = settlement.prepareCoreSettlement(original);
    original.result.summary = 'changed later';
    if (!original.verification.inputCoverage) throw new Error('missing fixture coverage');
    original.verification.inputCoverage.codes = ['VERIFICATION_INPUT_LIMIT'];
    expect(op.result).toEqual({ summary: '合成结果', tickCount: 1 });
    expect(op.verification).toEqual({
      schemaVersion: 1,
      executionId: original.admission.executionId,
      executionRevision: 1,
      commitId: op.commitId,
      generation: original.generation,
      inputCoverage: { complete: true, codes: [] },
      semanticStatus: 'pass',
      issueCodes: [],
      failureLevel: null,
    });
    expect(op.expectedRecordVersion).toBe(1);
    expect(op.recordVersion).toBe(2);
    expect(op.commitId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.isFrozen(op.result)).toBe(true);
    expect(Object.isFrozen(op.verification.inputCoverage.codes)).toBe(true);
    expect(Object.isFrozen(op.verification.generation)).toBe(true);
    expect(JSON.stringify(op)).not.toContain('SYNTHETIC_PRIVATE_DETAIL');
    expect(settlement.prepareCoreSettlement(input()).commitId).not.toBe(op.commitId);
  });

  it('rejects a copied admission and a copied settlement before a write', () => {
    const original = input();
    expect(() =>
      settlement.prepareCoreSettlement({ ...original, admission: { ...original.admission } }),
    ).toThrow('CORE_SETTLEMENT_INVALID');
    const op = settlement.prepareCoreSettlement(original);
    expect(() => settlement.assertPreparedCoreSettlement({ ...op })).toThrow(
      'CORE_SETTLEMENT_INVALID',
    );
    expect(() => settlement.assertPreparedCoreSettlement(op)).not.toThrow();
  });

  it.each([
    'taskId',
    'executionId',
    'executionRevision',
    'inputCoverage',
    'semanticStatus',
  ] as const)('refuses missing required verification %s', (field) => {
    const original = input();
    Reflect.deleteProperty(original.verification, field);
    expect(() => settlement.prepareCoreSettlement(original)).toThrow('CORE_SETTLEMENT_INVALID');
  });

  it.each([{ taskId: 'tsk_other' }, { executionId: 'other_exec' }, { executionRevision: 2 }])(
    'refuses mismatched verification identity %j',
    (change) => {
      const original = input();
      Object.assign(original.verification, change);
      expect(() => settlement.prepareCoreSettlement(original)).toThrow('CORE_SETTLEMENT_INVALID');
    },
  );

  it('cannot complete a partial generation but can retain its explicitly partial draft', () => {
    const original = {
      ...input(),
      generation: { completeness: 'partial' as const, stopReason: 'continuation_limit' as const },
    };
    expect(() => settlement.prepareCoreSettlement(original)).toThrow('CORE_SETTLEMENT_INVALID');
    const op = settlement.prepareCoreSettlement({ ...original, status: 'partial_success' });
    expect(op.verificationPassed).toBe(false);
    expect(op.verification.issueCodes).toContain('GENERATION_INCOMPLETE');
  });

  it('cannot complete incomplete coverage but preserves the fixed issue on a partial result', () => {
    const original = input();
    original.verification.inputCoverage = {
      complete: false,
      codes: ['VERIFICATION_MATERIALS_INCOMPLETE'],
    };
    original.verification.passed = false;
    original.verification.failureLevel = 'fixable';
    expect(() => settlement.prepareCoreSettlement(original)).toThrow('CORE_SETTLEMENT_INVALID');
    const op = settlement.prepareCoreSettlement({ ...original, status: 'partial_success' });
    expect(op.verification.issueCodes).toContain('VERIFICATION_MATERIALS_INCOMPLETE');
  });

  it.each([
    { complete: true, codes: ['VERIFICATION_INPUT_LIMIT'] },
    { complete: false, codes: [] },
    { complete: false, codes: ['SYNTHETIC_PRIVATE_DETAIL'] },
  ])('refuses contradictory or uncontrolled input coverage %j', (coverage) => {
    const original = input();
    Object.assign(original.verification, { inputCoverage: coverage });
    expect(() => settlement.prepareCoreSettlement(original)).toThrow('CORE_SETTLEMENT_INVALID');
  });

  it.each(['warn', 'unavailable'] as const)(
    'retains %s without pretending it is semantic pass',
    (semanticStatus) => {
      const original = input();
      original.verification.semanticStatus = semanticStatus;
      const op = settlement.prepareCoreSettlement(original);
      expect(op.status).toBe('completed');
      expect(op.verification.semanticStatus).toBe(semanticStatus);
    },
  );

  it('keeps fixed semantic issue codes while discarding all reviewer free text', () => {
    const original = input();
    original.verification.semanticStatus = 'warn';
    original.verification.checks = [
      {
        criterionId: 'semantic.unsupported_conclusion',
        passed: false,
        checker: 'llm',
        severity: 'fixable',
        detail: 'SYNTHETIC_PRIVATE_DETAIL',
      },
    ];
    const op = settlement.prepareCoreSettlement(original);
    expect(op.verification.issueCodes).toEqual(['UNSUPPORTED_CONCLUSION']);
    expect(JSON.stringify(op)).not.toContain('SYNTHETIC_PRIVATE_DETAIL');
  });

  it('never promotes a deterministic hard failure even if overall passed is contradictory', () => {
    const original = input();
    original.verification.checks = [
      {
        criterionId: 'synthetic',
        passed: false,
        checker: 'deterministic',
        severity: 'hard_fail',
        detail: 'SYNTHETIC_PRIVATE_DETAIL',
      },
    ];
    expect(() => settlement.prepareCoreSettlement(original)).toThrow('CORE_SETTLEMENT_INVALID');
    expect(() =>
      settlement.prepareCoreSettlement({ ...original, status: 'partial_success' }),
    ).toThrow('CORE_SETTLEMENT_INVALID');
  });

  it('fails closed for semantic rejection marked passed', () => {
    const original = input();
    original.verification.semanticStatus = 'reject';
    expect(() => settlement.prepareCoreSettlement(original)).toThrow('CORE_SETTLEMENT_INVALID');
  });

  it('does not keep a rejected candidate, provider reason, or reviewer text in failed persistence', () => {
    const original = input();
    original.verification.passed = false;
    original.verification.failureLevel = 'hard_fail';
    original.verification.checks = [
      {
        criterionId: 'SYNTHETIC_PRIVATE_DETAIL',
        passed: false,
        checker: 'deterministic',
        severity: 'hard_fail',
        detail: 'SYNTHETIC_PRIVATE_DETAIL',
      },
    ];
    const op = settlement.prepareCoreSettlement({
      ...original,
      status: 'failed',
      result: { reason: 'SYNTHETIC_PRIVATE_DETAIL' },
    });
    expect(op.result).toEqual({ reason: '质量校验未通过', tickCount: 1 });
    expect(JSON.stringify(op)).not.toContain('SYNTHETIC_PRIVATE_DETAIL');
    expect(op.verificationPassed).toBe(false);
    expect(op.verification.issueCodes).toContain('DETERMINISTIC_CHECK_FAILED');
    expect(() =>
      settlement.prepareCoreSettlement({
        ...original,
        status: 'failed',
        result: { reason: '质量校验未通过', summary: 'SYNTHETIC_PRIVATE_DETAIL' },
      } as never),
    ).toThrow('CORE_SETTLEMENT_INVALID');
  });

  it('allows only the explicit waiting boundary and stores its question without granting execution', () => {
    const original = input();
    const awaiting = {
      ...original,
      status: 'awaiting_user' as const,
      result: { question: '请确认合成方案', planText: '合成方案' },
      generation: { completeness: 'complete' as const, stopReason: 'awaiting_user' as const },
    };
    const op = settlement.prepareCoreSettlement(awaiting);
    expect(op.awaitingQuestion).toBe('请确认合成方案');
    expect(op.awaitingKind).toBe('clarification');
    expect(op.result).toEqual({ tickCount: 1, planText: '合成方案' });
    expect(() =>
      settlement.prepareCoreSettlement({ ...awaiting, generation: original.generation }),
    ).toThrow('CORE_SETTLEMENT_INVALID');
    expect(() =>
      settlement.prepareCoreSettlement({ ...original, generation: awaiting.generation }),
    ).toThrow('CORE_SETTLEMENT_INVALID');
  });

  it.each(['', '  ', '界'.repeat(32_769)])(
    'refuses empty or UTF-8 over-budget content',
    (summary) => {
      expect(() => settlement.prepareCoreSettlement({ ...input(), result: { summary } })).toThrow(
        'CORE_SETTLEMENT_INVALID',
      );
    },
  );

  it('enforces the aggregate awaiting content budget without silently truncating', () => {
    expect(() =>
      settlement.prepareCoreSettlement({
        ...input(),
        status: 'awaiting_user',
        generation: { completeness: 'complete', stopReason: 'awaiting_user' },
        result: { question: '界'.repeat(20_000), planText: '界'.repeat(20_000) },
      }),
    ).toThrow('CORE_SETTLEMENT_INVALID');
  });

  it('refuses record version overflow', () => {
    const original = input();
    const admission = prepareCoreAdmission({
      scope: original.admission.scope,
      requirements: original.admission.requirements,
      before: { ...original.admission.before, recordVersion: Number.MAX_SAFE_INTEGER - 1 },
    });
    Object.assign(original.verification, { executionId: admission.executionId });
    expect(() => settlement.prepareCoreSettlement({ ...original, admission })).toThrow(
      'CORE_SETTLEMENT_INVALID',
    );
  });
});
