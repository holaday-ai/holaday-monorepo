import { DATA_CATEGORY_IDS, type DataCategoryId } from '../data-governance/types.js';

export const ACCOUNT_CLOSURE_USER_STATUSES = [
  'active',
  'suspended',
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

export const ACCOUNT_CLOSURE_NOTIFICATION_STATUSES = ['pending', 'accepted', 'failed'] as const;
export type AccountClosureNotificationStatus =
  (typeof ACCOUNT_CLOSURE_NOTIFICATION_STATUSES)[number];

export const ACCOUNT_CLOSURE_RETENTION_OUTCOMES = [
  'deleted',
  'anonymized',
  'restricted',
  'not_present',
] as const;
export type AccountClosureRetentionOutcome = (typeof ACCOUNT_CLOSURE_RETENTION_OUTCOMES)[number];

/** Checkpoints deliberately permit only opaque numeric pagination progress. */
export interface AccountClosureCheckpoint {
  targetIndex?: number;
  cursor?: number;
  processedCount?: number;
}

export type AccountClosureCategoryId = DataCategoryId;

const ACCOUNT_CLOSURE_CHECKPOINT_KEYS = new Set(['targetIndex', 'cursor', 'processedCount']);
const ACCOUNT_CLOSURE_CATEGORY_ID_SET = new Set<string>(DATA_CATEGORY_IDS);

/**
 * Validates the only checkpoint shape closure repositories may persist. This
 * function deliberately returns no input-derived diagnostics so callers never
 * log a rejected payload containing personal content.
 */
export function parseAccountClosureCheckpoint(value: unknown): AccountClosureCheckpoint | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error('Invalid account closure checkpoint');
  if (Object.keys(value).some((key) => !ACCOUNT_CLOSURE_CHECKPOINT_KEYS.has(key))) {
    throw new Error('Invalid account closure checkpoint');
  }

  const checkpoint: AccountClosureCheckpoint = {};
  if (Object.hasOwn(value, 'targetIndex')) {
    checkpoint.targetIndex = parseProgressValue(value.targetIndex);
  }
  if (Object.hasOwn(value, 'cursor')) checkpoint.cursor = parseProgressValue(value.cursor);
  if (Object.hasOwn(value, 'processedCount')) {
    checkpoint.processedCount = parseProgressValue(value.processedCount);
  }
  return checkpoint;
}

/**
 * Validates receipt category arrays before they cross the database write
 * boundary. Every value must be one of the canonical 13 governance IDs.
 */
export function parseAccountClosureReceiptCategoryIds(value: unknown): AccountClosureCategoryId[] {
  if (!Array.isArray(value)) throw new Error('Invalid account closure receipt categories');

  const categoryIds: AccountClosureCategoryId[] = [];
  const seen = new Set<string>();
  for (const categoryId of value) {
    if (
      typeof categoryId !== 'string' ||
      !ACCOUNT_CLOSURE_CATEGORY_ID_SET.has(categoryId) ||
      seen.has(categoryId)
    ) {
      throw new Error('Invalid account closure receipt categories');
    }
    seen.add(categoryId);
    categoryIds.push(categoryId as AccountClosureCategoryId);
  }
  return categoryIds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseProgressValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid account closure checkpoint');
  }
  return value;
}
