import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditGovernanceRegistry } from './audit.js';
import { governanceRegistry } from './index.js';
import { publicDisclosures } from './public-disclosure-map.js';
import type { PublicDisclosureDefinition } from './types.js';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const spa = readFileSync(`${repoRoot}/apps/web-workbench/src/pages/PrivacyPage.tsx`, 'utf8');
const landing = readFileSync(`${repoRoot}/apps/holaday-landing/privacy.html`, 'utf8');

const APPROVED_PUBLIC_DISCLOSURES = [
  {
    categoryId: 'account_security',
    spaLabel: '账号与安全',
    landingLabel: '账号与安全',
    requiredBoundaries: ['密码哈希'],
    publiclyDisclosed: true,
  },
  {
    categoryId: 'task_execution',
    spaLabel: '任务与执行',
    landingLabel: '任务与执行',
    requiredBoundaries: ['不是服务器删除期限'],
    publiclyDisclosed: true,
  },
  {
    categoryId: 'cross_task_memory',
    spaLabel: '跨任务 AI 记忆',
    landingLabel: '跨任务 AI 记忆',
    requiredBoundaries: ['偏好可能长期保留'],
    publiclyDisclosed: true,
  },
  {
    categoryId: 'energy_astrology_profile',
    spaLabel: '今日能量星座资料',
    landingLabel: '今日能量星座资料',
    requiredBoundaries: ['DivineAPI'],
    publiclyDisclosed: true,
  },
  {
    categoryId: 'stock_preference_profile',
    spaLabel: '股票偏好画像',
    landingLabel: '股票偏好画像',
    requiredBoundaries: ['90 天是推断窗口'],
    publiclyDisclosed: true,
  },
  {
    categoryId: 'feedback_support',
    spaLabel: '反馈与支持',
    landingLabel: '反馈与支持',
    requiredBoundaries: ['Resend'],
    publiclyDisclosed: true,
  },
  {
    categoryId: 'external_notifications',
    spaLabel: '外部通知渠道',
    landingLabel: '外部通知渠道',
    requiredBoundaries: ['webhook'],
    publiclyDisclosed: true,
  },
  {
    categoryId: 'extension_site_stats',
    spaLabel: '扩展常用网站',
    landingLabel: '扩展常用网站',
    requiredBoundaries: ['域名'],
    publiclyDisclosed: true,
  },
  {
    categoryId: 'extension_login_cookies',
    spaLabel: '扩展登录态',
    landingLabel: '扩展登录态',
    requiredBoundaries: ['真实 Cookie'],
    publiclyDisclosed: true,
  },
  {
    categoryId: 'payments_entitlements',
    spaLabel: '支付与套餐',
    landingLabel: '支付与套餐',
    requiredBoundaries: ['不会自动扣款'],
    publiclyDisclosed: true,
  },
  {
    categoryId: 'partner_kyc_ledger',
    spaLabel: '合伙人 KYC 与账本',
    landingLabel: '合伙人 KYC 与账本',
    requiredBoundaries: ['风险评分'],
    publiclyDisclosed: true,
  },
  {
    categoryId: 'media_assets',
    spaLabel: '媒体素材',
    landingLabel: '媒体素材',
    requiredBoundaries: ['声音克隆'],
    publiclyDisclosed: true,
  },
  {
    categoryId: 'analytics_logs',
    spaLabel: '分析与日志',
    landingLabel: '分析与日志',
    requiredBoundaries: ['匿名摘要'],
    publiclyDisclosed: true,
  },
] satisfies PublicDisclosureDefinition[];

describe('public disclosure map', () => {
  it('preserves every approved disclosure row in stable order', () => {
    expect(publicDisclosures).toEqual(APPROVED_PUBLIC_DISCLOSURES);
  });

  it('maps every registered public category to both policy surfaces', () => {
    expect(publicDisclosures).toHaveLength(13);
    expect(new Set(publicDisclosures.map((item) => item.categoryId)).size).toBe(13);
    for (const item of publicDisclosures) {
      expect(spa).toContain(item.spaLabel);
      expect(landing).toContain(item.landingLabel);
      for (const boundary of item.requiredBoundaries) {
        expect(spa).toContain(boundary);
        expect(landing).toContain(boundary);
      }
    }
  });

  it('passes strict public-disclosure registry audit', () => {
    const report = auditGovernanceRegistry(governanceRegistry, {
      repoRoot,
      verifyEvidenceFiles: true,
      requirePublicDisclosures: true,
    });
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});
