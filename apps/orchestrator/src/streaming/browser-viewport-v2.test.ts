import { describe, expect, it } from 'vitest';
import { BrowserActionConfirmations, BrowserFrameGuard } from './browser-viewport-v2.js';
const frame = {
  frameId: 'f1',
  tabId: 't1',
  viewportRevision: 1,
  cssWidth: 1600,
  cssHeight: 900,
  imageWidth: 1440,
  imageHeight: 810,
  pageScaleFactor: 1,
  offsetTop: 0,
  scrollOffset: { x: 0, y: 0 },
  capturedAt: 1000,
};
const action = {
  taskId: 'tsk',
  runId: 'run',
  actor: 'human' as const,
  lane: 'cdp' as const,
  tabId: 't1',
  origin: 'https://example.com',
  observationRevision: 1,
  actionDigest: 'object:submit',
  lease: 'lease',
};
describe('frame guard', () => {
  it('rejects stale, forged, unacknowledged and previous tab observations', () => {
    const g = new BrowserFrameGuard();
    g.observe(frame);
    expect(g.validate(frame, 1500)).toBe(true);
    expect(g.validate(frame, 6001)).toBe(false);
    expect(g.validate({ ...frame, frameId: 'fake' }, 1500)).toBe(false);
    g.invalidate();
    expect(g.validate(frame, 1500)).toBe(false);
    g.observe({ ...frame, frameId: 'f2', tabId: 't2' });
    expect(g.validate(frame, 1500)).toBe(false);
  });
});
describe('server-owned one-use confirmations', () => {
  it('requires exact action, origin, object, lease, run and tab plus short TTL', () => {
    const c = new BrowserActionConfirmations();
    for (const changed of [
      { origin: 'https://other.example' },
      { actionDigest: 'object:delete' },
      { tabId: 't2' },
      { lease: 'other' },
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
