import { describe, expect, it } from 'vitest';
import {
  authGateFailureStatus,
  authSessionExpiredMessage,
  isAuthSessionError,
} from './auth-session';

describe('auth session helpers', () => {
  it('detects tRPC unauthorized codes', () => {
    expect(isAuthSessionError({ data: { code: 'UNAUTHORIZED' } })).toBe(true);
    expect(isAuthSessionError({ shape: { data: { code: 'UNAUTHORIZED' } } })).toBe(true);
  });

  it('detects auth http statuses', () => {
    expect(isAuthSessionError({ data: { httpStatus: 401 } })).toBe(true);
    expect(isAuthSessionError({ shape: { data: { httpStatus: 403 } } })).toBe(true);
  });

  it('does not treat network outages as expired sessions', () => {
    expect(isAuthSessionError(new Error('Failed to fetch'))).toBe(false);
    expect(isAuthSessionError(new Error('connect ECONNREFUSED 127.0.0.1:3001'))).toBe(false);
  });

  it('keeps a user-facing expired-session message', () => {
    expect(authSessionExpiredMessage()).toContain('重新登录');
  });

  it('keeps transient gate failures retryable instead of expiring the session', () => {
    expect(authGateFailureStatus({ data: { code: 'UNAUTHORIZED' } })).toBe(
      'no-auth',
    );
    expect(authGateFailureStatus(new Error('Failed to fetch'))).toBe(
      'error',
    );
  });
});
