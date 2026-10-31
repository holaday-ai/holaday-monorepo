import { pino } from 'pino';
import { createSelfCheckService } from './self-check-service.js';

/** Process-wide self-check cache + audit log (module `self-check`). */
export const selfCheckService = createSelfCheckService({
  logger: pino({ level: 'info', base: { service: 'orchestrator', module: 'self-check' } }),
});
