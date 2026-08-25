import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditGovernanceRegistry } from './audit.js';
import type { GovernanceRegistryBundle } from './types.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const evidence = [
  {
    kind: 'source_file' as const,
    path: 'apps/orchestrator/src/db/schema/users.ts',
    fact: '账号资料保存在用户表',
  },
];

function validBundle(): GovernanceRegistryBundle {
  return {
    categories: [
      {
        id: 'account_security',
        displayName: '账号与安全',
        description: '账号注册、登录与安全数据',
        dataElements: ['邮箱', '密码哈希'],
        sources: ['用户主动提交', '登录流程'],
        purposes: ['注册与账号安全'],
        sensitivity: 'sensitive',
        storageLocations: ['HOLA DAY 数据库'],
        processorIds: ['holaday_internal'],
        retentionPolicyId: 'account_purpose_bound',
        rightsCapabilityId: 'account_manual_request',
        evidence,
      },
    ],
    processors: [
      {
        id: 'holaday_internal',
        displayName: 'HOLA DAY',
        purposes: ['提供账号与任务服务'],
        categoryIds: ['account_security'],
        activation: { mode: 'always_internal', evidence },
        regionStatus: 'unknown',
        legalReviewStatus: 'pending_legal_review',
      },
    ],
    retentionPolicies: [
      {
        id: 'account_purpose_bound',
        trigger: '账号创建',
        rule: { kind: 'purpose_bound', description: '账号存续及安全所需' },
        automationStatus: 'manual',
        retryStatus: 'not_implemented',
        evidence,
      },
    ],
    rightsCapabilities: [
      {
        id: 'account_manual_request',
        export: {
          status: 'not_implemented',
          scope: '无自动导出',
          limitations: ['需后续建设'],
          evidence,
        },
        delete: {
          status: 'manual',
          manualEntrypoint: 'privacy@holaday.ai',
          scope: '身份核验后的账号关闭和可处理数据',
          limitations: ['受限保留记录除外'],
          evidence,
        },
        correct: {
          status: 'manual',
          manualEntrypoint: 'privacy@holaday.ai',
          scope: '可更正账号信息',
          limitations: [],
          evidence,
        },
        pause: {
          status: 'not_applicable',
          scope: '账号安全处理不可暂停',
          limitations: [],
          evidence,
        },
        withdraw: {
          status: 'manual',
          manualEntrypoint: 'privacy@holaday.ai',
          scope: '适用时处理撤回申请',
          limitations: ['不影响撤回前处理'],
          evidence,
        },
      },
    ],
    publicDisclosures: [
      {
        categoryId: 'account_security',
        spaLabel: '账号与安全',
        landingLabel: '账号与安全',
        requiredBoundaries: ['密码哈希'],
        publiclyDisclosed: true,
      },
    ],
  };
}

describe('auditGovernanceRegistry', () => {
  it('accepts a structurally complete registry without reading runtime data', () => {
    const report = auditGovernanceRegistry(validBundle(), { verifyEvidenceFiles: false });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'gap', code: 'governance_gap' }),
      ]),
    );
  });

  it('rejects duplicate ids, dangling references, and implemented rights without handlers', () => {
    const bundle = validBundle();
    bundle.categories = [...bundle.categories, bundle.categories[0]!];
    bundle.categories[0] = { ...bundle.categories[0]!, processorIds: ['missing_processor'] };
    bundle.rightsCapabilities[0] = {
      ...bundle.rightsCapabilities[0]!,
      export: { status: 'implemented', scope: '导出', limitations: [], evidence },
    };
    const report = auditGovernanceRegistry(bundle, { verifyEvidenceFiles: false });
    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['duplicate_id', 'dangling_reference', 'implemented_handler_missing']),
    );
  });

  it('rejects suspicious secret values but permits configuration key names', () => {
    const safe = validBundle();
    safe.processors[0] = {
      ...safe.processors[0]!,
      activation: { ...safe.processors[0]!.activation, configKeys: ['RESEND_API_KEY'] },
    };
    expect(auditGovernanceRegistry(safe, { verifyEvidenceFiles: false }).ok).toBe(true);

    const unsafe = validBundle();
    unsafe.categories[0] = {
      ...unsafe.categories[0]!,
      description: 'sk-live-secret-example-123456789',
    };
    expect(auditGovernanceRegistry(unsafe, { verifyEvidenceFiles: false }).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'suspicious_secret' })]),
    );
  });

  it('enforces ids, bidirectional processors, retention rules, and disclosure cardinality', () => {
    const bundle = validBundle();
    Reflect.set(bundle.categories[0]!, 'id', 'Account Security');
    bundle.processors[0]!.categoryIds = [];
    bundle.retentionPolicies[0]!.rule = { kind: 'fixed_days', days: 0 };
    bundle.publicDisclosures.push(bundle.publicDisclosures[0]!);
    const report = auditGovernanceRegistry(bundle, {
      verifyEvidenceFiles: false,
      requirePublicDisclosures: true,
    });
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'invalid_id',
        'processor_category_mismatch',
        'invalid_fixed_days',
        'public_disclosure_duplicate',
      ]),
    );
  });

  it('verifies exported symbols without reading runtime data', () => {
    const bundle = validBundle();
    bundle.categories[0]!.evidence = [
      {
        kind: 'exported_symbol',
        path: 'apps/orchestrator/src/db/schema/users.ts',
        symbol: 'DefinitelyMissingGovernanceSymbol',
        fact: '负向证据符号',
      },
    ];
    const report = auditGovernanceRegistry(bundle, { repoRoot, verifyEvidenceFiles: true });
    expect(report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'evidence_symbol_missing' })]),
    );
  });
});
