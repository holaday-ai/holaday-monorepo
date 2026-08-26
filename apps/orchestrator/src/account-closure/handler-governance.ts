import type { DataCategoryId } from '../data-governance/types.js';

export interface AccountClosureHandlerMetadata {
  readonly categoryId: DataCategoryId;
  readonly handlerRef: string;
}

/** Static source references shared by runtime registration and the read-only release audit. */
export const ACCOUNT_CLOSURE_HANDLER_METADATA: readonly AccountClosureHandlerMetadata[] = [
  handlerMetadata('account_security', 'account-security', 'accountSecurityClosureHandler'),
  handlerMetadata('task_execution', 'task-execution', 'taskExecutionClosureHandler'),
  handlerMetadata('cross_task_memory', 'cross-task-memory', 'crossTaskMemoryClosureHandler'),
  handlerMetadata(
    'energy_astrology_profile',
    'energy-astrology-profile',
    'energyAstrologyProfileClosureHandler',
  ),
  handlerMetadata(
    'stock_preference_profile',
    'stock-preference-profile',
    'stockPreferenceProfileClosureHandler',
  ),
  handlerMetadata('feedback_support', 'feedback-support', 'feedbackSupportClosureHandler'),
  handlerMetadata(
    'external_notifications',
    'external-notifications',
    'externalNotificationsClosureHandler',
  ),
  handlerMetadata(
    'extension_site_stats',
    'extension-site-stats',
    'extensionSiteStatsClosureHandler',
  ),
  handlerMetadata(
    'extension_login_cookies',
    'extension-login-cookies',
    'extensionLoginCookiesClosureHandler',
  ),
  handlerMetadata(
    'payments_entitlements',
    'payments-entitlements',
    'paymentsEntitlementsClosureHandler',
  ),
  handlerMetadata('partner_kyc_ledger', 'partner-kyc-ledger', 'partnerKycLedgerClosureHandler'),
  handlerMetadata('media_assets', 'media-assets', 'mediaAssetsClosureHandler'),
  handlerMetadata('analytics_logs', 'analytics-logs', 'analyticsLogsClosureHandler'),
];

function handlerMetadata(
  categoryId: DataCategoryId,
  moduleName: string,
  exportName: string,
): AccountClosureHandlerMetadata {
  return {
    categoryId,
    handlerRef: `apps/orchestrator/src/account-closure/handlers/${moduleName}.ts#${exportName}`,
  };
}
