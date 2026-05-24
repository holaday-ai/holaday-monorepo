import { describe, expect, it } from 'vitest';
import { authRedirectTarget } from './auth-redirect';

describe('authRedirectTarget', () => {
  it('keeps same-origin app paths with query and hash', () => {
    expect(authRedirectTarget('?next=%2Fsettings%3Ftab%3Dapi%23keys')).toBe(
      '/settings?tab=api#keys',
    );
  });

  it('falls back for external or protocol-relative URLs', () => {
    expect(authRedirectTarget('?next=https%3A%2F%2Fevil.example%2Fsettings')).toBe('/');
    expect(authRedirectTarget('?next=%2F%2Fevil.example%2Fsettings')).toBe('/');
  });

  it('falls back for auth entry loops and empty values', () => {
    expect(authRedirectTarget('?next=%2Flogin')).toBe('/');
    expect(authRedirectTarget('?next=%2Fregister%3Fnext%3D%252Fsettings')).toBe('/');
    expect(authRedirectTarget('')).toBe('/');
  });
});
