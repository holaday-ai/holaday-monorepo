import {
  USER_BROWSER_PROTOCOL,
  selectedChromeSessionCommandSchema,
  userBrowserProtocolSchema,
} from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
const id = '00000000-0000-4000-8000-000000000001';
const action = {
  kind: 'click',
  selector: { description: 'model hint', strategies: [{ kind: 'css', value: '#go' }] },
};
describe('user Chrome protocol v2', () => {
  it('requires versioned real-target and task-tab capabilities', () => {
    expect(userBrowserProtocolSchema.safeParse(USER_BROWSER_PROTOCOL).success).toBe(true);
    expect(userBrowserProtocolSchema.safeParse({ version: 1, capabilities: [] }).success).toBe(
      false,
    );
  });
  it('accepts describe bound to a positive extension observation revision', () => {
    expect(
      selectedChromeSessionCommandSchema.safeParse({
        op: 'describe',
        sessionId: id,
        action,
        observationRevision: 1,
      }).success,
    ).toBe(true);
    expect(
      selectedChromeSessionCommandSchema.safeParse({
        op: 'describe',
        sessionId: id,
        action,
        observationRevision: 0,
      }).success,
    ).toBe(false);
  });
  it('supports scroll/select and session-scoped task tabs without close', () => {
    for (const a of [
      { kind: 'scroll', payload: { deltaY: 400, deltaX: 0 } },
      { kind: 'select', selector: action.selector, payload: { text: 'One' } },
    ])
      expect(
        selectedChromeSessionCommandSchema.safeParse({ op: 'act', sessionId: id, action: a })
          .success,
      ).toBe(true);
    for (const command of [
      { op: 'tabs', operation: 'list' },
      { op: 'tabs', operation: 'new', url: 'https://example.com' },
      { op: 'tabs', operation: 'switch', tabId: 2 },
    ])
      expect(
        selectedChromeSessionCommandSchema.safeParse({ ...command, sessionId: id }).success,
      ).toBe(true);
    expect(
      selectedChromeSessionCommandSchema.safeParse({
        op: 'tabs',
        sessionId: id,
        operation: 'close',
        tabId: 1,
      }).success,
    ).toBe(false);
  });
});
