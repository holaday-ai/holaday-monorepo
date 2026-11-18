import { randomUUID } from 'node:crypto';
import type { BrowserContext, FileChooser, Frame, Page } from 'playwright';
import { watchBrowserFileChoosers } from '../agent/browser-tools/browser-file-chooser-receiver.js';
import {
  type CapturedBrowserFileChooser,
  PreparedBrowserUpload,
} from '../agent/browser-tools/browser-upload-target.js';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserControl } from '../agent/supercar/browser-control.js';
import type { BrowserPool } from '../browser-pool/browser-pool.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import type { FileService } from '../files/file-service.js';

type UploadState =
  | 'opening'
  | 'awaiting_files'
  | 'preparing'
  | 'delivering'
  | 'handed_to_page'
  | 'unknown'
  | 'cancelled'
  | 'expired'
  | 'unavailable'
  | 'failed';
export interface HomeUploadRequest {
  id: string;
  state: UploadState;
  origin: string;
  formOrigin: string;
  accept: string;
  multiple: boolean;
  expiresAt: number;
}
export interface HomeUploadSnapshot {
  instanceId: string;
  request: HomeUploadRequest | null;
}
export interface HomeUploadInput {
  instanceId: string;
  requestId: string;
}
interface Request extends HomeUploadRequest {
  target?: CapturedBrowserFileChooser;
  control: BrowserControl;
  release: () => void;
  detach: () => void;
  fileIds?: string[];
  invalidated: boolean;
  settled: boolean;
}
interface Binding {
  instanceId: string;
  context: BrowserContext;
  closed: boolean;
  request: Request | null;
  current(): boolean;
  activeOwner(): Promise<boolean>;
  files: Pick<FileService, 'loadMany'>;
  userId: number;
  onIdle(): void;
}
const pending = (request?: Request | null) =>
  Boolean(
    request && ['opening', 'awaiting_files', 'preparing', 'delivering'].includes(request.state),
  );
const snapshot = (binding: Binding): HomeUploadSnapshot => ({
  instanceId: binding.instanceId,
  request: binding.request?.origin
    ? {
        id: binding.request.id,
        state: binding.request.state,
        origin: binding.request.origin,
        formOrigin: binding.request.formOrigin,
        accept: binding.request.accept.slice(0, 500),
        multiple: binding.request.multiple,
        expiresAt: binding.request.expiresAt,
      }
    : null,
});

/** Ephemeral chooser resources of an existing Home instance; no new file or identity store. */
export class BrowserHomeUploads {
  private readonly bindings = new WeakMap<BrowserInstance, Binding>();
  has(instance: BrowserInstance): boolean {
    return this.bindings.get(instance)?.current() === true;
  }
  sourceId(instance: BrowserInstance): string | null {
    const binding = this.bindings.get(instance);
    return binding?.current() ? binding.instanceId : null;
  }
  async attach(args: {
    instance: BrowserInstance;
    pool: Pick<BrowserPool, 'peek' | 'touch'>;
    files: Pick<FileService, 'loadMany'>;
    userIdInternal: number;
    enabled(): boolean;
    activeOwner(): Promise<boolean>;
    onIdle(instance: BrowserInstance): void;
  }): Promise<void> {
    const { instance, pool } = args;
    const owner = instance.userId;
    const page = await instance.executor.getPage();
    const context = page.context();
    const current = () =>
      !binding.closed &&
      args.enabled() &&
      instance.sessionPolicy === 'personal_home' &&
      instance.status === 'ready' &&
      instance.userId === owner &&
      pool.peek(instance.taskId) === instance &&
      !instance.executor.sessionInterruption;
    const existing = this.bindings.get(instance);
    if (existing) {
      if (existing.context !== context || !existing.current())
        throw new Error('home_upload_source_changed');
      return;
    }
    const binding: Binding = {
      instanceId: randomUUID(),
      context,
      closed: false,
      request: null,
      current,
      activeOwner: args.activeOwner,
      files: args.files,
      userId: args.userIdInternal,
      onIdle: () => args.onIdle(instance),
    };
    if (!current() || !(await args.activeOwner()))
      throw new Error('home_upload_source_unavailable');
    this.bindings.set(instance, binding);
    instance.homeFileUploads = { pending: () => !binding.closed && pending(binding.request) };
    const pages = new Map<Page, () => void>();
    const watch = (candidate: Page) => {
      if (
        binding.closed ||
        candidate.isClosed() ||
        pages.has(candidate) ||
        candidate.context() !== context
      )
        return;
      const stop = watchBrowserFileChoosers(candidate, (chooser) => {
        if (chooser.page() !== candidate || !current()) return;
        let session: ReturnType<typeof browserControlSessions.openForViewer>;
        try {
          session =
            browserControlSessions.openForViewer(instance) ??
            (instance.taskId === `bhs_${owner}` ? browserControlSessions.review(instance) : null);
        } catch {
          return;
        }
        if (!session?.control.canAgentAct()) return;
        if (binding.request && pending(binding.request))
          this.end(binding, binding.request, 'cancelled');
        if (pending(binding.request)) return;
        const request: Request = {
          id: randomUUID(),
          state: 'opening',
          origin: '',
          formOrigin: '',
          accept: '',
          multiple: false,
          expiresAt: Date.now() + 120_000,
          control: session.control,
          release: session.control.beginPendingInteraction(),
          detach: () => {},
          invalidated: false,
          settled: false,
        };
        binding.request = request;
        const timer = setTimeout(() => this.end(binding, request, 'expired'), 120_000);
        timer.unref();
        const heartbeat = setInterval(() => {
          if (!current() || !request.control.canAgentAct())
            this.end(binding, request, 'unavailable');
          else if (pending(request)) pool.touch(instance.taskId);
        }, 2000);
        heartbeat.unref();
        request.detach = () => {
          clearTimeout(timer);
          clearInterval(heartbeat);
        };
        pool.touch(instance.taskId);
        void this.capture(binding, request, chooser, instance).catch(() =>
          this.end(binding, request, 'unavailable'),
        );
      });
      pages.set(candidate, stop);
      candidate.once('close', () => {
        stop();
        pages.delete(candidate);
      });
    };
    context.on('page', watch);
    for (const candidate of context.pages()) watch(candidate);
    context.once('close', () => {
      binding.closed = true;
      context.off('page', watch);
      for (const stop of pages.values()) stop();
      pages.clear();
      if (binding.request) this.end(binding, binding.request, 'unavailable');
    });
  }
  private live(binding: Binding, request: Request, instance: BrowserInstance): boolean {
    return (
      binding.current() &&
      binding.request === request &&
      !request.invalidated &&
      pending(request) &&
      request.control.canAgentAct() &&
      browserControlSessions.get(instance, instance.userId, instance.taskId)?.control ===
        request.control
    );
  }
  private async capture(
    binding: Binding,
    request: Request,
    chooser: FileChooser,
    instance: BrowserInstance,
  ): Promise<void> {
    const target = await PreparedBrowserUpload.captureChooser(chooser, () =>
      this.live(binding, request, instance),
    );
    if (
      !this.live(binding, request, instance) ||
      !(await binding.activeOwner()) ||
      !this.live(binding, request, instance) ||
      !(await target.isCurrent())
    ) {
      await target.dispose();
      this.end(binding, request, 'unavailable');
      return;
    }
    request.target = target;
    Object.assign(request, target.description, { state: 'awaiting_files' });
    const owner = chooser.page();
    const oldDetach = request.detach;
    const changed = (frame: Frame) => {
      if (frame === target.frame || frame === owner.mainFrame())
        this.end(binding, request, 'unavailable');
    };
    const close = () => this.end(binding, request, 'unavailable');
    owner.on('framenavigated', changed);
    owner.on('framedetached', changed);
    owner.on('close', close);
    request.detach = () => {
      oldDetach();
      owner.off('framenavigated', changed);
      owner.off('framedetached', changed);
      owner.off('close', close);
    };
  }
  private end(binding: Binding, request: Request, state: UploadState): void {
    if (!pending(request)) return;
    if (request.state === 'delivering') {
      request.invalidated = true;
      return;
    }
    request.state = state;
    this.finish(binding, request);
  }
  private finish(binding: Binding, request: Request): void {
    if (request.settled) return;
    request.settled = true;
    request.detach();
    request.release();
    void request.target?.dispose();
    binding.onIdle();
  }
  async current(instance: BrowserInstance): Promise<HomeUploadSnapshot | null> {
    const binding = this.bindings.get(instance);
    if (!binding) return null;
    const request = binding.request;
    if (!binding.current()) {
      if (request) this.end(binding, request, 'unavailable');
      return null;
    }
    if (request && pending(request) && request.target && !(await request.target.isCurrent()))
      this.end(binding, request, 'unavailable');
    return snapshot(binding);
  }
  private async require(
    instance: BrowserInstance,
    input: HomeUploadInput,
  ): Promise<{ binding: Binding; request: Request }> {
    const binding = this.bindings.get(instance);
    const request = binding?.request;
    if (
      !binding ||
      !request ||
      binding.instanceId !== input.instanceId ||
      request.id !== input.requestId
    )
      throw new Error('home_upload_request_unavailable');
    if (!binding.current() || !(await binding.activeOwner()) || !binding.current()) {
      this.end(binding, request, 'unavailable');
      throw new Error('home_upload_source_unavailable');
    }
    return { binding, request };
  }
  async cancel(instance: BrowserInstance, input: HomeUploadInput): Promise<HomeUploadSnapshot> {
    const { binding, request } = await this.require(instance, input);
    if (request.state !== 'delivering') this.end(binding, request, 'cancelled');
    return snapshot(binding);
  }
  async choose(
    instance: BrowserInstance,
    input: HomeUploadInput & { fileIds: string[] },
  ): Promise<HomeUploadSnapshot> {
    const { binding, request } = await this.require(instance, input);
    if (request.fileIds) {
      if (JSON.stringify(request.fileIds) !== JSON.stringify(input.fileIds))
        throw new Error('home_upload_request_conflict');
      return snapshot(binding);
    }
    if (
      request.state !== 'awaiting_files' ||
      !request.target ||
      !(await request.target.isCurrent())
    ) {
      this.end(binding, request, 'unavailable');
      throw new Error('home_upload_request_unavailable');
    }
    // isCurrent awaited: another identical request may have acquired the one-shot target.
    if (request.fileIds) {
      if (JSON.stringify(request.fileIds) !== JSON.stringify(input.fileIds))
        throw new Error('home_upload_request_conflict');
      return snapshot(binding);
    }
    request.fileIds = [...input.fileIds];
    request.state = 'preparing';
    let prepared: PreparedBrowserUpload | undefined;
    try {
      prepared = await request.target.prepare(input.fileIds, async (ids) => {
        if (
          !this.live(binding, request, instance) ||
          !(await binding.activeOwner()) ||
          !this.live(binding, request, instance)
        )
          throw new Error('home_upload_source_unavailable');
        const loaded = await binding.files.loadMany(ids, binding.userId);
        if (
          !this.live(binding, request, instance) ||
          !(await binding.activeOwner()) ||
          !this.live(binding, request, instance)
        )
          throw new Error('home_upload_source_unavailable');
        return loaded
          .filter(
            ({ row, buffer }) =>
              row.userId === binding.userId &&
              row.kind !== 'temp' &&
              row.sizeBytes === buffer.length,
          )
          .map(({ row, buffer }) => ({
            fileId: row.externalId,
            name: row.filename,
            mimeType: row.mimetype,
            buffer,
          }));
      });
      prepared.approve(() => {
        if (!this.live(binding, request, instance))
          throw new Error('home_upload_source_unavailable');
        // This callback runs after the second file read and all target checks, just before CDP.
        request.state = 'delivering';
      });
      const receipt = await prepared.deliver();
      request.state = receipt.status;
    } catch {
      // PreparedBrowserUpload returns unknown for every failure AFTER native dispatch.
      if (pending(request)) request.state = 'failed';
    } finally {
      await prepared?.dispose();
      if (!pending(request)) {
        this.finish(binding, request);
        await request.target.dispose();
      }
    }
    return snapshot(binding);
  }
}
export const browserHomeUploads = new BrowserHomeUploads();
