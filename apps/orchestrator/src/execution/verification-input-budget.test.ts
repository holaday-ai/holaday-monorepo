import { describe, expect, it } from 'vitest';
import {
  checkVerificationAdmission,
  checkVerificationCandidate,
} from './verification-input-budget.js';

const LIMIT = { ok: false, code: 'VERIFICATION_INPUT_LIMIT' };

describe('verification admission budget', () => {
  it('accepts exactly 64 KiB of context and rejects the next byte', () => {
    expect(checkVerificationAdmission('x'.repeat(65_536), [])).toEqual({ ok: true });
    expect(checkVerificationAdmission('x'.repeat(65_537), [])).toEqual(LIMIT);
  });

  it('counts UTF-8 bytes rather than characters for context', () => {
    expect(checkVerificationAdmission(`${'界'.repeat(21_845)}x`, [])).toEqual({ ok: true });
    expect(checkVerificationAdmission(`${'界'.repeat(21_845)}xx`, [])).toEqual(LIMIT);
    expect(checkVerificationAdmission('🌱'.repeat(16_384), [])).toEqual({ ok: true });
    expect(checkVerificationAdmission(`${'🌱'.repeat(16_384)}x`, [])).toEqual(LIMIT);
  });

  it('adds text from all materials instead of granting each a separate budget', () => {
    expect(checkVerificationAdmission('{}', ['x'.repeat(32_768), 'y'.repeat(32_768)])).toEqual({
      ok: true,
    });
    expect(checkVerificationAdmission('{}', ['x'.repeat(32_768), 'y'.repeat(32_769)])).toEqual(
      LIMIT,
    );
    expect(checkVerificationAdmission('{}', ['界'.repeat(21_846)])).toEqual(LIMIT);
  });
});

describe('verification candidate budget', () => {
  it('accepts exactly 96 KiB of answer and rejects the next byte', () => {
    expect(checkVerificationCandidate('x'.repeat(98_304), '{}')).toEqual({ ok: true });
    expect(checkVerificationCandidate('x'.repeat(98_305), '{}')).toEqual(LIMIT);
    expect(checkVerificationCandidate('界'.repeat(32_768), '{}')).toEqual({ ok: true });
    expect(checkVerificationCandidate(`${'界'.repeat(32_768)}x`, '{}')).toEqual(LIMIT);
  });

  it('enforces the entire 256 KiB serialized request including protocol overhead', () => {
    expect(checkVerificationCandidate('answer', 'x'.repeat(262_144))).toEqual({ ok: true });
    expect(checkVerificationCandidate('answer', 'x'.repeat(262_145))).toEqual(LIMIT);
  });

  it('does not measure the unescaped payload instead of the serialized request', () => {
    const answer = '\u0000'.repeat(43_691);
    // Each NUL becomes six bytes (\\u0000) plus the surrounding JSON envelope.
    const request = JSON.stringify({ messages: [{ role: 'user', content: answer }] });
    expect(checkVerificationCandidate(answer, request)).toEqual(LIMIT);
  });

  it('returns a fixed code without echoing either private input', () => {
    const result = checkVerificationCandidate('PRIVATE_INPUT'.repeat(10_000), 'PRIVATE_REQUEST');
    expect(result).toEqual(LIMIT);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
});
