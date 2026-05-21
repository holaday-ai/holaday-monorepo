import { describe, expect, it } from 'vitest';
import { classifyFriendlyFailure } from './failure-copy';

describe('classifyFriendlyFailure', () => {
  it('uses terminal-safe login recovery copy', () => {
    expect(classifyFriendlyFailure('login required').subtitle).toBe(
      '请重新执行；如果再次停在登录页，请先完成登录。',
    );
  });

  it('uses terminal-safe captcha recovery copy', () => {
    expect(classifyFriendlyFailure('Cloudflare human verification').subtitle).toBe(
      '请重新执行；如果再次出现验证，请在浏览器里手动完成。',
    );
  });

  it('keeps timeout copy concise', () => {
    expect(classifyFriendlyFailure('SUPERCAR_TIMEOUT').title).toBe('操作超时');
  });
});
