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
});
