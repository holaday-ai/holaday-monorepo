import { describe, expect, it } from 'vitest';
import type { DataCategoryId } from '../data-governance/types.js';
import type { AccountClosureHandler } from './handler-contract.js';
import { ACCOUNT_CLOSURE_HANDLER_BINDINGS } from './handler-registry.js';
import { accountSecurityClosureHandler } from './handlers/account-security.js';
import { analyticsLogsClosureHandler } from './handlers/analytics-logs.js';
import { crossTaskMemoryClosureHandler } from './handlers/cross-task-memory.js';
import { energyAstrologyProfileClosureHandler } from './handlers/energy-astrology-profile.js';
import { extensionLoginCookiesClosureHandler } from './handlers/extension-login-cookies.js';
import { extensionSiteStatsClosureHandler } from './handlers/extension-site-stats.js';
import { externalNotificationsClosureHandler } from './handlers/external-notifications.js';
import { feedbackSupportClosureHandler } from './handlers/feedback-support.js';
import { mediaAssetsClosureHandler } from './handlers/media-assets.js';
import { partnerKycLedgerClosureHandler } from './handlers/partner-kyc-ledger.js';
import { paymentsEntitlementsClosureHandler } from './handlers/payments-entitlements.js';
import { stockPreferenceProfileClosureHandler } from './handlers/stock-preference-profile.js';
import { taskExecutionClosureHandler } from './handlers/task-execution.js';

const PRODUCTION_HANDLERS: Readonly<Record<DataCategoryId, AccountClosureHandler>> = {
  account_security: accountSecurityClosureHandler,
  task_execution: taskExecutionClosureHandler,
  cross_task_memory: crossTaskMemoryClosureHandler,
  energy_astrology_profile: energyAstrologyProfileClosureHandler,
  stock_preference_profile: stockPreferenceProfileClosureHandler,
  feedback_support: feedbackSupportClosureHandler,
  external_notifications: externalNotificationsClosureHandler,
  extension_site_stats: extensionSiteStatsClosureHandler,
  extension_login_cookies: extensionLoginCookiesClosureHandler,
  payments_entitlements: paymentsEntitlementsClosureHandler,
  partner_kyc_ledger: partnerKycLedgerClosureHandler,
  media_assets: mediaAssetsClosureHandler,
  analytics_logs: analyticsLogsClosureHandler,
};

describe('production account closure handler release contract', () => {
  it('binds each category to the exact imported v1 handler with a declared retention capability', () => {
    expect(ACCOUNT_CLOSURE_HANDLER_BINDINGS).toHaveLength(13);
    for (const binding of ACCOUNT_CLOSURE_HANDLER_BINDINGS) {
      expect(binding.handler).toBe(PRODUCTION_HANDLERS[binding.categoryId]);
      expect(binding.handler).toMatchObject({ categoryId: binding.categoryId, version: 1 });
      expect(binding.handler.retentionOutcomes.length).toBeGreaterThan(0);
    }
  });
});
