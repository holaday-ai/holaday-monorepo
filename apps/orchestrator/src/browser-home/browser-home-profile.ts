import { createHash, randomUUID } from 'node:crypto';
import { browserCloudProfileConsentSchema } from '@holaday/shared-types';
import type { JSHandle, Page } from 'playwright';
import { z } from 'zod';
import { defaultBrowserNetworkPolicy } from '../agent/browser-network-policy.js';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserControl } from '../agent/supercar/browser-control.js';
import type { BrowserPool } from '../browser-pool/browser-pool.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { cookieScopeForOrigin } from '../browser-session-vault/cookie-scope.js';
import { type SessionVault, VaultError } from '../browser-session-vault/vault.js';
import type { VaultBrowserWorker } from '../browser-session-vault/worker.js';
import { type BrowserHomeSessions, browserHomeSessions } from './browser-home-session.js';

export const browserHomeSaveProfileSchema = z
  .object({
    consent: z.literal('cloud-browser-profile-v1'),
    origin: browserCloudProfileConsentSchema.shape.origin,
    sourceId: z.string().uuid(),
    includeStorage: z.boolean(),
    requestId: z.string().uuid(),
    requestedAt: z.number().int().positive(),
    clearEpoch: z.number().int().nonnegative(),
  })
  .strict();
export type BrowserHomeSaveProfileRequest = z.infer<typeof browserHomeSaveProfileSchema>;
type HomeProfilePool = Pick<BrowserPool, 'peek' | 'browserHomeHolder'>;
interface CaptureSource {
  id: string;
  page: Page;
  document: JSHandle<Document>;
  control: BrowserControl;
  url: string;
  revision: number;
  expiresAt: number;
  dispose(): Promise<void>;
}
const sources = new WeakMap<BrowserInstance, CaptureSource>();
/** An ephemeral document proof, not a saved login or permission store. Lost proof cannot be recreated for an old request. */
export async function prepareBrowserHomeProfileSave(args: {
  userId: string;
  pool: HomeProfilePool;
  sessions?: BrowserHomeSessions;
}): Promise<{ sourceId: string; origin: string; expiresAt: number } | null> {
  const sessions = args.sessions ?? browserHomeSessions;
  const home = sessions.instanceFor(args.pool, args.userId);
  if (!home || home.sessionPolicy !== 'personal_home' || args.pool.browserHomeHolder(args.userId))
    return null;
  let handle: JSHandle<Document> | undefined;
  try {
    const entry = browserControlSessions.openForViewer(home);
    if (
      !entry ||
      !entry.control.isSettled() ||
      entry.control.humanActivity.hasHeld() ||
      entry.control.snapshot().error
    )
      return null;
    const revision = entry.control.humanActivity.revision;
    const page = await home.executor.getPage();
    const url = page.url();
    const origin = new URL(url).origin;
    if (
      (!origin.startsWith('https:') &&
        !(
          process.env.NODE_ENV === 'test' &&
          ['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)
        )) ||
      !browserCloudProfileConsentSchema.shape.origin.safeParse(origin).success ||
      !(await defaultBrowserNetworkPolicy.check(origin)).allowed
    )
      return null;
    const old = sources.get(home);
    if (
      old &&
      old.expiresAt > Date.now() &&
      old.control === entry.control &&
      old.page === page &&
      old.url === url &&
      old.revision === revision &&
      (await page.evaluate((original) => original === document, old.document).catch(() => false))
    )
      return { sourceId: old.id, origin, expiresAt: old.expiresAt };
    await old?.dispose();
    sources.delete(home);
    handle = await page.evaluateHandle(() => document);
    if (
      sessions.instanceFor(args.pool, args.userId) !== home ||
      !entry.control.isSettled() ||
      entry.control.humanActivity.revision !== revision ||
      page.url() !== url ||
      (await home.executor.getPage()) !== page
    )
      return null;
    const source: CaptureSource = {
      id: randomUUID(),
      page,
      document: handle,
      control: entry.control,
      url,
      revision,
      expiresAt: Date.now() + 2 * 60_000,
      dispose: async () => {
        clearTimeout(timer);
        if (sources.get(home) === source) sources.delete(home);
        await source.document.dispose().catch(() => undefined);
      },
    };
    const timer = setTimeout(() => void source.dispose(), 2 * 60_000);
    timer.unref();
    sources.set(home, source);
    handle = undefined;
    return { sourceId: source.id, origin, expiresAt: source.expiresAt };
  } catch {
    return null;
  } finally {
    await handle?.dispose().catch(() => undefined);
  }
}

export function browserHomeProfileSaveHash(request: BrowserHomeSaveProfileRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        consent: request.consent,
        origin: request.origin,
        sourceId: request.sourceId,
        includeStorage: request.includeStorage,
        requestId: request.requestId,
        requestedAt: request.requestedAt,
        clearEpoch: request.clearEpoch,
      }),
    )
    .digest('hex');
}
export async function saveBrowserHomeProfile(args: {
  userId: string;
  pool: HomeProfilePool;
  vault: SessionVault;
  worker: VaultBrowserWorker;
  request: BrowserHomeSaveProfileRequest;
  sessions?: BrowserHomeSessions;
}) {
  const parsed = browserHomeSaveProfileSchema.safeParse(args.request);
  if (!parsed.success) throw new VaultError('invalid_grant');
  const request = parsed.data;
  const operation = {
    requestId: request.requestId,
    requestedAt: request.requestedAt,
    clearEpoch: request.clearEpoch,
    makeDefault: true,
    requestHash: browserHomeProfileSaveHash(request),
  };
  // A lost HTTP response must resolve the original operation before looking at today's browser.
  const receipt = await args.vault.cloudProfileReceipt(
    args.userId,
    request.requestId,
    operation.requestHash,
  );
  if (receipt)
    return args.vault.captureCloudProfile(
      args.userId,
      {
        consent: request.consent,
        origin: request.origin,
        storageKeys: receipt.storageKeys,
      },
      async () => {
        throw new VaultError('profile_capture_pending');
      },
      operation,
    );

  const sessions = args.sessions ?? browserHomeSessions;
  const result = sessions.claimTask(args.pool, args.userId);
  if (result.kind !== 'claimed') throw new VaultError(`home_profile_${result.kind}`);
  const { claim } = result;
  let documentHandle: JSHandle<Document> | undefined;
  let captureSource: CaptureSource | undefined;
  try {
    const home = claim.instance;
    if (!(await browserControlSessions.inputSettledWithin(home, 5_000)))
      throw new VaultError('home_profile_busy');
    if (!claim.isCurrent() || home.sessionPolicy !== 'personal_home')
      throw new VaultError('home_profile_page_changed');
    const source = sources.get(home);
    if (!source || source.id !== request.sourceId || source.expiresAt <= Date.now())
      throw new VaultError('home_profile_page_changed');
    const entry = browserControlSessions.openForViewer(home);
    if (!entry || !entry.control.isSettled() || entry.control.snapshot().error)
      throw new VaultError('home_profile_busy');
    if (source.control !== entry.control) throw new VaultError('home_profile_page_changed');
    captureSource = source;
    const { revision, page, url } = source;
    if (
      new URL(url).origin !== request.origin ||
      !(await defaultBrowserNetworkPolicy.check(request.origin)).allowed
    )
      throw new VaultError('home_profile_page_changed');
    documentHandle = source.document;
    const check = async () => {
      try {
        if (
          !claim.isCurrent() ||
          page.isClosed() ||
          page.url() !== url ||
          browserControlSessions.openForViewer(home) !== entry ||
          !entry.control.isSettled() ||
          entry.control.humanActivity.revision !== revision ||
          entry.control.snapshot().error ||
          (await home.executor.getPage()) !== page ||
          !(await page.evaluate((original) => original === document, documentHandle!))
        )
          throw new VaultError('home_profile_page_changed');
        // Recheck synchronous identity after the asynchronous document comparison.
        if (
          !claim.isCurrent() ||
          !entry.control.isSettled() ||
          entry.control.humanActivity.revision !== revision ||
          page.url() !== url
        )
          throw new VaultError('home_profile_page_changed');
      } catch {
        throw new VaultError('home_profile_page_changed');
      }
    };
    await check();
    // Only names are read before durable consent; values are read by the callback below.
    const storageKeys = request.includeStorage
      ? await page.evaluate(() => Object.keys(localStorage))
      : [];
    if (!browserCloudProfileConsentSchema.shape.storageKeys.safeParse(storageKeys).success)
      throw new VaultError('home_profile_storage_unsupported');
    await check();
    return await args.vault.captureCloudProfile(
      args.userId,
      {
        consent: request.consent,
        origin: request.origin,
        storageKeys,
      },
      async () => {
        await check();
        const captured = await args.worker.captureSite(page.context(), page, {
          origin: request.origin,
          cookieDomains: cookieScopeForOrigin(request.origin),
          storageKeys,
        });
        await check();
        return { origin: request.origin, state: captured.state };
      },
      operation,
    );
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError('home_profile_page_changed');
  } finally {
    await captureSource?.dispose();
    claim.release();
  }
}
