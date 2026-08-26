export const ACCOUNT_CLOSURE_USER_STATUSES = [
  'active',
  'closure_pending',
  'closure_processing',
  'closed',
] as const;

export type AccountClosureUserStatus = (typeof ACCOUNT_CLOSURE_USER_STATUSES)[number];

export const ACCOUNT_CLOSURE_REQUEST_STATUSES = [
  'pending_grace',
  'cancelled',
  'processing',
  'needs_attention',
  'completed',
] as const;

export type AccountClosureRequestStatus = (typeof ACCOUNT_CLOSURE_REQUEST_STATUSES)[number];

export const ACCOUNT_CLOSURE_STEP_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'retryable',
  'blocked',
  'skipped',
] as const;

export type AccountClosureStepStatus = (typeof ACCOUNT_CLOSURE_STEP_STATUSES)[number];

export const ACCOUNT_CLOSURE_REASON_CODES = [
  'not_using',
  'privacy',
  'cost',
  'missing_features',
  'other_fixed',
] as const;

export type AccountClosureReasonCode = (typeof ACCOUNT_CLOSURE_REASON_CODES)[number];

export const ACCOUNT_CLOSURE_STEP_ERROR_CODES = [
  'provider_unavailable',
  'provider_rejected',
  'storage_unavailable',
  'database_unavailable',
  'handler_missing',
  'configuration',
  'invariant_violation',
] as const;

export type AccountClosureStepErrorCode = (typeof ACCOUNT_CLOSURE_STEP_ERROR_CODES)[number];

export const ACCOUNT_CLOSURE_CHALLENGE_ACTIONS = ['begin', 'cancel'] as const;
export type AccountClosureChallengeAction = (typeof ACCOUNT_CLOSURE_CHALLENGE_ACTIONS)[number];

export const ACCOUNT_CLOSURE_CHANNELS = ['email', 'sms'] as const;
export type AccountClosureChannel = (typeof ACCOUNT_CLOSURE_CHANNELS)[number];

export const ACCOUNT_CLOSURE_RECEIPT_KINDS = ['application', 'completion'] as const;
export type AccountClosureReceiptKind = (typeof ACCOUNT_CLOSURE_RECEIPT_KINDS)[number];

export const ACCOUNT_CLOSURE_NOTIFICATION_STATUSES = [
  'pending',
  'accepted',
  'failed',
] as const;
export type AccountClosureNotificationStatus =
  (typeof ACCOUNT_CLOSURE_NOTIFICATION_STATUSES)[number];

/** Checkpoints deliberately permit only opaque numeric pagination progress. */
export interface AccountClosureCheckpoint {
  cursor?: number;
  processedCount?: number;
}
