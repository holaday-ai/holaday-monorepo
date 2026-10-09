import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { CloudObservation, safeObservationUrl } from './cloud-observation.js';

const RETENTION = 7 * 86400000;
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export interface ReplayFrame {
  id: string;
  actionId: string;
  phase: 'before' | 'after' | 'failure' | 'sample';
  capturedAt: number;
  tabId: string;
  frameId: string;
  observationRevision: string;
  sourceURL: string;
  redacted: boolean;
  gap: boolean;
  result?: string;
  image?: string;
}
interface Manifest {
  owner: string;
  task: string;
  createdAt: number;
  expiresAt: number;
  truncated: boolean;
  frames: ReplayFrame[];
  bytes: number;
}

/** Private filesystem archive. No public URL, raw action arguments, or captured DOM. */
export class BrowserReplayStore {
  constructor(
    private root: string,
    readonly now: () => number = Date.now,
  ) {}
  private path(owner: string, task: string) {
    return join(this.root, digest(owner), digest(task));
  }
  private deletedOwners = new Set<string>();
  private async ownerDeleted(owner: string) {
    const dir = join(this.root, digest(owner));
    if (this.deletedOwners.has(dir)) return true;
    try {
      await readFile(join(dir, '.deleted'));
      return true;
    } catch {
      return false;
    }
  }
  /** Account closure fences every late writer, including a reopened store. */
  removeOwner(owner: string) {
    const dir = join(this.root, digest(owner));
    this.deletedOwners.add(dir);
    return this.enqueue(dir, async () => {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700);
      await writeFile(join(dir, '.deleted'), 'deleted', { mode: 0o600 });
      await Promise.all(
        [...this.queues].filter(([key]) => key.startsWith(`${dir}/`)).map(([, pending]) => pending),
      );
      for (const task of await readdir(dir))
        if (/^[a-f0-9]{64}$/.test(task))
          await rm(join(dir, task), { recursive: true, force: true });
    });
  }
  private deleted = new Set<string>();
  private async load(owner: string, task: string): Promise<Manifest | null> {
    try {
      const data = JSON.parse(
        await readFile(join(this.path(owner, task), 'manifest.json'), 'utf8'),
      ) as Manifest;
      return data.owner === digest(owner) && data.task === digest(task) ? data : null;
    } catch {
      return null;
    }
  }
  private queues = new Map<string, Promise<void>>();
  private enqueue(key: string, action: () => Promise<void>) {
    const next = (this.queues.get(key) ?? Promise.resolve()).then(action);
    const guarded = next.catch(() => {});
    this.queues.set(key, guarded);
    void guarded.finally(() => {
      if (this.queues.get(key) === guarded) this.queues.delete(key);
    });
    return next;
  }
  append(
    owner: string,
    task: string,
    frame: ReplayFrame,
    image: Buffer | undefined,
    limits: { maxFrames: number; maxBytes: number; maxMs: number },
  ) {
    return this.enqueue(this.path(owner, task), () =>
      this.appendSerial(owner, task, frame, image, limits),
    );
  }
  private async appendSerial(
    owner: string,
    task: string,
    frame: ReplayFrame,
    image: Buffer | undefined,
    limits: { maxFrames: number; maxBytes: number; maxMs: number },
  ) {
    const dir = this.path(owner, task);
    if (this.deleted.has(dir) || (await this.ownerDeleted(owner))) return;
    try {
      await readFile(join(dir, '.deleted'));
      return;
    } catch {}
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    let manifest = await this.load(owner, task);
    if (manifest && manifest.expiresAt <= this.now()) {
      await this.removeSerial(owner, task);
      return;
    }
    manifest ??= {
      owner: digest(owner),
      task: digest(task),
      createdAt: this.now(),
      expiresAt: this.now() + RETENTION,
      truncated: false,
      frames: [],
      bytes: 0,
    };
    if (
      manifest.frames.length >= limits.maxFrames ||
      manifest.bytes + (image?.length ?? 0) > limits.maxBytes ||
      this.now() - manifest.createdAt > limits.maxMs
    ) {
      manifest.truncated = true;
      // Preserve failure metadata even when the archive budget is exhausted.
      if (frame.phase === 'failure' && manifest.frames.length < limits.maxFrames + 10)
        manifest.frames.push({ ...frame, gap: true });
    } else {
      if (image) {
        await writeFile(join(dir, frame.id + '.jpg'), image, { mode: 0o600 });
        manifest.bytes += image.length;
      }
      manifest.frames.push({ ...frame, ...(image ? { image: frame.id + '.jpg' } : {}) });
    }
    if (await this.ownerDeleted(owner)) {
      if (image) await rm(join(dir, frame.id + '.jpg'), { force: true });
      return;
    }
    try {
      await readFile(join(dir, '.deleted'));
      if (image) await rm(join(dir, frame.id + '.jpg'), { force: true });
      return;
    } catch {}
    const temp = join(dir, 'manifest-' + randomUUID() + '.tmp');
    await writeFile(temp, JSON.stringify(manifest), { mode: 0o600 });
    const { rename } = await import('node:fs/promises');
    await rename(temp, join(dir, 'manifest.json'));
  }
  async read(owner: string, task: string, offset = 0, limit = 20) {
    const dir = this.path(owner, task);
    await this.queues.get(dir);
    if (await this.ownerDeleted(owner)) return null;
    try {
      await readFile(join(dir, '.deleted'));
      return null;
    } catch {}
    const manifest = await this.load(owner, task);
    if (!manifest) return null;
    if (manifest.expiresAt <= this.now()) {
      await this.remove(owner, task);
      return null;
    }
    const frames = await Promise.all(
      manifest.frames.slice(offset, offset + Math.min(20, limit)).map(async (frame) => {
        if (!frame.image) return frame;
        if (!/^[a-f0-9-]+\.jpg$/.test(frame.image))
          return { ...frame, image: undefined, gap: true };
        try {
          const image = await readFile(join(this.path(owner, task), frame.image));
          return { ...frame, image: `data:image/jpeg;base64,${image.toString('base64')}` };
        } catch {
          return { ...frame, image: undefined, gap: true };
        }
      }),
    );
    return {
      createdAt: manifest.createdAt,
      expiresAt: manifest.expiresAt,
      truncated: manifest.truncated,
      total: manifest.frames.length,
      frames,
      next: offset + frames.length < manifest.frames.length ? offset + frames.length : null,
    };
  }
  remove(owner: string, task: string) {
    return this.enqueue(this.path(owner, task), () => this.removeSerial(owner, task));
  }
  private async removeSerial(owner: string, task: string) {
    const dir = this.path(owner, task);
    this.deleted.add(dir);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, '.deleted'), 'deleted', { mode: 0o600 });
  }
  async sweep() {
    // Periodic bounded cleanup removes expired images even when nobody reads them.
    for (const owner of (await readdir(this.root).catch(() => [])).slice(0, 1000)) {
      if (!/^[a-f0-9]{64}$/.test(owner)) continue;
      for (const task of (await readdir(join(this.root, owner)).catch(() => [])).slice(0, 1000)) {
        if (!/^[a-f0-9]{64}$/.test(task)) continue;
        const dir = join(this.root, owner, task);
        try {
          const manifest = JSON.parse(
            await readFile(join(dir, 'manifest.json'), 'utf8'),
          ) as Manifest;
          if (manifest.expiresAt <= this.now()) await rm(dir, { recursive: true, force: true });
        } catch {
          /* A partially written archive is retried on the next sweep. */
        }
      }
    }
  }
}

export class BrowserReplayRecorder {
  private paused = false;
  get isPaused() {
    return this.paused;
  }
  async pause() {
    this.paused = true;
    await this.serial;
  }
  resume() {
    this.paused = false;
  }
  private serial: Promise<void> = Promise.resolve();
  private queued = 0;
  private observer: CloudObservation | null = null;
  private limits: { maxFrames: number; maxBytes: number; maxMs: number };
  constructor(
    private store: BrowserReplayStore,
    private owner: string,
    private task: string,
    private origins: Set<string>,
    limits: Partial<{ maxFrames: number; maxBytes: number; maxMs: number }> = {},
  ) {
    this.limits = { maxFrames: 1200, maxBytes: 100 * 1024 * 1024, maxMs: 10 * 60000, ...limits };
  }
  authorize(origin: string) {
    if (/^https?:\/\//.test(origin)) this.origins.add(origin);
  }
  capture(
    page: Page,
    actionId: string,
    phase: ReplayFrame['phase'],
    result?: string,
  ): Promise<void> {
    if (this.paused || this.queued >= 2) return this.serial;
    this.queued++;
    this.serial = this.serial
      .then(async () => {
        if (this.paused) return;
        this.observer ??= new CloudObservation(page);
        this.observer.register(page);
        let allowed = false;
        try {
          allowed = this.origins.has(new URL(page.url()).origin);
        } catch {}
        let redacted = allowed ? await this.observer.sensitive(page) : false;
        const before = await this.observer.metadata(page.mainFrame()).catch(() => null);
        let image: Buffer | undefined;
        let gap = !allowed || page.isClosed();
        if (allowed && !redacted && !gap) {
          try {
            // Playwright's mask overlays mutate the DOM and invalidate action refs.
            // Whole sensitive pages are suppressed; caret preservation makes capture read-only.
            image = await page.screenshot({
              type: 'jpeg',
              quality: 45,
              timeout: 2000,
              caret: 'initial',
            });
            if (image.length > 2 * 1024 * 1024) {
              image = undefined;
              gap = true;
            }
          } catch {
            gap = true;
          }
        }
        if (image && (await this.observer.sensitive(page))) {
          image = undefined;
          redacted = true;
        }
        const metadata = await this.observer.metadata(page.mainFrame()).catch(() => null);
        if (image && (!before || before.observationRevision !== metadata?.observationRevision)) {
          image = undefined;
          gap = true;
        }
        if (this.paused) return;
        await this.store.append(
          this.owner,
          this.task,
          {
            id: randomUUID(),
            actionId,
            phase,
            capturedAt: this.store.now(),
            tabId: metadata?.tabId ?? 'unavailable',
            frameId: metadata?.frameId ?? 'unavailable',
            observationRevision: metadata?.observationRevision ?? 'unavailable',
            sourceURL: safeObservationUrl(page.url()),
            redacted,
            gap,
            result,
          },
          image,
          this.limits,
        );
      })
      .catch(() => {
        /* Archive failure must never leak page data or release an action gate. */
      })
      .finally(() => {
        this.queued--;
      });
    return this.serial;
  }
  async dispose() {
    this.paused = true;
    await this.serial;
    this.observer?.dispose();
  }
}
