import { describe, expect, it } from 'vitest';
import { normalizeAuthMeProfile, preferredAuthDisplayName } from './auth-me-state';

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
        teamProjectsEnabled: true,
        teamTaskLifecycleEnabled: true,
        modelDataRegion: 'intl',
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
      teamProjectsEnabled: true,
      teamTaskLifecycleEnabled: true,
      modelDataRegion: 'intl',
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
      teamProjectsEnabled: false,
      teamTaskLifecycleEnabled: false,
      modelDataRegion: null,
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

  it.each([
    ['absent', {}],
    ['null', { teamProjectsEnabled: null }],
    ['false', { teamProjectsEnabled: false }],
    ['a truthy string', { teamProjectsEnabled: 'true' }],
    ['a truthy number', { teamProjectsEnabled: 1 }],
  ])('defaults team workspace rollout state to false for %s', (_label, payload) => {
    expect(normalizeAuthMeProfile(payload).teamProjectsEnabled).toBe(false);
  });

  it('accepts only literal true for team workspace rollout state', () => {
    expect(normalizeAuthMeProfile({ teamProjectsEnabled: true }).teamProjectsEnabled).toBe(true);
  });

  it.each([
    ['absent', {}],
    ['null', { teamTaskLifecycleEnabled: null }],
    ['false', { teamTaskLifecycleEnabled: false }],
    ['a truthy string', { teamTaskLifecycleEnabled: 'true' }],
    ['a truthy number', { teamTaskLifecycleEnabled: 1 }],
  ])('defaults team task lifecycle rollout state to false for %s', (_label, payload) => {
    expect(normalizeAuthMeProfile(payload).teamTaskLifecycleEnabled).toBe(false);
  });

  it('accepts only literal true for team task lifecycle rollout state', () => {
    expect(
      normalizeAuthMeProfile({ teamTaskLifecycleEnabled: true }).teamTaskLifecycleEnabled,
    ).toBe(true);
  });

  it.each([
    ['cn', 'cn'],
    ['intl', 'intl'],
    [' CN ', null],
    ['unknown', null],
    [null, null],
  ])('normalizes model data region %s to %s', (value, expected) => {
    expect(normalizeAuthMeProfile({ modelDataRegion: value }).modelDataRegion).toBe(expected);
  });

  it('chooses stable display names without rendering objects', () => {
    expect(preferredAuthDisplayName({ displayName: ' Yale ', email: 'x@example.com' })).toBe(
      'Yale',
    );
    expect(preferredAuthDisplayName({ displayName: '138****8000', phone: '13800138000' })).toBe(
      '用户_8000',
    );
    expect(preferredAuthDisplayName({ displayName: '', email: ' yale@example.com ' })).toBe('yale');
    expect(
      preferredAuthDisplayName({
        displayName: { unsafe: true },
        phone: { unsafe: true },
        email: { unsafe: true },
      }),
    ).toBe('用户');
  });
});
