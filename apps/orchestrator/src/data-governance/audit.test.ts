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

function first<T>(items: readonly T[]): T {
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
    const category = first(bundle.categories);
    const malformed = { ...bundle, categories: [{ ...category, evidence: [] }] };

    expect(auditGovernanceRegistry(malformed, { verifyEvidenceFiles: false }).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'missing_evidence' })]),
    );
  });

  it('rejects duplicate ids, dangling references, and implemented rights without handlers', () => {
    const bundle = validBundle();
    const category = first(bundle.categories);
    const missingProcessorCategory = { ...category };
    Reflect.set(missingProcessorCategory, 'processorIds', ['missing_processor']);
    const rightsCapability = first(bundle.rightsCapabilities);
    const malformed: GovernanceRegistryBundle = {
      ...bundle,
      categories: [missingProcessorCategory, { ...missingProcessorCategory }],
      rightsCapabilities: [
        {
          ...rightsCapability,
          export: { status: 'implemented', scope: '导出', limitations: [], evidence },
        },
      ],
    };
    const report = auditGovernanceRegistry(malformed, { verifyEvidenceFiles: false });
    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['duplicate_id', 'dangling_reference', 'implemented_handler_missing']),
    );
  });

  it('rejects suspicious secret values but permits configuration key names', () => {
    const safe = validBundle();
    const processor = first(safe.processors);
    const safeWithConfigKey: GovernanceRegistryBundle = {
      ...safe,
      processors: [
        {
          ...processor,
          activation: {
            ...processor.activation,
            configKeys: ['RESEND_API_KEY', 'CLIENT_SECRET', 'ACCESS_TOKEN'],
          },
        },
      ],
    };
    expect(auditGovernanceRegistry(safeWithConfigKey, { verifyEvidenceFiles: false }).ok).toBe(
      true,
    );

    for (const description of [
      'embedded=prefix/sk-live-secret-example-123456789',
      'credential=sk-live-secret-example-123456789',
      'client_secret=plain-client-secret',
      'access_token="plain access token"',
    ]) {
      const unsafe = validBundle();
      const category = first(unsafe.categories);
      const malformed = { ...unsafe, categories: [{ ...category, description }] };
      expect(auditGovernanceRegistry(malformed, { verifyEvidenceFiles: false }).issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'suspicious_secret' })]),
      );
    }
  });

  it('aggregates empty fields, arrays, enum values, evidence, and disclosure failures', () => {
    const bundle = validBundle();
    const category = {
      ...first(bundle.categories),
      displayName: '',
      dataElements: [],
      evidence: [{ kind: 'source_file' as const, path: '', fact: '' }],
    };
    Reflect.set(category, 'sensitivity', 'extreme');
    const processor = {
      ...first(bundle.processors),
      purposes: [],
      activation: { ...first(bundle.processors).activation },
    };
    Reflect.set(processor.activation, 'mode', 'sometimes');
    Reflect.set(processor, 'regionStatus', 'probably_verified');
    const policy = { ...first(bundle.retentionPolicies), trigger: '' };
    Reflect.set(policy, 'automationStatus', 'automatic');
    const rights = {
      ...first(bundle.rightsCapabilities),
      export: { ...first(bundle.rightsCapabilities).export, scope: '' },
    };
    Reflect.set(rights.export, 'status', 'planned');
    const disclosure = {
      ...first(bundle.publicDisclosures),
      spaLabel: '',
      requiredBoundaries: [],
      publiclyDisclosed: false,
    };
    const malformed = {
      ...bundle,
      categories: [category],
      processors: [processor],
      retentionPolicies: [policy],
      rightsCapabilities: [rights],
      publicDisclosures: [disclosure],
    } as GovernanceRegistryBundle;

    const report = auditGovernanceRegistry(malformed, {
      verifyEvidenceFiles: false,
      requirePublicDisclosures: true,
    });

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'required_string_missing',
        'required_array_empty',
        'invalid_enum_value',
        'invalid_evidence',
        'invalid_public_disclosure',
      ]),
    );
    expect(report.summary.errors).toBeGreaterThanOrEqual(10);
  });

  it('enforces ids, bidirectional processors, retention rules, and disclosure cardinality', () => {
    const bundle = validBundle();
    const category = { ...first(bundle.categories) };
    Reflect.set(category, 'id', 'Account Security');
    const malformed = {
      ...bundle,
      categories: [category],
      processors: [{ ...first(bundle.processors), categoryIds: [] }],
      retentionPolicies: [
        { ...first(bundle.retentionPolicies), rule: { kind: 'fixed_days', days: 0 } },
      ],
      publicDisclosures: [first(bundle.publicDisclosures), { ...first(bundle.publicDisclosures) }],
    } as GovernanceRegistryBundle;
    const report = auditGovernanceRegistry(malformed, {
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
    const category = first(bundle.categories);
    const malformed: GovernanceRegistryBundle = {
      ...bundle,
      categories: [
        {
          ...category,
          evidence: [
            {
              kind: 'exported_symbol',
              path: 'apps/orchestrator/src/db/schema/users.ts',
              symbol: 'DefinitelyMissingGovernanceSymbol',
              fact: '负向证据符号',
            },
          ],
        },
      ],
    };
    const report = auditGovernanceRegistry(malformed, { repoRoot, verifyEvidenceFiles: true });
    expect(report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'evidence_symbol_missing' })]),
    );
  });

  it.each([
    ['commented export', '// export { targetHandler };\nconst targetHandler = () => true;', true],
    [
      'renamed-away local export',
      'const targetHandler = () => true;\nexport { targetHandler as otherName };',
      true,
    ],
    [
      'renamed-to exact export',
      'const localHandler = () => true;\nexport { localHandler as targetHandler };',
      false,
    ],
    ['exact named export', 'const targetHandler = () => true;\nexport { targetHandler };', false],
    ['direct function export', 'export function targetHandler() { return true; }', false],
    ['direct enum export', 'export enum targetHandler { Ready }', false],
    [
      'direct namespace export',
      'export namespace targetHandler { export const ready = true; }',
      false,
    ],
    ['direct module export', 'export module targetHandler { export const ready = true; }', false],
    [
      'named local enum export',
      'enum localHandler { Ready }\nexport { localHandler as targetHandler };',
      false,
    ],
    [
      'named local namespace export',
      'namespace localHandler { export const ready = true; }\nexport { localHandler as targetHandler };',
      false,
    ],
    ['direct const export', 'export const targetHandler = () => true;', false],
    ['direct let export without initializer', 'export let targetHandler: boolean;', false],
    ['direct var export without initializer', 'export var targetHandler: boolean;', false],
    ['invalid const export without initializer', 'export const targetHandler: boolean;', true],
    [
      'invalid local const named export',
      'const localHandler: boolean;\nexport { localHandler as targetHandler };',
      true,
    ],
    [
      'unexported local beside another export',
      'const targetHandler = () => true;\nexport const otherHandler = targetHandler;',
      true,
    ],
    ['direct class export', 'export class targetHandler {}', false],
    ['const enum export erased at runtime', 'export const enum targetHandler { Ready }', true],
    ['ambient enum export', 'export declare enum targetHandler { Ready }', true],
    [
      'ambient namespace export',
      'export declare namespace targetHandler { const ready: boolean; }',
      true,
    ],
    ['empty namespace export', 'export namespace targetHandler {}', true],
    [
      'type-only namespace export',
      'export namespace targetHandler { export interface Ready {} }',
      true,
    ],
    [
      'named type-only namespace export',
      'namespace localHandler { export type Ready = boolean; }\nexport { localHandler as targetHandler };',
      true,
    ],
    [
      'valid target in a structurally invalid module',
      'namespace Broken { const missing: boolean; }\nexport function targetHandler() { return true; }',
      true,
    ],
    ['bodyless function export', 'export function targetHandler(): boolean;', true],
    [
      'type-only named export',
      'type targetHandler = string;\nexport type { targetHandler };',
      true,
    ],
    [
      'type alias in a value-looking export list',
      'type targetHandler = string;\nexport { targetHandler };',
      true,
    ],
    ['unresolved re-export', "export { targetHandler } from './other.js';", true],
    ['interface export', 'export interface targetHandler { value: string }', true],
    ['malformed declaration', 'export const targetHandler =', true],
  ] as const)(
    'distinguishes the runtime exported name for %s',
    (_caseName, source, expectsMissingSymbol) => {
      const temporaryRoot = mkdtempSync(join(tmpdir(), 'governance-export-'));
      try {
        const evidencePath = join(temporaryRoot, 'apps/orchestrator/src/db/schema/users.ts');
        mkdirSync(join(temporaryRoot, 'apps/orchestrator/src/db/schema'), { recursive: true });
        writeFileSync(evidencePath, 'export const userSchema = true;');
        writeFileSync(join(temporaryRoot, 'handler.ts'), source);
        const bundle = validBundle();
        const rightsCapability = first(bundle.rightsCapabilities);
        const registry: GovernanceRegistryBundle = {
          ...bundle,
          rightsCapabilities: [
            {
              ...rightsCapability,
              export: {
                status: 'implemented',
                handlerRef: 'handler.ts#targetHandler',
                scope: '导出',
                limitations: [],
                evidence,
              },
            },
          ],
        };

        const report = auditGovernanceRegistry(registry, {
          repoRoot: temporaryRoot,
          verifyEvidenceFiles: true,
        });
        const hasMissingSymbol = report.issues.some(
          (issue) => issue.code === 'handler_symbol_missing',
        );
        expect(hasMissingSymbol).toBe(expectsMissingSymbol);
      } finally {
        rmSync(temporaryRoot, { force: true, recursive: true });
      }
    },
  );

  it.each([
    ['non-object entry', [null], 'invalid_enum_value'],
    [
      'duplicate id',
      [
        {
          id: 'task_30d',
          boundary: '第一个边界',
          automationStatus: 'implemented',
          activation: {
            mode: 'feature_conditional',
            enabledByDefault: false,
            configKeys: ['LEDGER_DB_WRITE_ENABLED'],
          },
          evidence,
        },
        {
          id: 'task_30d',
          boundary: '重复边界',
          automationStatus: 'implemented',
          activation: {
            mode: 'feature_conditional',
            enabledByDefault: false,
            configKeys: ['RETENTION_REAPER_ENABLED'],
          },
          evidence,
        },
      ],
      'duplicate_id',
    ],
    [
      'unknown id',
      [
        {
          id: 'unregistered_regime',
          boundary: '未知边界',
          automationStatus: 'implemented',
          activation: {
            mode: 'feature_conditional',
            enabledByDefault: false,
            configKeys: ['RETENTION_REAPER_ENABLED'],
          },
          evidence,
        },
      ],
      'invalid_enum_value',
    ],
    [
      'invalid nested config key',
      [
        {
          id: 'task_30d',
          boundary: '已登记边界',
          automationStatus: 'implemented',
          activation: {
            mode: 'feature_conditional',
            enabledByDefault: false,
            configKeys: ['not_a_config_key'],
          },
          evidence,
        },
      ],
      'invalid_enum_value',
    ],
  ] as const)('fails closed for malformed localRegimes: %s', (_caseName, localRegimes, code) => {
    const bundle = validBundle();
    const policy = { ...first(bundle.retentionPolicies) };
    Reflect.set(policy, 'localRegimes', localRegimes);
    const malformed: GovernanceRegistryBundle = {
      ...bundle,
      retentionPolicies: [policy],
    };

    const report = auditGovernanceRegistry(malformed, { verifyEvidenceFiles: false });

    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });

  it.each(['/tmp/file#symbol', '../file#symbol'])(
    'rejects non-repository-relative implemented handler %s',
    (handlerRef) => {
      const bundle = validBundle();
      const rightsCapability = first(bundle.rightsCapabilities);
      const malformed: GovernanceRegistryBundle = {
        ...bundle,
        rightsCapabilities: [
          {
            ...rightsCapability,
            export: {
              status: 'implemented',
              handlerRef,
              scope: '导出',
              limitations: [],
              evidence,
            },
          },
        ],
      };

      expect(
        auditGovernanceRegistry(malformed, { repoRoot, verifyEvidenceFiles: false }).issues,
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'implemented_handler_missing' })]),
      );
    },
  );

  it.each([
    ['missing-handler.ts#missingHandler', 'handler_source_missing'],
    ['apps/orchestrator/src/db/schema/users.ts#DefinitelyMissingHandler', 'handler_symbol_missing'],
  ] as const)(
    'verifies implemented handler path and exact export for %s',
    (handlerRef, expectedCode) => {
      const bundle = validBundle();
      const rightsCapability = first(bundle.rightsCapabilities);
      const malformed: GovernanceRegistryBundle = {
        ...bundle,
        rightsCapabilities: [
          {
            ...rightsCapability,
            export: {
              status: 'implemented',
              handlerRef,
              scope: '导出',
              limitations: [],
              evidence,
            },
          },
        ],
      };

      const report = auditGovernanceRegistry(malformed, {
        repoRoot,
        verifyEvidenceFiles: true,
      });
      expect(report.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: expectedCode })]),
      );
    },
  );

  it('aggregates directory evidence and handler paths instead of throwing', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'governance-directory-'));
    try {
      const sourcePath = join(temporaryRoot, 'apps/orchestrator/src/db/schema/users.ts');
      mkdirSync(join(temporaryRoot, 'apps/orchestrator/src/db/schema'), { recursive: true });
      writeFileSync(sourcePath, 'export const userSchema = true;');
      mkdirSync(join(temporaryRoot, 'directory-evidence'));
      const bundle = validBundle();
      const rightsCapability = first(bundle.rightsCapabilities);
      const malformed: GovernanceRegistryBundle = {
        ...bundle,
        categories: [
          {
            ...first(bundle.categories),
            evidence: [
              {
                kind: 'exported_symbol',
                path: 'directory-evidence',
                symbol: 'directorySymbol',
                fact: '目录不能作为源码证据',
              },
            ],
          },
        ],
        rightsCapabilities: [
          {
            ...rightsCapability,
            export: {
              status: 'implemented',
              handlerRef: 'directory-evidence#directorySymbol',
              scope: '导出',
              limitations: [],
              evidence,
            },
          },
        ],
      };

      const report = auditGovernanceRegistry(malformed, {
        repoRoot: temporaryRoot,
        verifyEvidenceFiles: true,
      });
      expect(report.ok).toBe(false);
      expect(report.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining(['source_evidence_missing', 'handler_source_missing']),
      );
    } finally {
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  });

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
      const category = first(bundle.categories);
      const malformed: GovernanceRegistryBundle = {
        ...bundle,
        categories: [
          {
            ...category,
            evidence: [
              {
                kind: 'exported_symbol',
                path: 'linked.ts',
                symbol: 'externalEvidence',
                fact: '外部符号',
              },
            ],
          },
        ],
      };

      const report = auditGovernanceRegistry(malformed, {
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
      const malformed: GovernanceRegistryBundle = {
        ...bundle,
        rightsCapabilities: [
          {
            ...rightsCapability,
            delete: { ...rightsCapability.delete, manualEntrypoint },
          },
        ],
      };

      expect(auditGovernanceRegistry(malformed, { verifyEvidenceFiles: false }).issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'suspicious_secret' })]),
      );
    },
  );
});
