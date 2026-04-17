import { pino } from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'orchestrator' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
