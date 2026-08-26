import { type LoggerOptions, pino } from 'pino';
import { env } from './env.js';

export const loggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: 'orchestrator' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["proxy-authorization"]',
      'req.headers["x-api-key"]',
      'req.headers["api-key"]',
      'res.headers["set-cookie"]',
      'res.headers.location',
    ],
    censor: '[Redacted]',
  },
} satisfies LoggerOptions;

export const logger = pino(loggerOptions);

export type Logger = typeof logger;
