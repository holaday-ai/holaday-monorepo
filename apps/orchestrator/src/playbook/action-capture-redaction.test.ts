import { describe, expect, it } from 'vitest';
import {
  type CapturedFieldAttrs,
  REDACTED_INPUT_VALUE,
  isSensitiveField,
  redactTypedValue,
} from './action-capture-redaction.js';

const normalText: CapturedFieldAttrs = {
  type: 'text',
  autocomplete: 'off',
  name: 'search_query',
  id: 'q',
  ariaLabel: '搜索',
};

describe('isSensitiveField', () => {
  it('flags input[type=password]', () => {
    expect(isSensitiveField({ type: 'password' })).toBe(true);
    expect(isSensitiveField({ type: 'PASSWORD' })).toBe(true); // case-insensitive
  });

  it('flags every sensitive autocomplete token', () => {
    for (const ac of [
      'current-password',
      'new-password',
      'one-time-code',
      'cc-number',
      'cc-csc',
      'cc-exp',
    ]) {
      expect(isSensitiveField({ type: 'text', autocomplete: ac })).toBe(true);
      expect(isSensitiveField({ type: 'text', autocomplete: ac.toUpperCase() })).toBe(true);
    }
  });

  it('flags name / id / aria-label matching the sensitive regex', () => {
    expect(isSensitiveField({ name: 'user_password' })).toBe(true);
    expect(isSensitiveField({ name: 'passwd' })).toBe(true);
    expect(isSensitiveField({ id: 'otp-code' })).toBe(true);
    expect(isSensitiveField({ name: 'cvv' })).toBe(true);
    expect(isSensitiveField({ id: 'card-number' })).toBe(true);
    expect(isSensitiveField({ ariaLabel: '银行卡 card' })).toBe(true);
    expect(isSensitiveField({ name: 'ssn' })).toBe(true);
  });

  it('does NOT flag an ordinary text field', () => {
    expect(isSensitiveField(normalText)).toBe(false);
    expect(
      isSensitiveField({ type: 'text', name: 'address', autocomplete: 'street-address' }),
    ).toBe(false);
  });

  it('fail-safe: null / undefined descriptor is treated as sensitive', () => {
    expect(isSensitiveField(null)).toBe(true);
    expect(isSensitiveField(undefined)).toBe(true);
    expect(isSensitiveField({})).toBe(false); // an empty (but present) descriptor is not a secret
  });
});

describe('redactTypedValue', () => {
  it('null raw text stays null (non-type action carries no input_value)', () => {
    expect(redactTypedValue(normalText, null)).toBeNull();
    expect(redactTypedValue(null, null)).toBeNull();
  });

  it('sensitive field → redaction marker, raw secret never returned', () => {
    expect(redactTypedValue({ type: 'password' }, 'hunter2')).toBe(REDACTED_INPUT_VALUE);
    expect(redactTypedValue({ autocomplete: 'one-time-code' }, '123456')).toBe(
      REDACTED_INPUT_VALUE,
    );
    expect(redactTypedValue({ name: 'cvv' }, '999')).toBe(REDACTED_INPUT_VALUE);
  });

  it('fail-safe: unknown descriptor redacts the value', () => {
    expect(redactTypedValue(null, 'maybe-secret')).toBe(REDACTED_INPUT_VALUE);
  });

  it('ordinary field → stores the raw text verbatim', () => {
    expect(redactTypedValue(normalText, '上海 天气')).toBe('上海 天气');
  });
});
