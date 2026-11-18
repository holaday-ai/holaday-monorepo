import { randomUUID } from 'node:crypto';
import type { BrowserContext, Download, Page } from 'playwright';
import {
  ownBrowserDownload,
  persistBrowserDownload,
} from '../agent/browser-tools/browser-download.js';
import type { BrowserDownloadReceipt } from '../agent/browser-tools/playwright-unified-executor.js';
import type { BrowserPool } from '../browser-pool/browser-pool.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import type { BrowserFileOrigin } from '../files/browser-file-origin.js';
import { BrowserFileSaveUnconfirmed } from '../files/browser-output.js';
import type { FileService } from '../files/file-service.js';

export interface HomeFileTransfer {
  id: string;
  state: 'pending' | 'saved' | 'failed' | 'unconfirmed';
  filename: string;
  origin: string;
  taskId: string | null;
  startedAt: number;
  fileId?: string;
  receipt?: BrowserDownloadReceipt;
}
type FilePool = Pick<BrowserPool, 'peek' | 'touch'>;
interface Binding {
  context: BrowserContext;
  pending: number;
  closed: boolean;
}

/** Observes existing server-owned pages; never clicks, navigates or manufactures task/source IDs. */
export class BrowserHomeFiles {
  private readonly bindings = new WeakMap<BrowserInstance, Binding>();
  private readonly transfers = new Map<string, HomeFileTransfer[]>();
  private readonly active = new Map<string, number>();
  private expiryTimer?: ReturnType<typeof setInterval>;

  has(instance: BrowserInstance): boolean {
    const binding = this.bindings.get(instance);
    return Boolean(binding && !binding.closed);
  }
  recent(userId: string): HomeFileTransfer[] {
    return this.prune(userId).map((row) => ({ ...row }));
  }
  private prune(userId: string): HomeFileTransfer[] {
    const entries = (this.transfers.get(userId) ?? []).filter(
      (row) => row.state === 'pending' || row.startedAt > Date.now() - 30 * 60_000,
    );
    if (entries.length) this.transfers.set(userId, entries);
    else this.transfers.delete(userId);
    return entries;
  }

  async attach(args: {
    instance: BrowserInstance;
    pool: FilePool;
    fileService: Pick<FileService, 'storeBrowserOutput'>;
    userIdInternal: number;
    enabled(): boolean;
    onIdle(instance: BrowserInstance): void;
  }): Promise<void> {
    const { instance, pool } = args;
    const owner = instance.userId;
    if (
      instance.sessionPolicy !== 'personal_home' ||
      pool.peek(instance.taskId) !== instance ||
      instance.status !== 'ready'
    )
      throw new Error('home_file_source_unavailable');
    const page = await instance.executor.getPage();
    const context = page.context();
    if (
      pool.peek(instance.taskId) !== instance ||
      instance.userId !== owner ||
      instance.executor.sessionInterruption
    )
      throw new Error('home_file_source_unavailable');
    const existing = this.bindings.get(instance);
    if (existing) {
      if (existing.context !== context || existing.closed)
        throw new Error('home_file_context_changed');
      return;
    }
    const binding: Binding = { context, pending: 0, closed: false };
    const instanceId = randomUUID();
    const pages = new Map<Page, (download: Download) => void>();
    this.bindings.set(instance, binding);
    instance.homeFileTransfers = {
      pending: () => binding.pending > 0 || instance.homeFileUploads?.pending() === true,
    };
    const watch = (candidate: Page) => {
      if (binding.closed || pages.has(candidate) || candidate.context() !== context) return;
      const listener = (download: Download) => {
        let origin = '';
        try {
          origin = new URL(download.url()).origin;
          if (origin === 'null') origin = new URL(candidate.url()).origin;
        } catch {
          /* Unsupported origin refuses below. */
        }
        const taskId = instance.taskId === `bhs_${owner}` ? null : instance.taskId;
        const source: BrowserFileOrigin = {
          version: 1,
          kind: 'personal_home',
          sessionId: `bhs_${owner}`,
          instanceId,
          origin,
          taskId,
        };
        const entry: HomeFileTransfer = {
          id: randomUUID(),
          state: 'pending',
          filename: download
            .suggestedFilename()
            .split('')
            .map((char) =>
              char.charCodeAt(0) < 32 || char === '/' || char.charCodeAt(0) === 92 ? '_' : char,
            )
            .join('')
            .slice(0, 200),
          origin,
          taskId,
          startedAt: Date.now(),
        };
        const current = this.active.get(owner) ?? 0;
        const permitted =
          current < 3 &&
          args.enabled() &&
          !binding.closed &&
          instance.userId === owner &&
          instance.status === 'ready' &&
          !instance.executor.sessionInterruption &&
          pool.peek(instance.taskId) === instance &&
          candidate.context() === context &&
          /^https?:\/\//.test(origin);
        const entries = this.prune(owner);
        entries.push(entry);
        this.transfers.set(owner, [
          ...entries.filter((row) => row.state === 'pending'),
          ...entries.filter((row) => row.state !== 'pending').slice(-50),
        ]);
        if (permitted) this.active.set(owner, current + 1);
        if (!this.expiryTimer) {
          this.expiryTimer = setInterval(() => {
            for (const userId of this.transfers.keys()) this.prune(userId);
            if (!this.transfers.size) {
              clearInterval(this.expiryTimer);
              this.expiryTimer = undefined;
            }
          }, 60_000);
          this.expiryTimer.unref?.();
        }
        binding.pending++;
        const heartbeat = setInterval(() => {
          if (pool.peek(instance.taskId) === instance && instance.status === 'ready')
            pool.touch(instance.taskId);
        }, 5_000);
        heartbeat.unref?.();
        const promise = ownBrowserDownload(download, instance.executor, async () => {
          if (!permitted) {
            await download.cancel().catch(() => undefined);
            await download.delete().catch(() => undefined);
            throw new Error('home_file_download_refused');
          }
          return persistBrowserDownload(download, async ({ filename, buffer }) => {
            // A received file keeps its original provenance through a loan/return/replacement.
            // Account closure is rechecked/serialized by FileService before its index write.
            if (
              !args.enabled() ||
              instance.userId !== owner ||
              instance.executor.sessionInterruption
            )
              throw new Error('home_file_source_unavailable');
            const row = await args.fileService.storeBrowserOutput({
              userIdInternal: args.userIdInternal,
              userExternalId: owner,
              source,
              filename,
              buffer,
              mimetype: 'application/octet-stream',
            });
            if (!row.browserSource || !row.expiresAt)
              throw new BrowserFileSaveUnconfirmed(row.externalId);
            return {
              fileId: row.externalId,
              filename: row.filename,
              sizeBytes: row.sizeBytes,
              sha256: row.browserSource.sha256,
              downloadUrl: `/api/files/${row.externalId}/download`,
              expiresAt: row.expiresAt.toISOString(),
              mimetype: row.mimetype,
            };
          });
        });
        void promise
          .then(
            (receipt) => {
              entry.state = 'saved';
              entry.fileId = receipt.fileId;
              entry.filename = receipt.filename;
              entry.receipt = receipt;
            },
            (error: unknown) => {
              entry.state = error instanceof BrowserFileSaveUnconfirmed ? 'unconfirmed' : 'failed';
              if (error instanceof BrowserFileSaveUnconfirmed) entry.fileId = error.fileId;
            },
          )
          .then(() => {
            clearInterval(heartbeat);
            binding.pending--;
            if (permitted) {
              const remaining = (this.active.get(owner) ?? 1) - 1;
              if (remaining > 0) this.active.set(owner, remaining);
              else this.active.delete(owner);
            }
            if (binding.pending === 0) args.onIdle(instance);
          })
          .catch(() => undefined);
      };
      pages.set(candidate, listener);
      candidate.on('download', listener);
    };
    context.on('page', watch);
    for (const candidate of context.pages()) watch(candidate);
    context.once('close', () => {
      binding.closed = true;
      context.off('page', watch);
      for (const [candidate, listener] of pages) candidate.off('download', listener);
      pages.clear();
    });
  }
}
export const browserHomeFiles = new BrowserHomeFiles();
