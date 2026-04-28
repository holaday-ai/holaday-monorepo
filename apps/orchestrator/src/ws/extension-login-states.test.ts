/**
 * Phase 14 — schema tests for the extension login-state message.
 * Server-side handler is exercised via the integration suite (the
 * map is module-private in server.ts); this file just nails down
 * the wire format so any drift in the discriminated union surfaces
 * as a failing test rather than a runtime BAD_FRAME log.
 */

import { parseClientMessage } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';

describe('client.extension.login_states schema', () => {
  it('accepts a non-empty domain → boolean map', () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: 'client.extension.login_states',
        states: { 'jd.com': true, 'taobao.com': false },
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('client.extension.login_states');
      if (result.data.type === 'client.extension.login_states') {
        expect(result.data.states['jd.com']).toBe(true);
        expect(result.data.states['taobao.com']).toBe(false);
      }
    }
  });

  it('accepts an empty states object', () => {
    const result = parseClientMessage(
      JSON.stringify({ type: 'client.extension.login_states', states: {} }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects non-boolean values', () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: 'client.extension.login_states',
        states: { 'jd.com': 'yes' },
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects more than 32 domain entries', () => {
    const states: Record<string, boolean> = {};
    for (let i = 0; i < 33; i += 1) states[`d${i}.com`] = i % 2 === 0;
    const result = parseClientMessage(
      JSON.stringify({ type: 'client.extension.login_states', states }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects missing type discriminator', () => {
    const result = parseClientMessage(JSON.stringify({ states: { 'jd.com': true } }));
    expect(result.success).toBe(false);
  });

  it('rejects malformed json', () => {
    const result = parseClientMessage('{bad json');
    expect(result.success).toBe(false);
  });
});
