import { describe, expect, it } from 'vitest';
import {
  profileDisplayName,
  profileInitial,
  profilePageSummary,
  profileUpdateMailBody,
} from './profile-page-state';

describe('profile page state helpers', () => {
  it('falls back from display name to email to unnamed', () => {
    expect(profileDisplayName({ displayName: '  Yale  ', email: 'yale@example.com' })).toBe('Yale');
    expect(profileDisplayName({ displayName: '', email: 'yale@example.com' })).toBe(
      'yale@example.com',
    );
    expect(profileDisplayName({ displayName: '', email: '' })).toBe('未命名');
  });

  it('builds a stable avatar initial', () => {
    expect(profileInitial({ displayName: 'Yale', email: 'yale@example.com' })).toBe('Y');
    expect(profileInitial({ displayName: '', email: 'yale@example.com' })).toBe('Y');
  });

  it('summarizes profile loading, failed, loaded, and incomplete states', () => {
    expect(profilePageSummary({ loading: true, error: null, email: null })).toBe('资料加载中…');
    expect(profilePageSummary({ loading: false, error: 'offline', email: null })).toBe(
      '资料加载失败',
    );
    expect(profilePageSummary({ loading: false, error: null, email: 'yale@example.com' })).toBe(
      '账号资料已加载',
    );
    expect(profilePageSummary({ loading: false, error: null, email: '' })).toBe('资料待完善');
  });

  it('pre-fills the update request with the account email', () => {
    expect(profileUpdateMailBody(' yale@example.com ')).toContain('注册邮箱：yale@example.com');
  });
});
