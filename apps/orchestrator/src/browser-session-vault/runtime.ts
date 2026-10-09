import type { PlaywrightExecutor } from '../agent/vision-loop/playwright-executor.js';
import { logger } from '../config/logger.js';
import type { DB } from '../db/client.js';
import { type KeyProvider, assertVaultConfiguration } from './crypto.js';
import { SqlVaultStore } from './sql-store.js';
import { SessionVault, VaultError, type VaultStore } from './vault.js';
import { type ContextFactory, VaultBrowserWorker, type VaultTask } from './worker.js';

export interface VaultRuntime {
  vault: SessionVault;
  worker: VaultBrowserWorker;
  prepare(userId: string, executor: PlaywrightExecutor): Promise<void>;
  sweep(): Promise<void>;
  finish(executor: PlaywrightExecutor): Promise<void>;
}
let activeRuntime: VaultRuntime | undefined;
export function getVaultRuntime() {
  return activeRuntime;
}
export function installVaultRuntime(runtime: VaultRuntime | undefined) {
  activeRuntime = runtime;
}

export function createVaultRuntime(options: {
  importEnabled: boolean;
  profileEnabled: boolean;
  keys?: KeyProvider;
  db?: DB;
  store?: VaultStore;
  context?: ContextFactory;
  probes?: ReadonlyMap<string, { path: string; selector: string }>;
}): VaultRuntime | undefined {
  if (!options.importEnabled && !options.profileEnabled) return undefined;
  assertVaultConfiguration(options);
  const store = options.store ?? (options.db ? new SqlVaultStore(options.db) : undefined);
  if (!store || !options.keys) throw new VaultError('vault_store_required');
  const vault = new SessionVault({
    ...options,
    keys: options.keys,
    store,
    audit: (event) => logger.info(event, 'browser-vault'),
  });
  const context: ContextFactory =
    options.context ??
    (async (config) => {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext(config);
        context.on('close', () => {
          void browser.close();
        });
        return context;
      } catch {
        await browser.close();
        throw new VaultError('browser_unavailable');
      }
    });
  // A site adapter must explicitly prove login. No provider/site is silently chosen.
  const worker = new VaultBrowserWorker(vault, { context, probes: options.probes ?? new Map() });
  const tasks = new WeakMap<PlaywrightExecutor, VaultTask>();
  let cursor = 0;
  return {
    vault,
    worker,
    async sweep() {
      if (!(store instanceof SqlVaultStore)) return;
      const owners = await store.owners(cursor);
      for (const owner of owners) {
        try {
          await vault.list(owner.userId);
        } catch {
          logger.warn({ reason: 'vault_expiry_cleanup_failed' }, 'browser-vault');
        }
      }
      cursor = owners.length === 100 ? (owners.at(-1)?.id ?? 0) : 0;
    },
    async prepare(userId, executor) {
      const grants = (await vault.list(userId)).filter((g) => g.status === 'connected');
      if (!grants.length) return;
      if (grants.length !== 1) throw new VaultError('grant_selection_required');
      const grant = grants[0];
      if (!grant) throw new VaultError('grant_selection_required');
      const task = await worker.open(userId, grant.id, (config) =>
        executor.createSessionVaultContext(config),
      );
      tasks.set(executor, task);
    },
    async finish(executor) {
      const task = tasks.get(executor);
      tasks.delete(executor);
      if (!task) return;
      try {
        await task.close();
      } catch (error) {
        if (
          !(error instanceof VaultError) ||
          !['grant_unavailable', 'cas_conflict', 'user_unavailable'].includes(error.code)
        )
          throw new VaultError('profile_save_failed');
      }
    },
  };
}
