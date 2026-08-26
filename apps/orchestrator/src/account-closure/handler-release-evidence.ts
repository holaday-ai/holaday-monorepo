import type { DataCategoryId } from '../data-governance/types.js';
import type { AccountClosureHandler, ClosureHandlerContext } from './handler-contract.js';
import {
  ACCOUNT_CLOSURE_HANDLER_BINDINGS,
  type AccountClosureHandlerBinding,
} from './handler-registry.js';

const RELATIONAL_TEST =
  'apps/orchestrator/src/account-closure/handlers/relational-handlers.integration.test.ts';
const FINANCIAL_TEST =
  'apps/orchestrator/src/account-closure/tombstone-service.integration.test.ts';
const MEDIA_TEST =
  'apps/orchestrator/src/account-closure/handlers/media-assets.integration.test.ts';

export const ACCOUNT_CLOSURE_HANDLER_EXECUTION_TEST =
  'apps/orchestrator/src/account-closure/handler-release-contract.test.ts';

const BEHAVIOR_TEST_BY_CATEGORY: Readonly<Record<DataCategoryId, string>> = {
  account_security: RELATIONAL_TEST,
  task_execution: RELATIONAL_TEST,
  cross_task_memory: RELATIONAL_TEST,
  energy_astrology_profile: RELATIONAL_TEST,
  stock_preference_profile: RELATIONAL_TEST,
  feedback_support: RELATIONAL_TEST,
  external_notifications: RELATIONAL_TEST,
  extension_site_stats: RELATIONAL_TEST,
  extension_login_cookies: RELATIONAL_TEST,
  payments_entitlements: FINANCIAL_TEST,
  partner_kyc_ledger: FINANCIAL_TEST,
  media_assets: MEDIA_TEST,
  analytics_logs: RELATIONAL_TEST,
};

export interface AccountClosureHandlerExecutionEvidence {
  readonly categoryId: DataCategoryId;
  readonly handlerRef: string;
  readonly behaviorTestRef: string;
  readonly handler: AccountClosureHandler;
  execute(context: ClosureHandlerContext): ReturnType<AccountClosureHandler['run']>;
}

/**
 * Shared by the release audit and an executable contract test. The private
 * factory closes `execute` over the exact runtime-bound handler, so an imported
 * name plus an unrelated `.run()` cannot masquerade as handler execution.
 */
export const ACCOUNT_CLOSURE_HANDLER_EXECUTION_EVIDENCE: readonly AccountClosureHandlerExecutionEvidence[] =
  ACCOUNT_CLOSURE_HANDLER_BINDINGS.map((binding) =>
    createExecutionEvidence(binding, BEHAVIOR_TEST_BY_CATEGORY[binding.categoryId]),
  );

function createExecutionEvidence(
  binding: AccountClosureHandlerBinding,
  behaviorTestRef: string,
): AccountClosureHandlerExecutionEvidence {
  return Object.freeze({
    categoryId: binding.categoryId,
    handlerRef: binding.handlerRef,
    behaviorTestRef,
    handler: binding.handler,
    execute: (context: ClosureHandlerContext) => binding.handler.run(context),
  });
}
