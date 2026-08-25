import { describe, expect, it } from 'vitest';
import { retentionPolicies } from './retention-policies.js';
import { rightsCapabilities } from './rights-capabilities.js';

const RETENTION_IDS = [
  'account_purpose_bound',
  'task_visibility_unified_unknown',
  'memory_entry_lifecycle',
  'browser_local_until_clear',
  'stock_profile_mixed',
  'feedback_purpose_bound',
  'notification_config_until_change',
  'domain_snapshot_replace',
  'cookie_injection_mixed',
  'transaction_restricted',
  'partner_financial_restricted',
  'media_mixed',
  'analytics_configured_mixed',
] as const;

const RIGHTS_IDS = [
  'account_manual_request',
  'task_manual_request',
  'memory_self_service',
  'astrology_local_self_service',
  'stock_profile_self_service',
  'feedback_manual_request',
  'notification_self_service',
  'extension_stats_manual_request',
  'extension_cookie_mixed',
  'payment_restricted_request',
  'partner_restricted_request',
  'media_mixed_control',
  'analytics_manual_request',
] as const;

describe('governance lifecycle registry', () => {
  it('registers each approved retention and rights id exactly once', () => {
    expect(retentionPolicies.map((item) => item.id)).toEqual(RETENTION_IDS);
    expect(rightsCapabilities.map((item) => item.id)).toEqual(RIGHTS_IDS);
  });

  it('does not turn visibility, observation, or inference windows into deletion deadlines', () => {
    const task = retentionPolicies.find((item) => item.id === 'task_visibility_unified_unknown');
    const stock = retentionPolicies.find((item) => item.id === 'stock_profile_mixed');
    expect(task?.rule.kind).toBe('unknown');
    expect(JSON.stringify(task)).toContain('可见范围不是服务器删除期限');
    expect(stock?.rule.kind).toBe('mixed');
    expect(JSON.stringify(stock)).toContain('90 天仅是推断窗口');
  });

  it('keeps account close and comprehensive export truthful', () => {
    const account = rightsCapabilities.find((item) => item.id === 'account_manual_request');
    expect(account?.delete.status).toBe('manual');
    expect(account?.delete.manualEntrypoint).toBe('privacy@holaday.ai');
    expect(account?.export.status).toBe('not_implemented');
  });

  it('records exact self-service limits for memory, astrology, stock, and cookies', () => {
    const stock = rightsCapabilities.find((item) => item.id === 'stock_profile_self_service');
    const cookie = rightsCapabilities.find((item) => item.id === 'extension_cookie_mixed');
    expect(stock?.pause.status).toBe('implemented');
    expect(stock?.delete.limitations).toContain('不会删除自选股本身');
    expect(cookie?.withdraw.status).toBe('implemented');
    expect(cookie?.delete.status).toBe('manual');
  });
});
