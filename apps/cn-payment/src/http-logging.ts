import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

export const PAYMENT_HTTP_REDACT_PATHS = ['req.headers["x-internal-secret"]'] as const;

export function createPaymentHttpLogger(logger: Logger) {
  return pinoHttp({
    logger,
    redact: [...PAYMENT_HTTP_REDACT_PATHS],
  });
}
