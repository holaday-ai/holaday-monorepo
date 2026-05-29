import { describe, expect, it } from 'vitest';
import {
  authErrorMessage,
  isValidChinaPhone,
  isValidEmail,
  maskChinaPhone,
  normaliseCodeInput,
  normaliseEmailInput,
  normalisePhoneInput,
} from './login-gate-validation';

describe('login gate validation helpers', () => {
  it('normalises email without accepting malformed addresses', () => {
    expect(normaliseEmailInput('  user@example.com  ')).toBe('user@example.com');
    expect(isValidEmail(' user@example.com ')).toBe(true);
    expect(isValidEmail('user@example')).toBe(false);
    expect(isValidEmail('user example.com')).toBe(false);
  });

  it('normalises mainland China phone input and masks valid numbers', () => {
    expect(normalisePhoneInput('+86 138-0000-1234')).toBe('13800001234');
    expect(normalisePhoneInput('0086 138 0000 1234')).toBe('13800001234');
    expect(normalisePhoneInput('8613800001234')).toBe('13800001234');
    expect(normalisePhoneInput('138 0000 1234')).toBe('13800001234');
    expect(isValidChinaPhone('138 0000 1234')).toBe(true);
    expect(isValidChinaPhone('128 0000 1234')).toBe(false);
    expect(maskChinaPhone('13800001234')).toBe('138****1234');
  });

  it('keeps verification codes numeric and six digits at most', () => {
    expect(normaliseCodeInput('12 a 345678')).toBe('123456');
  });

  it('hides backend implementation errors from users', () => {
    expect(authErrorMessage(new Error('Unknown column phone in field list'), '稍后重试')).toBe(
      '稍后重试',
    );
    expect(authErrorMessage(new Error('验证码错误'), '稍后重试')).toBe('验证码错误');
    expect(authErrorMessage({ message: 'database unavailable' }, '稍后重试')).toBe(
      '稍后重试',
    );
  });
});
