/**
 * Phase 22a follow-up — generate-runner unit tests.
 *
 * Test A: happy path — mocked Anthropic returns text → outcome=completed
 *         with the right tokens / summary.
 * Test (timeout): API hangs past timeoutMs → AbortController fires →
 *                 outcome=failed with the friendly Chinese reason. This
 *                 is the "Test E for generate" — the runner can't sit
 *                 at status='executing' forever.
 * Test (api error): API rejects with a non-abort error → outcome=failed
 *                   with the raw error message.
 * Test (empty response): API returns no text blocks → outcome=failed.
 * Test (skill hint): explicit skillId is preferred over keyword-derived
 *                    classifyRole.
 */

import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import type Anthropic from '@anthropic-ai/sdk';
import { runGenerateTask } from './generate-runner.js';

function makeLogger() {
  return pino({ level: 'silent' });
}

/**
 * Build a minimal Anthropic client stub with a scripted messages.stream.
 *
 * Phase 24 RC follow-up — runner switched messages.create →
 * messages.stream. The mock returns an EventEmitter-like object with
 * on('text', ...) for delta subscription and finalMessage() for the
 * canonical response. Tests can pass a textOut string and the mock
 * fires one synthetic 'text' delta + resolves finalMessage() with a
 * single text content block.
 */
function makeClient(opts: {
  textOut?: string;
  rejectWith?: Error;
  /** When true, the stream never resolves (simulates a hang). The
   *  test must rely on the runner's AbortController to break the wait. */
  hangForever?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  stopReason?: string;
}): Anthropic {
  const stream = vi.fn(
    (
      _params: unknown,
      reqOpts?: { signal?: AbortSignal },
    ): unknown => {
      const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
      const emit = (event: string, ...args: unknown[]): void => {
        const subs = listeners[event] ?? [];
        for (const fn of subs) fn(...args);
      };
      const finalMessagePromise = new Promise<unknown>((resolve, reject) => {
        // Defer one tick so callers have a chance to attach .on('text')
        // before we synthesise the delta.
        queueMicrotask(() => {
          if (opts.hangForever) {
            if (reqOpts?.signal) {
              const onAbort = (): void => {
                const err = new Error('Request was aborted.');
                err.name = 'AbortError';
                reject(err);
              };
              if (reqOpts.signal.aborted) onAbort();
              else reqOpts.signal.addEventListener('abort', onAbort);
            }
            // Never resolves unless aborted.
            return;
          }
          if (opts.rejectWith) {
            reject(opts.rejectWith);
            return;
          }
          if (opts.textOut) emit('text', opts.textOut, opts.textOut);
          resolve({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-6',
            stop_reason: opts.stopReason ?? 'end_turn',
            stop_sequence: null,
            content: opts.textOut
              ? [{ type: 'text', text: opts.textOut, citations: null }]
              : [],
            usage: {
              input_tokens: opts.inputTokens ?? 100,
              output_tokens: opts.outputTokens ?? 50,
            },
          });
        });
      });
      return {
        on(event: string, fn: (...args: unknown[]) => void) {
          (listeners[event] ??= []).push(fn);
          return this;
        },
        finalMessage() {
          return finalMessagePromise;
        },
      };
    },
  );
  return {
    messages: {
      stream,
    },
  } as unknown as Anthropic;
}

describe('runGenerateTask (phase 22a)', () => {
  describe('Test A: happy path', () => {
    it('completed outcome with summary + tokens + duration', async () => {
      const client = makeClient({
        textOut: '这是一份产品方案的草稿……',
        inputTokens: 1234,
        outputTokens: 567,
      });
      const outcome = await runGenerateTask({
        taskId: 'tsk_A',
        userId: 'usr_test',
        intent: '写一份 AI 产品 PRD 草案',
        client,
        logger: makeLogger(),
      });
      expect(outcome.status).toBe('completed');
      expect(outcome.summary).toBe('这是一份产品方案的草稿……');
      expect(outcome.inputTokens).toBe(1234);
      expect(outcome.outputTokens).toBe(567);
      expect(outcome.reason).toBeUndefined();
      expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Timeout: AbortController fires when API hangs', () => {
    it('returns failed with a Chinese timeout reason after timeoutMs', async () => {
      const client = makeClient({ hangForever: true });
      const start = Date.now();
      const outcome = await runGenerateTask({
        taskId: 'tsk_timeout',
        userId: 'usr_test',
        intent: '翻译这段话',
        client,
        logger: makeLogger(),
        timeoutMs: 200, // tight timeout for the test
      });
      const elapsed = Date.now() - start;

      expect(outcome.status).toBe('failed');
      expect(outcome.reason).toMatch(/超时/);
      // Should NOT take 120s — aborted at our 200ms cap.
      expect(elapsed).toBeLessThan(2_000);
      expect(outcome.summary).toBe('');
    });
  });

  describe('API rejection: non-abort error reported as failed', () => {
    it('passes through the SDK error message', async () => {
      const client = makeClient({
        rejectWith: new Error('Rate limited by Anthropic'),
      });
      const outcome = await runGenerateTask({
        taskId: 'tsk_err',
        userId: 'usr_test',
        intent: '写一段开场白',
        client,
        logger: makeLogger(),
      });
      expect(outcome.status).toBe('failed');
      expect(outcome.reason).toBe('Rate limited by Anthropic');
    });
  });

  describe('Empty response: no text blocks → failed', () => {
    it('reports a friendly empty-response reason after retries are exhausted', async () => {
      // Phase 24 RC follow-up — runGenerateTask now retries empty
      // responses once before giving up. The mock client returns
      // empty text on every call (so both attempts come back empty);
      // outcome message reflects the post-retry exhaustion.
      const client = makeClient({ textOut: '' });
      const outcome = await runGenerateTask({
        taskId: 'tsk_empty',
        userId: 'usr_test',
        intent: '随便写点什么',
        client,
        logger: makeLogger(),
      });
      expect(outcome.status).toBe('failed');
      expect(outcome.reason).toMatch(/没有返回|empty|空内容/i);
      expect(outcome.summary).toBe('');
    });
  });

  describe('Defensive: completes without attachments', () => {
    // Phase 21b-22a — the attachments path threads files into the user
    // message. Verify that the no-attachments branch still works (most
    // generate intents don't carry files).
    it('runs cleanly with no attachments', async () => {
      const client = makeClient({ textOut: 'OK' });
      const outcome = await runGenerateTask({
        taskId: 'tsk_noattach',
        userId: 'usr_test',
        intent: '说 OK',
        client,
        logger: makeLogger(),
      });
      expect(outcome.status).toBe('completed');
      expect(outcome.summary).toBe('OK');
    });
  });
});
