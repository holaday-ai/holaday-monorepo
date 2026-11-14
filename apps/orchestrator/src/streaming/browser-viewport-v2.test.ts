import { describe, expect, it } from 'vitest';
import { BrowserActionConfirmations } from './browser-viewport-v2.js';
const action = {
  taskId: 'tsk',
  runId: 'run',
  actor: 'human' as const,
  lane: 'cdp' as const,
  tabId: 't1',
  origin: 'https://example.com',
  observationRevision: 1,
  actionDigest: 'object:submit',
};
describe('server-owned one-use confirmations', () => {
  it('requires exact action, origin, object, run and tab plus short TTL', () => {
    const c = new BrowserActionConfirmations();
    for (const changed of [
      { origin: 'https://other.example' },
      { actionDigest: 'object:delete' },
      { tabId: 't2' },
      { runId: 'other' },
      { observationRevision: 2 },
    ]) {
      const n = c.issue(action, 1000);
      expect(c.consume(n, { ...action, ...changed }, 1001)).toBe(false);
    }
    const n = c.issue(action, 1000);
    expect(c.consume(n, action, 1001)).toBe(true);
    expect(c.consume(n, action, 1002)).toBe(false);
    expect(c.consume(c.issue(action, 1000), action, 61001)).toBe(false);
    expect(c.consume(c.issue(action, 1000), action, 999)).toBe(false);
  });
  it('invalidates all pending confirmations on reconnect, navigation or tab swap', () => {
    const c = new BrowserActionConfirmations();
    const n = c.issue(action, 1000);
    c.invalidate();
    expect(c.consume(n, action, 1001)).toBe(false);
  });
});
