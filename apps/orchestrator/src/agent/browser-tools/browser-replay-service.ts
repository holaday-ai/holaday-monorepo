import { resolve } from 'node:path';
import { env } from '../../config/env.js';
import { BrowserReplayStore } from './browser-replay.js';

// Runtime state belongs beside browser profiles, not in a read-only release directory.
export const browserReplayStore = new BrowserReplayStore(resolve(env.BROWSER_POOL_DIR, '.replay'));
let sweeping = false;
const sweep = async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    await browserReplayStore.sweep();
  } finally {
    sweeping = false;
  }
};
// Lazy import by the cloud runner/router; expired content is also removed on read.
const timer = setInterval(
  () => {
    void sweep().catch(() => {});
  },
  60 * 60 * 1000,
);
timer.unref();
