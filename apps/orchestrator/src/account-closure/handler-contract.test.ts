import { describe, expect, it, vi } from 'vitest';
import type { ClosureHandlerContext } from './handler-contract.js';
import { createExternalRetentionHandler } from './handler-contract.js';
import { analyticsLogsClosureHandler } from './handlers/analytics-logs.js';
import { energyAstrologyProfileClosureHandler } from './handlers/energy-astrology-profile.js';
import { feedbackSupportClosureHandler } from './handlers/feedback-support.js';

describe('external-retention closure handler', () => {
  const context = { signal: new AbortController().signal } as ClosureHandlerContext;

  it('blocks completion when external personal data requires a separate retention workflow', async () => {
    const handler = createExternalRetentionHandler('feedback_support', async () => 0);

    await expect(handler.run(context)).rejects.toMatchObject({
      code: 'EXTERNAL_RETENTION_REQUIRED',
    });
  });

  it('reports a relational capability change before the external-retention boundary', async () => {
    const handler = createExternalRetentionHandler('feedback_support', async () => 1);

    await expect(handler.run(context)).rejects.toMatchObject({ code: 'CAPABILITY_CHANGED' });
  });

  it.each([
    ['feedback', feedbackSupportClosureHandler],
    ['analytics', analyticsLogsClosureHandler],
    ['energy astrology', energyAstrologyProfileClosureHandler],
  ])('propagates a database probe error from the actual %s handler', async (_label, handler) => {
    const probeError = new Error('test-only probe outage');
    const failingContext = {
      db: { execute: vi.fn().mockRejectedValue(probeError) },
      signal: new AbortController().signal,
    } as unknown as ClosureHandlerContext;

    await expect(handler.run(failingContext)).rejects.toBe(probeError);
  });
});
