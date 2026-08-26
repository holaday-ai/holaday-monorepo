import {
  createRelationalDeleteHandler,
  directUserRows,
  rowsOwnedThroughParent,
} from '../handler-contract.js';

export const accountSecurityClosureHandler = createRelationalDeleteHandler({
  categoryId: 'account_security',
  // Verification rows have no user_id, so every read/delete joins the current
  // user row on the still-unreleased email identity.
  targets: [
    rowsOwnedThroughParent({
      tableName: 'verification_codes',
      parentTableName: 'users',
      childParentColumn: 'email',
      parentJoinColumn: 'email',
      parentUserColumn: 'id',
    }),
    directUserRows('user_mfa_recovery_codes'),
    directUserRows('webhook_idempotency'),
    directUserRows('api_keys'),
    directUserRows('sessions'),
    directUserRows('user_profiles'),
  ],
});
