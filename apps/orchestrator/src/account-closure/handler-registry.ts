import { DATA_CATEGORY_IDS, type DataCategoryId } from '../data-governance/types.js';
import { type AccountClosureHandler, createDeferredClosureHandler } from './handler-contract.js';
import { accountSecurityClosureHandler } from './handlers/account-security.js';
import { analyticsLogsClosureHandler } from './handlers/analytics-logs.js';
import { crossTaskMemoryClosureHandler } from './handlers/cross-task-memory.js';
import { energyAstrologyProfileClosureHandler } from './handlers/energy-astrology-profile.js';
import { extensionLoginCookiesClosureHandler } from './handlers/extension-login-cookies.js';
import { extensionSiteStatsClosureHandler } from './handlers/extension-site-stats.js';
import { externalNotificationsClosureHandler } from './handlers/external-notifications.js';
import { feedbackSupportClosureHandler } from './handlers/feedback-support.js';
import { stockPreferenceProfileClosureHandler } from './handlers/stock-preference-profile.js';
import { taskExecutionClosureHandler } from './handlers/task-execution.js';

export const ACCOUNT_CLOSURE_HANDLERS: readonly AccountClosureHandler[] = [
  accountSecurityClosureHandler,
  taskExecutionClosureHandler,
  crossTaskMemoryClosureHandler,
  energyAstrologyProfileClosureHandler,
  stockPreferenceProfileClosureHandler,
  feedbackSupportClosureHandler,
  externalNotificationsClosureHandler,
  extensionSiteStatsClosureHandler,
  extensionLoginCookiesClosureHandler,
  createDeferredClosureHandler('payments_entitlements'),
  createDeferredClosureHandler('partner_kyc_ledger'),
  createDeferredClosureHandler('media_assets'),
  analyticsLogsClosureHandler,
];

export function assertAccountClosureHandlerContract(
  categoryIds: readonly string[],
  handlers: readonly AccountClosureHandler[],
): void {
  const categories = new Set(categoryIds);
  const registered = new Set<string>();
  const valid =
    categories.size === categoryIds.length &&
    handlers.length === categoryIds.length &&
    handlers.every((handler) => {
      if (handler.version !== 1 || registered.has(handler.categoryId)) return false;
      registered.add(handler.categoryId);
      return categories.has(handler.categoryId);
    }) &&
    categoryIds.every((categoryId) => registered.has(categoryId));
  if (!valid) throw new Error('Account closure handler contract mismatch');
}

assertAccountClosureHandlerContract(DATA_CATEGORY_IDS, ACCOUNT_CLOSURE_HANDLERS);

const HANDLER_BY_CATEGORY = new Map(
  ACCOUNT_CLOSURE_HANDLERS.map((handler) => [handler.categoryId, handler] as const),
);

export function getAccountClosureHandler(categoryId: string): AccountClosureHandler {
  const handler = HANDLER_BY_CATEGORY.get(categoryId as DataCategoryId);
  if (!handler) throw new Error('Account closure handler missing');
  return handler;
}
