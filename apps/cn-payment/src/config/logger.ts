import { pino } from 'pino';
import { loadEnv } from './env.js';

export const logger = pino({
  level: loadEnv().LOG_LEVEL,
  base: { service: 'cn-payment' },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
