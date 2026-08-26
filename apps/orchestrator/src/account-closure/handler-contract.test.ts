import { describe, expect, it, vi } from 'vitest';
import type { ClosureHandlerContext } from './handler-contract.js';
import { createExternalRetentionHandler } from './handler-contract.js';
import {
  ACCOUNT_CLOSURE_ANALYTICS_SCHEMA_MANIFEST,
  analyticsLogsClosureHandler,
} from './handlers/analytics-logs.js';
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
    const flag =
      handler.categoryId === 'feedback_support'
        ? 'ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED'
        : handler.categoryId === 'analytics_logs'
          ? 'ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED'
          : undefined;
    const previous = flag ? process.env[flag] : undefined;
    if (flag) process.env[flag] = 'true';
    const probeError = new Error('test-only probe outage');
    const failingContext = {
      db: { execute: vi.fn().mockRejectedValue(probeError) },
      signal: new AbortController().signal,
    } as unknown as ClosureHandlerContext;

    try {
      await expect(handler.run(failingContext)).rejects.toBe(probeError);
    } finally {
      if (flag) {
        if (previous === undefined) delete process.env[flag];
        else process.env[flag] = previous;
      }
    }
  });

  it.each([
    ['feedback', feedbackSupportClosureHandler, 'not_present'],
    ['analytics', analyticsLogsClosureHandler, 'restricted'],
  ])(
    'records the verified production retention result for the %s handler',
    async (_label, handler, expectedRetention) => {
      const flag =
        handler.categoryId === 'feedback_support'
          ? 'ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED'
          : 'ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED';
      const previous = process.env[flag];
      process.env[flag] = 'true';
      const probeRows =
        handler.categoryId === 'analytics_logs'
          ? Object.entries(ACCOUNT_CLOSURE_ANALYTICS_SCHEMA_MANIFEST).flatMap(
              ([tableName, columns]) =>
                Object.entries(columns).map(([columnName, definition]) => ({
                  tableName,
                  columnName,
                  ...definition,
                })),
            )
          : [{ association_count: 0 }];
      const restrictedContext = {
        db: {
          execute: vi.fn().mockResolvedValue([probeRows]),
          select: () => ({
            from: () => ({
              where: () => ({
                orderBy: () => ({ limit: async () => [] }),
                limit: async () => [],
              }),
            }),
          }),
        },
        pageSize: 100,
        checkpoint: null,
        request: { id: 1, userId: 1 },
        signal: new AbortController().signal,
      } as unknown as ClosureHandlerContext;

      try {
        await expect(handler.run(restrictedContext)).resolves.toEqual({
          kind: 'complete',
          processed: 0,
          retention: expectedRetention,
        });
      } finally {
        if (previous === undefined) delete process.env[flag];
        else process.env[flag] = previous;
      }
    },
  );

  it.each([
    ['feedback', 'ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED', feedbackSupportClosureHandler],
    ['analytics', 'ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED', analyticsLogsClosureHandler],
  ])('fails closed before the legacy %s sanitation prerequisite', async (_label, flag, handler) => {
    const previous = process.env[flag];
    delete process.env[flag];
    const guardedContext = {
      db: { execute: vi.fn().mockResolvedValue([[{ association_count: 0 }]]) },
      signal: new AbortController().signal,
    } as unknown as ClosureHandlerContext;
    try {
      await expect(handler.run(guardedContext)).rejects.toMatchObject({
        code: 'EXTERNAL_RETENTION_REQUIRED',
      });
    } finally {
      if (previous !== undefined) process.env[flag] = previous;
    }
  });
});
