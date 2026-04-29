/**
 * Phase 14 audit follow-up — pool/concurrency refactor.
 * Pins the per-plan concurrency limits + the upgrade-pitch error
 * copy so a future drift in PLAN_CATALOGUE surfaces here.
 */

import { describe, expect, it } from 'vitest';
import {
  concurrencyExhaustedMessage,
  getConcurrencyLimit,
} from './quota-service.js';

describe('getConcurrencyLimit — Phase 14 limits', () => {
  it('free → 1', () => {
    expect(getConcurrencyLimit('free')).toBe(1);
  });
  it('basic → 3', () => {
    expect(getConcurrencyLimit('basic')).toBe(3);
  });
  it('pro → 5', () => {
    expect(getConcurrencyLimit('pro')).toBe(5);
  });
});

describe('concurrencyExhaustedMessage — upgrade-pitch copy', () => {
  it('free copy mentions both basic and pro upgrade paths', () => {
    const msg = concurrencyExhaustedMessage('free');
    expect(msg).toContain('免费版');
    expect(msg).toContain('1');
    expect(msg).toContain('基础版');
    expect(msg).toContain('3');
    expect(msg).toContain('专业版');
    expect(msg).toContain('5');
  });

  it('basic copy mentions only pro upgrade (no down-pitch)', () => {
    const msg = concurrencyExhaustedMessage('basic');
    expect(msg).toContain('基础版');
    expect(msg).toContain('3');
    expect(msg).toContain('专业版');
    expect(msg).toContain('5');
    expect(msg).not.toContain('免费版');
  });

  it('pro copy is a true ceiling — no upsell', () => {
    const msg = concurrencyExhaustedMessage('pro');
    expect(msg).toContain('专业版');
    expect(msg).toContain('5');
    expect(msg).not.toContain('升级');
  });

  it('numbers are sourced from PLAN_CATALOGUE — drift would fail above', () => {
    // Sanity: the numbers asserted above must equal the catalogue;
    // if someone bumps a plan's concurrency without rechecking the
    // copy, this test surfaces the discrepancy.
    expect(concurrencyExhaustedMessage('free')).toContain(
      String(getConcurrencyLimit('free')),
    );
    expect(concurrencyExhaustedMessage('basic')).toContain(
      String(getConcurrencyLimit('basic')),
    );
    expect(concurrencyExhaustedMessage('pro')).toContain(
      String(getConcurrencyLimit('pro')),
    );
  });
});
