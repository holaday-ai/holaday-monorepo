import {
  USER_BROWSER_PROTOCOL,
  nativeDocumentActivitySchema,
  selectedChromeSessionCommandSchema,
  userBrowserActivitySchema,
  userBrowserProtocolSchema,
} from '@holaday/shared-types';
import { expect, it } from 'vitest';

it('keeps native activity count-only and binds requests to a session', () => {
  const sessionId = 'c4860f52-6b76-4d18-a6ba-04165322af7d';
  expect(selectedChromeSessionCommandSchema.safeParse({ op: 'activity', sessionId }).success).toBe(
    true,
  );
  expect(
    selectedChromeSessionCommandSchema.safeParse({ op: 'activity', sessionId, text: 'private' })
      .success,
  ).toBe(false);
  const counts = { keys: 0, pointers: 0, composing: false, interrupted: false };
  expect(
    userBrowserActivitySchema.safeParse({
      ...counts,
      tabId: 42,
      stamp: 'a'.repeat(64),
      value: 'private',
    }).success,
  ).toBe(false);
  expect(
    nativeDocumentActivitySchema.safeParse({ ...counts, document: sessionId, input: 1 }).success,
  ).toBe(true);
  expect(
    nativeDocumentActivitySchema.safeParse({
      ...counts,
      document: sessionId,
      input: 1,
      key: 'private',
    }).success,
  ).toBe(false);
});
it('preserves the original v2 minimum while allowing optional new capabilities', () => {
  expect(userBrowserProtocolSchema.safeParse(USER_BROWSER_PROTOCOL).success).toBe(true);
  expect(
    userBrowserProtocolSchema.safeParse({
      ...USER_BROWSER_PROTOCOL,
      capabilities: [...USER_BROWSER_PROTOCOL.capabilities, 'human_activity_v1'],
    }).success,
  ).toBe(true);
});
