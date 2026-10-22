import { afterEach, expect, it } from 'vitest';
import { PlaywrightExecutor } from './playwright-executor.js';
import { STEALTH_INIT_SCRIPT } from './stealth-scripts.js';

/**
 * FIX-31 review #2 — launchManaged (dev / browser-eval) injected the stealth
 * script without the switch. With STEALTH_ENABLED unset nothing is injected;
 * only an explicit opt-in does.
 */
const previous = process.env.STEALTH_ENABLED;
const executors: PlaywrightExecutor[] = [];
afterEach(async () => {
  if (previous === undefined) delete process.env.STEALTH_ENABLED;
  else process.env.STEALTH_ENABLED = previous;
  for (const e of executors.splice(0)) await e.disconnect().catch(() => {});
});

async function launchedScripts(): Promise<string[]> {
  const scripts: string[] = [];
  const context = {
    addInitScript: async (opts: { content?: string } | string) => {
      scripts.push(typeof opts === 'string' ? opts : (opts.content ?? ''));
    },
    route: async () => {},
    on: () => {},
    pages: () => [],
  };
  const clean = { setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, close: async () => {} };
  const executor = new PlaywrightExecutor({
    chromium: {
      launch: async () =>
        ({
          contexts: () => [context],
          newContext: async () => clean,
          close: async () => {},
        }) as never,
      connectOverCDP: async () => ({ contexts: () => [], close: async () => {} }) as never,
    },
  });
  executors.push(executor);
  expect(await executor.launchManaged()).toEqual({ ok: true });
  return scripts;
}

it('launchManaged injects no stealth script when STEALTH_ENABLED is unset', async () => {
  delete process.env.STEALTH_ENABLED;
  expect(await launchedScripts()).not.toContain(STEALTH_INIT_SCRIPT);
});

it('only an explicit opt-in injects it', async () => {
  process.env.STEALTH_ENABLED = 'true';
  expect(await launchedScripts()).toContain(STEALTH_INIT_SCRIPT);
});
