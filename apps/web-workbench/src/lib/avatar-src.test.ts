import { describe, expect, it } from 'vitest';
import { avatarSrc } from './avatar-src';

describe('avatarSrc (G7 / Q-8: no avatar request to another site)', () => {
  it('sends a Google profile photo through the HOLA DAY proxy', () => {
    const google = 'https://lh3.googleusercontent.com/a/ACg8ocJxYz1234567890abc=s96-c';
    expect(avatarSrc(google)).toBe(`/api/avatar?url=${encodeURIComponent(google)}`);
  });
  it('keeps same-site paths and inline images', () => {
    expect(avatarSrc('/api/files/avatar-1.png')).toBe('/api/files/avatar-1.png');
    expect(avatarSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });
  it('drops any other external address (initials fallback)', () => {
    expect(avatarSrc('https://thirdwx.qlogo.cn/mmopen/x/132')).toBeNull();
    expect(avatarSrc('https://lh3.googleusercontent.com/a/x?sz=50')).toBeNull();
    expect(avatarSrc('//evil.example/a.png')).toBeNull();
    expect(avatarSrc(null)).toBeNull();
    expect(avatarSrc('')).toBeNull();
  });
});
