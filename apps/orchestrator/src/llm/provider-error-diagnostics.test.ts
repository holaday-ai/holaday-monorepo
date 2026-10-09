import { describe, expect, it } from 'vitest';
import { responseErrorDiagnostics, safeProviderDiagnostics } from './provider-error-diagnostics.js';

describe('safe provider error diagnostics', () => {
  it('redacts an echoed resolved credential/workspace and discards provider prose', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          code: 'echo-private-value',
          type: 'RateLimit',
          message: 'private prompt and body',
        },
      }),
      { status: 429, headers: { 'x-request-id': 'echo-private-workspace' } },
    );
    const result = await responseErrorDiagnostics(response, 123, 1, undefined, [
      'private-value',
      'private-workspace',
    ]);
    expect(result).toEqual({
      httpStatus: 429,
      providerCode: null,
      providerType: 'RateLimit',
      requestId: null,
      elapsedMs: 123,
      retryCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('bounds diagnostic body reads and cancels the acquired stream', async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(8193));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 503, headers: { 'x-request-id': 'req-bounded' } },
    );
    const result = await responseErrorDiagnostics(response, 9, 2);
    expect(result).toMatchObject({
      httpStatus: 503,
      providerCode: null,
      requestId: 'req-bounded',
      retryCount: 2,
    });
    expect(cancelled).toBe(true);
  });
  it('rejects malformed/credential-shaped fields and clamps numeric fields', () => {
    expect(
      safeProviderDiagnostics({
        httpStatus: 900,
        providerCode: 'sk-private',
        providerType: 'Bearer secret',
        requestId: 'f'.repeat(64),
        elapsedMs: Number.POSITIVE_INFINITY,
        retryCount: 100,
      }),
    ).toEqual({
      httpStatus: null,
      providerCode: null,
      providerType: null,
      requestId: null,
      elapsedMs: 0,
      retryCount: 2,
    });
  });
});
