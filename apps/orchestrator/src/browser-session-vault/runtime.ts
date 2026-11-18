import type { PlaywrightExecutor } from '../agent/vision-loop/playwright-executor.js';
import type { BrowserSessionTarget } from '../browser-pool/types.js';
import { logger } from '../config/logger.js';
import type { DB } from '../db/client.js';
import { type KeyProvider, assertVaultConfiguration } from './crypto.js';
import { SqlVaultStore } from './sql-store.js';
import { SessionVault, VaultError, type VaultStore } from './vault.js';
import {
  type ContextFactory,
  type TrustedSiteProbe,
  VaultBrowserWorker,
  type VaultTask,
} from './worker.js';

export interface VaultRuntime {
  readonly cloudHomeEnabled: boolean;
  vault: SessionVault;
  worker: VaultBrowserWorker;
  /**
   * A legacy identity task may load a matching readonly grant. A personal Home
   * loads only its explicitly selected owned interactive profile; no implicit match.
   */
  prepare(
    userId: string,
    executor: PlaywrightExecutor,
    session?: BrowserSessionTarget,
  ): Promise<void>;
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
  cloudHomeEnabled?: boolean;
  keys?: KeyProvider;
  db?: DB;
  store?: VaultStore;
  context?: ContextFactory;
  probes?: ReadonlyMap<string, TrustedSiteProbe>;
}): VaultRuntime | undefined {
  if (!options.importEnabled && !options.profileEnabled && !options.cloudHomeEnabled)
    return undefined;
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
  const worker = new VaultBrowserWorker(vault, {
    context,
    probes: options.probes ?? new Map(),
    onWriteBack: (reason) => logger.info({ reason }, 'browser-vault: session write-back'),
    onDiscard: (reason) =>
      logger.info({ reason }, 'browser-vault: read-only task changes discarded'),
  });
  const tasks = new WeakMap<PlaywrightExecutor, VaultTask>();
  return {
    cloudHomeEnabled: options.cloudHomeEnabled === true,
    vault,
    worker,
    async sweep() {
      if (!(store instanceof SqlVaultStore)) return;
      // Indexed: only owners with a live grant already past its earliest expiry, bounded batch.
      for (const owner of await store.due(Date.now(), 100)) {
        try {
          await vault.list(owner.userId);
        } catch {
          logger.warn({ reason: 'vault_expiry_cleanup_failed' }, 'browser-vault');
        }
      }
    },
    async prepare(userId, executor, session) {
      // Anonymous ("公开云端") tasks never match or open a grant. Personal Home
      // uses an explicit owned profile, never the legacy target-site matcher.
      const personal = session?.sessionPolicy === 'personal_home';
      if (personal && !session.cloudProfileId) return;
      if (!personal && session?.sessionPolicy !== 'vault_allowed') return;
      const grantId = personal
        ? session.cloudProfileId
        : session.targetUrl
          ? (await vault.match(userId, session.targetUrl))?.id
          : undefined;
      if (!grantId) return;
      const binding: { task?: VaultTask } = {};
      const task = await worker.open(
        userId,
        grantId,
        (config) => executor.createSessionVaultContext(config),
        {
          verificationContext: {
            create: (config) => executor.createSessionVerificationContext(config),
            dispose: (context) => executor.closeSessionVerificationContext(context),
          },
          ...(personal
            ? {
                access: 'cloud-home-v1' as const,
                workspace: true,
                allowDownloads: session.homeDownloadsEnabled === true,
              }
            : {}),
          // Revoked or unverifiable: the task parks for the user instead of continuing.
          onInterrupted: (reason) => {
            if (binding.task && tasks.get(executor) === binding.task)
              executor.markSessionInterrupted(reason);
            logger.info({ reason }, 'browser-vault: task session stopped');
          },
        },
      );
      binding.task = task;
      tasks.set(executor, task);
      executor.setSessionIdentityVerifier(() => task.verifyIdentity());
    },
    async finish(executor) {
      const task = tasks.get(executor);
      tasks.delete(executor);
      if (!task) return;
      executor.setSessionIdentityVerifier(null);
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
