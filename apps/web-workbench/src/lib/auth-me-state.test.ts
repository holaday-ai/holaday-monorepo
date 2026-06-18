import { describe, expect, it } from 'vitest';
import {
  normalizeAuthMeProfile,
  preferredAuthDisplayName,
} from './auth-me-state';

describe('auth.me state helpers', () => {
  it('normalizes auth profile payloads before app shell rendering', () => {
    expect(
      normalizeAuthMeProfile({
        userId: ' u1 ',
        email: ' yale@example.com ',
        phone: ' 13800138000 ',
        displayName: ' Yale ',
        plan: ' pro ',
        multiUser: 1,
        selectedRoles: [' researcher ', null, { unsafe: true }, 'operator'],
        role: 'admin',
        videoEnabled: true,
      }),
    ).toEqual({
      userId: 'u1',
      email: 'yale@example.com',
      phone: '13800138000',
      displayName: 'Yale',
      plan: 'pro',
      multiUser: true,
      selectedRoles: ['researcher', 'operator'],
      role: 'admin',
      videoEnabled: true,
    });
  });

  it('falls back to safe defaults for malformed auth profile payloads', () => {
    expect(normalizeAuthMeProfile('bad-root')).toEqual({
      userId: '',
      email: null,
      phone: null,
      displayName: null,
      plan: 'free',
      multiUser: false,
      selectedRoles: [],
      role: 'user',
      videoEnabled: false,
    });
    expect(
      normalizeAuthMeProfile({
        email: { unsafe: true },
        displayName: { unsafe: true },
        selectedRoles: { unsafe: true },
        role: 'owner',
      }),
    ).toMatchObject({
      email: null,
      displayName: null,
      selectedRoles: [],
      role: 'user',
    });
  });

  it('chooses stable display names without rendering objects', () => {
    expect(preferredAuthDisplayName({ displayName: ' Yale ', email: 'x@example.com' })).toBe(
      'Yale',
    );
    expect(preferredAuthDisplayName({ displayName: '138****8000', phone: '13800138000' })).toBe(
      '用户_8000',
    );
    expect(preferredAuthDisplayName({ displayName: '', email: ' yale@example.com ' })).toBe(
      'yale',
    );
    expect(
      preferredAuthDisplayName({
        displayName: { unsafe: true },
        phone: { unsafe: true },
        email: { unsafe: true },
      }),
    ).toBe('用户');
  });
});
