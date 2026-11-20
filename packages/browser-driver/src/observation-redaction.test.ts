import { describe, expect, it } from 'vitest';
import { REDACTED_OBSERVATION_VALUE, redactSensitiveValues } from './observation-redaction.js';

describe('redactSensitiveValues', () => {
  it('masks textbox lines whose value is sensitive, quoted or not', () => {
    const snapshot = [
      '- textbox "Password": hunter2',
      '- textbox "验证码": "934211"',
      '- textbox [disabled]: 12',
      '- textbox "Name": alice',
    ].join('\n');
    expect(redactSensitiveValues(snapshot, ['hunter2', '934211', '12'])).toBe(
      [
        `- textbox "Password": ${REDACTED_OBSERVATION_VALUE}`,
        `- textbox "验证码": ${REDACTED_OBSERVATION_VALUE}`,
        `- textbox [disabled]: ${REDACTED_OBSERVATION_VALUE}`,
        '- textbox "Name": alice',
      ].join('\n'),
    );
  });

  it('masks long secrets anywhere, including JSON-escaped forms', () => {
    const secret = 'p"a\\ss';
    const escaped = JSON.stringify(secret).slice(1, -1);
    const out = redactSensitiveValues(`- generic: echo ${escaped} and ${secret}`, [secret]);
    expect(out).not.toContain(secret);
    expect(out).not.toContain(escaped);
  });

  it('does not blank unrelated text for very short secrets', () => {
    expect(redactSensitiveValues('- text: page 1 of 9', ['1'])).toBe('- text: page 1 of 9');
  });

  it('is a no-op without sensitive values', () => {
    expect(redactSensitiveValues('- textbox "q": x', [])).toBe('- textbox "q": x');
  });
});
