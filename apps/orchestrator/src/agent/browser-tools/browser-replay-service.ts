import { resolve } from 'node:path';
import { BrowserReplayStore } from './browser-replay.js';

export const browserReplayStore = new BrowserReplayStore(resolve('var/browser-replay'));
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
