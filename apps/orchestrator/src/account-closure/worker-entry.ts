import { randomUUID } from 'node:crypto';
import { privateResendSender } from '../auth/email-code.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { db, pool } from '../db/client.js';
import { getSharedStorageProvider } from '../files/storage-provider.js';
import { ACCOUNT_CLOSURE_HANDLERS } from './handler-registry.js';
import { SmsGatewayClient } from './sms-gateway-client.js';
import { runAccountClosureWorkerLoop, runAccountClosureWorkerTick } from './worker.js';

const POLL_MS = 30_000;
const workerId = `closure-${randomUUID()}`;
const handlers = new Map(ACCOUNT_CLOSURE_HANDLERS.map((handler) => [handler.categoryId, handler]));
const storage = getSharedStorageProvider({ logger });
const smsGateway = new SmsGatewayClient({
  baseUrl: process.env.ALIYUN_SMS_URL?.trim() || 'http://127.0.0.1:1',
  internalSecret: process.env.INTERNAL_SHARED_SECRET?.trim() || '',
});
let stopping = false;
let wakeSleep: (() => void) | null = null;

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    stopping = true;
    wakeSleep?.();
    logger.info({ signal }, 'account-closure-worker stopping after current page');
  });
}

try {
  await runAccountClosureWorkerLoop({
    shouldStop: () => stopping,
    wait: () => wait(POLL_MS),
    async tick() {
      const result = await runAccountClosureWorkerTick({
        db,
        handlers,
        workerId,
        now: () => new Date(),
        rssBytes: () => process.memoryUsage().rss,
        enabled: env.ACCOUNT_CLOSURE_WORKER_ENABLED,
        logger,
        storage,
        hmacSecret: env.ACCOUNT_CLOSURE_HMAC_SECRET,
        notification: { emailSender: privateResendSender, smsGateway },
      });
      logger.info({ result, rssBytes: process.memoryUsage().rss }, 'account-closure-worker tick');
      return result;
    },
  });
} finally {
  await pool.end();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      wakeSleep = null;
      resolve();
    };
    const timer = setTimeout(finish, ms);
    wakeSleep = finish;
  });
}
