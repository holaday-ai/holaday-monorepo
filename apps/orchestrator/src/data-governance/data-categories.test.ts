import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditGovernanceRegistry } from './audit.js';
import { dataCategories } from './data-categories.js';
import { governanceRegistry } from './index.js';

const CATEGORY_IDS = [
  'account_security',
  'task_execution',
  'cross_task_memory',
  'energy_astrology_profile',
  'stock_preference_profile',
  'feedback_support',
  'external_notifications',
  'extension_site_stats',
  'extension_login_cookies',
  'payments_entitlements',
  'partner_kyc_ledger',
  'media_assets',
  'analytics_logs',
] as const;

describe('data category registry', () => {
  it('registers the thirteen public categories in stable order', () => {
    expect(dataCategories.map((item) => item.id)).toEqual(CATEGORY_IDS);
  });

  it('marks cookies, KYC, and exact-birthday profiles as sensitive', () => {
    for (const id of [
      'extension_login_cookies',
      'partner_kyc_ledger',
      'energy_astrology_profile',
    ]) {
      expect(dataCategories.find((item) => item.id === id)?.sensitivity).toBe('highly_sensitive');
    }
  });

  it('passes complete cross-reference and source-evidence audit', () => {
    const report = auditGovernanceRegistry(governanceRegistry, {
      repoRoot: fileURLToPath(new URL('../../../../', import.meta.url)),
      verifyEvidenceFiles: true,
    });
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(report.summary.categories).toBe(13);
  });

  it('preserves the stock and extension-cookie control limits', () => {
    expect(
      JSON.stringify(dataCategories.find((item) => item.id === 'stock_preference_profile')),
    ).toContain('可能优势与潜在盲点');
    expect(
      JSON.stringify(dataCategories.find((item) => item.id === 'extension_login_cookies')),
    ).toContain('真实 Cookie');
  });

  it('keeps feedback relationally governed while Resend receives only a random case reference', () => {
    const feedback = dataCategories.find((item) => item.id === 'feedback_support');
    expect(feedback?.dataElements).toEqual(
      expect.arrayContaining(['自由文本', '可选上下文', 'User-Agent', '随机反馈编号', '账号关联']),
    );
    expect(feedback?.dataElements).not.toContain('账号邮箱');
    expect(feedback?.dataElements).not.toContain('账号标识');
  });

  it('preserves the approved analytics IP data type', () => {
    expect(dataCategories.find((item) => item.id === 'analytics_logs')?.dataElements).toContain(
      'IP',
    );
  });

  it('registers retained team-work facts and a privacy-safe export boundary', () => {
    const taskExecution = dataCategories.find((item) => item.id === 'task_execution');
    const serialized = JSON.stringify(taskExecution);
    for (const fact of ['提交', '评审', '申诉', '仲裁决定', '证据绑定', 'AI 协助贡献']) {
      expect(serialized).toContain(fact);
    }
    expect(serialized).toContain('永久保留业务事实');
    for (const excluded of ['私人原文', '原始 AI prompt', '存储路径', '内部数字 ID']) {
      expect(serialized).toContain(`导出排除${excluded}`);
    }
    expect(taskExecution?.exportVisibility).toEqual({
      include: ['externalId', 'status', 'summaryMetadata'],
      exclude: ['私人原文', '原始 AI prompt', '存储路径', '内部数字 ID'],
    });
  });

  it('fails governance audit if the task export allowlist contract is removed', () => {
    const malformed = structuredClone(governanceRegistry) as unknown as {
      categories: Array<Record<string, unknown>>;
    };
    const task = malformed.categories.find((category) => category.id === 'task_execution');
    if (!task) throw new Error('task category fixture missing');
    Reflect.deleteProperty(task, 'exportVisibility');
    const report = auditGovernanceRegistry(malformed as never, {
      repoRoot: fileURLToPath(new URL('../../../../', import.meta.url)),
      verifyEvidenceFiles: false,
    });
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          registryId: 'category:task_execution',
        }),
      ]),
    );
  });
});
