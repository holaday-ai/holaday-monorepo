import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

function first<T>(items: T[]): T {
  const item = items[0];
  if (!item) throw new Error('Test fixture unexpectedly has no entry.');
  return item;
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

  it('requires evidence even when source-file verification is disabled', () => {
    const bundle = validBundle();
    first(bundle.categories).evidence = [];

    expect(auditGovernanceRegistry(bundle, { verifyEvidenceFiles: false }).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'missing_evidence' })]),
    );
  });

  it('rejects duplicate ids, dangling references, and implemented rights without handlers', () => {
    const bundle = validBundle();
    const category = first(bundle.categories);
    bundle.categories = [...bundle.categories, category];
    Reflect.set(category, 'processorIds', ['missing_processor']);
    const rightsCapability = first(bundle.rightsCapabilities);
    bundle.rightsCapabilities[0] = {
      ...rightsCapability,
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
    const processor = first(safe.processors);
    safe.processors[0] = {
      ...processor,
      activation: { ...processor.activation, configKeys: ['RESEND_API_KEY'] },
    };
    expect(auditGovernanceRegistry(safe, { verifyEvidenceFiles: false }).ok).toBe(true);

    const unsafe = validBundle();
    const category = first(unsafe.categories);
    unsafe.categories[0] = {
      ...category,
      description: 'sk-live-secret-example-123456789',
    };
    expect(auditGovernanceRegistry(unsafe, { verifyEvidenceFiles: false }).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'suspicious_secret' })]),
    );
  });

  it('enforces ids, bidirectional processors, retention rules, and disclosure cardinality', () => {
    const bundle = validBundle();
    Reflect.set(first(bundle.categories), 'id', 'Account Security');
    first(bundle.processors).categoryIds = [];
    first(bundle.retentionPolicies).rule = { kind: 'fixed_days', days: 0 };
    bundle.publicDisclosures.push(first(bundle.publicDisclosures));
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
    first(bundle.categories).evidence = [
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

  it.each(['/tmp/file#symbol', '../file#symbol'])(
    'rejects non-repository-relative implemented handler %s',
    (handlerRef) => {
      const bundle = validBundle();
      const rightsCapability = first(bundle.rightsCapabilities);
      rightsCapability.export = {
        status: 'implemented',
        handlerRef,
        scope: '导出',
        limitations: [],
        evidence,
      };

      expect(
        auditGovernanceRegistry(bundle, { repoRoot, verifyEvidenceFiles: false }).issues,
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'implemented_handler_missing' })]),
      );
    },
  );

  it('rejects evidence symlinks whose canonical target escapes repoRoot', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'governance-root-'));
    const externalRoot = mkdtempSync(join(tmpdir(), 'governance-external-'));
    try {
      const sourcePath = join(temporaryRoot, 'apps/orchestrator/src/db/schema/users.ts');
      mkdirSync(join(temporaryRoot, 'apps/orchestrator/src/db/schema'), { recursive: true });
      writeFileSync(sourcePath, 'export const userSchema = true;');
      const externalSource = join(externalRoot, 'external.ts');
      writeFileSync(externalSource, 'export const externalEvidence = true;');
      symlinkSync(externalSource, join(temporaryRoot, 'linked.ts'));

      const bundle = validBundle();
      first(bundle.categories).evidence = [
        {
          kind: 'exported_symbol',
          path: 'linked.ts',
          symbol: 'externalEvidence',
          fact: '外部符号',
        },
      ];

      const report = auditGovernanceRegistry(bundle, {
        repoRoot: temporaryRoot,
        verifyEvidenceFiles: true,
      });
      expect(report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'source_evidence_missing',
            registryId: 'category:account_security',
          }),
        ]),
      );
    } finally {
      rmSync(temporaryRoot, { force: true, recursive: true });
      rmSync(externalRoot, { force: true, recursive: true });
    }
  });

  it.each(['Bearer private-token', 'Cookie: session=private-value'])(
    'rejects secret-like manual entrypoint %s',
    (manualEntrypoint) => {
      const bundle = validBundle();
      const rightsCapability = first(bundle.rightsCapabilities);
      rightsCapability.delete = { ...rightsCapability.delete, manualEntrypoint };

      expect(auditGovernanceRegistry(bundle, { verifyEvidenceFiles: false }).issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'suspicious_secret' })]),
      );
    },
  );
});
