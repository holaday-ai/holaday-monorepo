import { describe, expect, it, vi } from 'vitest';
import type { ClosureHandlerContext } from './handler-contract.js';
import { createExternalRetentionHandler } from './handler-contract.js';

describe('external-retention closure handler', () => {
  const context = {} as ClosureHandlerContext;

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

  it('fails closed when the capability probe itself errors', async () => {
    const probeError = new Error('test-only probe outage');
    const handler = createExternalRetentionHandler(
      'analytics_logs',
      vi.fn().mockRejectedValue(probeError),
    );

    await expect(handler.run(context)).rejects.toBe(probeError);
  });
});
