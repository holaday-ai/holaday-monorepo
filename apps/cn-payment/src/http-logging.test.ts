import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { PAYMENT_HTTP_REDACT_PATHS, createPaymentHttpLogger } from './http-logging.js';

describe('CN payment HTTP logging', () => {
  it('boots with a valid Pino redaction path for the internal secret header', () => {
    expect(() => createPaymentHttpLogger(pino({ enabled: false }))).not.toThrow();
  });

  it('redacts the internal secret value from structured request logs', () => {
    const chunks: string[] = [];
    const logger = pino(
      { redact: [...PAYMENT_HTTP_REDACT_PATHS] },
      { write: (chunk: string) => chunks.push(chunk) },
    );

    logger.info({ req: { headers: { 'x-internal-secret': 'private-test-secret' } } });

    const output = chunks.join('');
    expect(output).not.toContain('private-test-secret');
    expect(output).toContain('[Redacted]');
  });
});
