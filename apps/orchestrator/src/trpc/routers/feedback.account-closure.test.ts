import { describe, expect, it, vi } from 'vitest';
import { createFeedbackRouter } from './feedback.js';

const SENTINEL = 'feedback-private-sentinel';

describe('feedback governed storage boundary', () => {
  it('persists the case before private delivery and never leaks identity or content to email/logs', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const sender = {
      privateDelivery: true as const,
      isAvailable: () => true,
      send: vi.fn().mockRejectedValue(new Error(`${SENTINEL}-provider-body`)),
    };
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ id: 42 }] }),
        }),
      }),
      insert: () => ({
        values: async (value: Record<string, unknown>) => {
          inserted.push(value);
        },
      }),
    };
    const router = createFeedbackRouter({
      emailSender: sender,
      createCaseRef: () => 'fbc_random_case_ref',
    });
    const caller = router.createCaller({
      db,
      logger,
      userId: `${SENTINEL}-external-user`,
      req: { headers: { 'user-agent': `${SENTINEL}-ua` } },
    } as never);

    await expect(
      caller.submit({ message: `${SENTINEL}-message`, context: `${SENTINEL}-context` }),
    ).resolves.toEqual({ ok: true });
    expect(inserted).toEqual([
      expect.objectContaining({
        externalId: 'fbc_random_case_ref',
        userId: 42,
        message: `${SENTINEL}-message`,
        context: `${SENTINEL}-context`,
        userAgent: `${SENTINEL}-ua`,
      }),
    ]);
    expect(sender.send).toHaveBeenCalledWith({
      to: expect.any(String),
      subject: '[HOLA DAY feedback] fbc_random_case_ref',
      text: 'New governed feedback case: fbc_random_case_ref',
    });

    const externalOutputs = JSON.stringify({
      email: sender.send.mock.calls,
      logs: [...logger.info.mock.calls, ...logger.error.mock.calls],
    });
    expect(externalOutputs).toContain('fbc_random_case_ref');
    expect(externalOutputs).not.toContain(SENTINEL);
  });

  it('bounds an oversized user-agent before persisting the governed case', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const router = createFeedbackRouter({
      emailSender: {
        privateDelivery: true as const,
        isAvailable: () => true,
        send: vi.fn(async () => undefined),
      },
      createCaseRef: () => 'fbc_bounded_ua',
    });
    const caller = router.createCaller({
      db: {
        select: () => ({
          from: () => ({ where: () => ({ limit: async () => [{ id: 42 }] }) }),
        }),
        insert: () => ({
          values: async (value: Record<string, unknown>) => {
            inserted.push(value);
          },
        }),
      },
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      userId: 'usr_feedback_test',
      req: { headers: { 'user-agent': 'u'.repeat(2_000) } },
    } as never);

    await expect(caller.submit({ message: 'bounded' })).resolves.toEqual({ ok: true });
    expect(inserted[0]?.userAgent).toBe('u'.repeat(512));
  });
});
