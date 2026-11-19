import type { NativeBlobSources } from './native-blob-source.js';
import type { NativeDownloadResponseSources } from './native-download-sources.js';

export type NativeDownloadEvent = (method: string, params: Record<string, unknown>) => void;
export interface NativeDownloadTransport {
  owner: object;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  subscribe(listener: NativeDownloadEvent): () => void;
}
export interface NativeDownloadFile {
  readonly alive: boolean;
  metadata(): { filename: string; mimeType: string; sizeBytes: number; sha256: string };
  source(): {
    origin: string;
    originBasis: 'download_url' | 'owning_page';
    guid: string;
    frameId: string;
  };
  read(offset: number, length: number): Uint8Array;
  dispose(): void;
}
export type NativeDownloadCaptureResult =
  | { status: 'captured'; clickOutcome: 'applied'; file: NativeDownloadFile }
  | { status: 'not_applied'; clickOutcome: 'not_applied'; reason: string }
  | { status: 'clicked'; clickOutcome: 'applied'; reason: string };
export class NativeDownloadCaptureError extends Error {
  constructor(
    code: string,
    readonly clickOutcome: 'not_applied' | 'applied' | 'unknown',
  ) {
    super(code);
  }
}
export interface NativeDownloadCaptureOptions {
  frameId: string;
  origin: string;
  /** Bound host scope only; webpage contents do not supply this decision. */
  current(): boolean;
  prepare(): Promise<void>;
  click(): Promise<void>;
  finalCheck(): Promise<void>;
  blobs?: NativeBlobSources;
  signal?: AbortSignal;
  captureMs?: number;
  totalMs?: number;
  maxBytes?: number;
  /** Host-owned native-export policy; grants response bytes, never DOM access. */
  responseSources?: NativeDownloadResponseSources;
}
const owners = new WeakMap<object, NativeDownloadCaptureController>();
const MAX_BYTES = 50 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;
type Receipt = {
  frameId: string;
  guid: string;
  url: string;
  filename: string;
  completed: boolean;
  cancelled: boolean;
  received?: number;
};
type NetworkBody = {
  frameId: string;
  requestId: string;
  networkId: string;
  url: string;
  mimeType: string;
  handle?: string;
  taken: boolean;
  settled: boolean;
  buffer?: Uint8Array;
  error?: string;
  closing?: Promise<void>;
  streamClosing?: Promise<void>;
  claim?: Promise<unknown>;
  job?: Promise<void>;
  cancellation: Promise<void>;
  confirmCancellation: () => void;
  chunks: Uint8Array[];
};

/** One task-owned CDP transport, with no other Fetch routing/auth interceptor.
 * Caller must retain this controller after unconfirmed recovery and dispose it
 * before releasing its driver. No model tool accepts this transport directly. */
export class NativeDownloadCaptureController {
  constructor(private readonly transport: NativeDownloadTransport) {}
  get busy(): boolean {
    return this.operation !== null;
  }
  get stopped(): boolean {
    return this.closed || this.uncertain;
  }
  private closed = false;
  private uncertain = false;
  private operation: Promise<NativeDownloadCaptureResult> | null = null;
  private stop: (() => void) | null = null;
  private recovery: (() => Promise<void>) | null = null;

  async capture(options: NativeDownloadCaptureOptions): Promise<NativeDownloadCaptureResult> {
    if (this.stopped)
      throw new NativeDownloadCaptureError('download_capture_stopped', 'not_applied');
    if (this.operation) throw new NativeDownloadCaptureError('browser_busy', 'not_applied');
    if (owners.has(this.transport.owner))
      throw new NativeDownloadCaptureError('browser_busy', 'not_applied');
    owners.set(this.transport.owner, this);
    this.operation = this.run(options);
    try {
      return await this.operation;
    } finally {
      this.operation = null;
      this.stop = null;
    }
  }
  async dispose(): Promise<void> {
    this.closed = true;
    this.stop?.();
    await this.operation?.catch(() => {});
    await this.recovery?.();
  }
  private async run(options: NativeDownloadCaptureOptions): Promise<NativeDownloadCaptureResult> {
    const captureMs = options.captureMs ?? 5000;
    const totalMs = options.totalMs ?? 120000;
    const maxBytes = options.maxBytes ?? MAX_BYTES;
    if (
      !Number.isInteger(captureMs) ||
      captureMs < 50 ||
      captureMs > 5000 ||
      !Number.isInteger(totalMs) ||
      totalMs < captureMs ||
      totalMs > 120000 ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > MAX_BYTES
    ) {
      owners.delete(this.transport.owner);
      throw new NativeDownloadCaptureError('invalid_download_budget', 'not_applied');
    }
    let cancelled = false;
    let expired = false;
    let timedOut = false;
    let started = false;
    let clicked = false;
    let fetchTouched = false;
    let released = false;
    let retired = false;
    let ambiguous = false;
    let receipt: Receipt | undefined;
    let bodyFailure: string | undefined;
    let totalBytes = 0;
    const requests = new Map<
      string,
      { url: string; frameId: string; method: string; pending: boolean }
    >();
    // Only the clicked frame's own subtree can supply a native receipt. This
    // includes same-origin export iframes created by its click handler, never
    // other tabs, siblings or pre-existing ungranted cross-origin frames.
    const frames = new Map<string, string | null>([[options.frameId, null]]);
    const retireFrame = (id: string, keepSelected = false) => {
      const pending = [id];
      const seen = new Set<string>();
      for (const frame of pending) {
        if (seen.has(frame)) continue;
        seen.add(frame);
        for (const [child, parent] of frames) if (parent === frame) pending.push(child);
        if (!keepSelected || frame !== options.frameId) frames.delete(frame);
      }
      return seen;
    };
    const allowedResponse = (url: string) => {
      try {
        return sameOrigin(url, options.origin) || options.responseSources?.accepts(url) === true;
      } catch {
        return false;
      }
    };
    const bodies: NetworkBody[] = [];
    const jobs = new Set<Promise<void>>();
    let notify: (() => void) | undefined;
    const wake = () => {
      notify?.();
      notify = undefined;
    };
    const current = () => {
      try {
        return !this.closed && !cancelled && !options.signal?.aborted && options.current();
      } catch {
        return false;
      }
    };
    const send = (method: string, params: Record<string, unknown> = {}) =>
      this.transport.send(method, params);
    const restoreBlob = () => options.blobs?.restore() ?? Promise.resolve();
    const closeStream = (body: NetworkBody): Promise<void> => {
      if (!body.handle) return Promise.resolve();
      body.streamClosing ??= (async () => {
        await send('IO.close', { handle: body.handle });
        body.handle = undefined;
      })().catch((error) => {
        body.streamClosing = undefined;
        throw error;
      });
      return body.streamClosing;
    };
    const closeBody = (body: NetworkBody): Promise<void> => {
      if (body.settled) return closeStream(body);
      body.closing ??= (async () => {
        if (body.taken && !body.handle) await body.claim;
        await closeStream(body);
        await send('Fetch.failRequest', { requestId: body.requestId, errorReason: 'Aborted' });
        body.settled = true;
        body.confirmCancellation();
      })().catch((error) => {
        body.closing = undefined;
        throw error;
      });
      return body.closing;
    };
    const cancel = () => {
      cancelled = true;
      wake();
      void restoreBlob().catch(() => {});
      for (const body of bodies) if (!body.settled) void closeBody(body).catch(() => {});
    };
    this.stop = cancel;
    const pass = (requestId: string) => {
      void send('Fetch.continueRequest', { requestId }).catch(() => {});
    };
    const collect = async (
      body: NetworkBody,
      headers: Array<{ name: string; value: string }>,
      status: number,
    ) => {
      const chunks = body.chunks;
      let size = 0;
      try {
        if (!current()) {
          await send('Fetch.continueRequest', { requestId: body.requestId });
          body.settled = true;
          return;
        }
        body.taken = true;
        body.claim = send('Fetch.takeResponseBodyAsStream', { requestId: body.requestId });
        const stream = (await body.claim) as { stream?: string };
        if (typeof stream.stream !== 'string') throw new Error('original_response_unavailable');
        body.handle = stream.stream;
        if (!current() || timedOut || retired) {
          await closeBody(body);
          return;
        }
        for (;;) {
          const part = (await send('IO.read', {
            handle: body.handle,
            size: Math.min(CHUNK_BYTES, maxBytes + 1 - size),
          })) as { data?: unknown; base64Encoded?: unknown; eof?: unknown };
          if (!current() || timedOut || retired) {
            await closeBody(body);
            return;
          }
          if (
            typeof part.data !== 'string' ||
            typeof part.eof !== 'boolean' ||
            part.data.length > CHUNK_BYTES * 4 + 8
          )
            throw new Error('original_response_unavailable');
          const bytes =
            part.base64Encoded === true
              ? base64Bytes(part.data, CHUNK_BYTES)
              : new TextEncoder().encode(part.data);
          size += bytes.length;
          totalBytes += bytes.length;
          if (size > maxBytes || totalBytes > maxBytes) {
            bytes.fill(0);
            throw new Error('download_too_large');
          }
          chunks.push(bytes);
          if (!current() || timedOut) {
            await closeBody(body);
            return;
          }
          if (part.eof) break;
        }
        await closeStream(body);
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        if (!current() || timedOut || retired) {
          bytes.fill(0);
          await closeBody(body);
          return;
        }
        body.buffer = bytes;
        await send('Fetch.fulfillRequest', {
          requestId: body.requestId,
          responseCode: status,
          responseHeaders: headers,
          body: toBase64(bytes),
        });
        body.settled = true;
      } catch (error) {
        body.error =
          error instanceof Error && error.message === 'download_too_large'
            ? 'download_too_large'
            : 'original_response_unavailable';
        bodyFailure = body.error;
        await closeBody(body).catch(() => {});
      } finally {
        for (const chunk of chunks) chunk.fill(0);
        wake();
      }
    };
    const listener: NativeDownloadEvent = (method, params) => {
      if (released) return;
      if (method === 'Page.frameNavigated') {
        const frame = params.frame as
          | { id?: unknown; url?: unknown; securityOrigin?: unknown }
          | undefined;
        if (typeof frame?.id === 'string' && frames.has(frame.id)) {
          const inherited =
            (frame.url === 'about:blank' || frame.url === 'about:srcdoc') &&
            frame.securityOrigin === options.origin;
          const same =
            typeof frame.url === 'string' &&
            sameOrigin(frame.url, options.origin) &&
            (frame.securityOrigin === undefined || frame.securityOrigin === options.origin);
          if (!same && !inherited) {
            const revoked = retireFrame(frame.id);
            // A detached download can still finish, but a committed foreign
            // document must not reuse its predecessor's response/receipt IDs.
            for (const [id, request] of requests)
              if (revoked.has(request.frameId)) requests.delete(id);
            if (
              bodies.some((body) => revoked.has(body.frameId)) ||
              (receipt && revoked.has(receipt.frameId))
            ) {
              bodyFailure = 'scope_unavailable';
              wake();
            }
          }
        }
        return;
      }
      if (method === 'Page.frameAttached') {
        if (
          started &&
          !expired &&
          !retired &&
          current() &&
          frames.size < 64 &&
          typeof params.frameId === 'string' &&
          typeof params.parentFrameId === 'string' &&
          !frames.has(params.frameId) &&
          frames.has(params.parentFrameId)
        )
          frames.set(params.frameId, params.parentFrameId);
        return;
      }
      if (method === 'Page.frameDetached') {
        retireFrame(String(params.frameId), true);
        return;
      }
      if (method === 'Fetch.requestPaused') {
        const id = params.requestId;
        if (typeof id !== 'string') return;
        const networkId = params.networkId;
        const request = typeof networkId === 'string' ? requests.get(networkId) : undefined;
        const requestData = params.request as { url?: unknown } | undefined;
        const headers = params.responseHeaders as
          | Array<{ name: string; value: string }>
          | undefined;
        const status = params.responseStatusCode;
        if (request) {
          request.pending = false;
          wake();
        }
        const attachment =
          Array.isArray(headers) &&
          headers.some(
            (header) =>
              typeof header.name === 'string' &&
              header.name.toLowerCase() === 'content-disposition' &&
              /^\s*attachment(?:\s*;|\s*$)/i.test(header.value),
          );
        if (
          retired ||
          !started ||
          !current() ||
          !request ||
          request.url !== requestData?.url ||
          params.frameId !== request.frameId ||
          !['Document', 'Other'].includes(String(params.resourceType)) ||
          !attachment ||
          typeof status !== 'number' ||
          status < 200 ||
          status >= 300 ||
          bodies.length >= 2
        ) {
          pass(id);
          return;
        }
        let mimeType: string;
        try {
          mimeType = mediaType(
            headers?.find((header) => header.name.toLowerCase() === 'content-type')?.value ??
              'application/octet-stream',
          );
        } catch {
          bodyFailure = 'download_metadata_invalid';
          pass(id);
          wake();
          return;
        }
        let confirmCancellation!: () => void;
        const cancellation = new Promise<void>((resolve) => {
          confirmCancellation = resolve;
        });
        const body: NetworkBody = {
          frameId: request.frameId,
          requestId: id,
          networkId: networkId as string,
          url: request.url,
          mimeType,
          taken: false,
          settled: false,
          cancellation,
          confirmCancellation,
          chunks: [],
        };
        bodies.push(body);
        const job = collect(body, headers!, status);
        body.job = job;
        jobs.add(job);
        void job.finally(() => jobs.delete(job));
        return;
      }
      if (!started || retired) return;
      if (method === 'Network.requestWillBeSent') {
        const request = params.request as { url?: unknown; method?: unknown } | undefined;
        if (
          !expired &&
          current() &&
          ['Document', 'Other'].includes(String(params.type)) &&
          typeof params.frameId === 'string' &&
          frames.has(params.frameId) &&
          typeof params.requestId === 'string' &&
          typeof request?.url === 'string' &&
          typeof request.method === 'string' &&
          ['GET', 'POST'].includes(request.method) &&
          allowedResponse(request.url) &&
          requests.size < 64
        )
          requests.set(params.requestId, {
            url: request.url,
            frameId: params.frameId,
            method: request.method,
            pending: true,
          });
        return;
      }
      if (
        method === 'Page.downloadWillBegin' &&
        typeof params.frameId === 'string' &&
        (frames.has(params.frameId) ||
          [...requests.values()].some(
            (request) => request.frameId === params.frameId && request.url === params.url,
          )) &&
        typeof params.guid === 'string' &&
        typeof params.url === 'string' &&
        typeof params.suggestedFilename === 'string'
      ) {
        if (expired && !bodies.some((body) => body.url === params.url)) return;
        if (receipt && receipt.guid !== params.guid) ambiguous = true;
        else
          receipt = {
            frameId: params.frameId,
            guid: params.guid,
            url: params.url,
            filename: params.suggestedFilename,
            completed: false,
            cancelled: false,
          };
        wake();
        return;
      }
      if (method === 'Page.downloadProgress' && receipt && receipt.guid === params.guid) {
        receipt.completed = params.state === 'completed';
        receipt.cancelled = params.state === 'canceled';
        if (typeof params.receivedBytes === 'number') receipt.received = params.receivedBytes;
        wake();
      }
    };
    let unsubscribe: () => void;
    try {
      unsubscribe = this.transport.subscribe(listener);
    } catch {
      this.recovery = async () => {
        await restoreBlob();
        owners.delete(this.transport.owner);
        this.recovery = null;
      };
      try {
        await this.recovery();
      } catch {
        this.uncertain = true;
        throw new NativeDownloadCaptureError('download_restore_unconfirmed', 'not_applied');
      }
      throw new NativeDownloadCaptureError('download_event_source_unavailable', 'not_applied');
    }
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = () => {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = (async () => {
        expired = true;
        retired = true;
        for (const body of bodies) if (!body.settled) await closeBody(body);
        // Chromium may leave an old IO.read callback unanswered even after both
        // IO.close and Fetch.failRequest acknowledge the real cancellation.
        // Those two receipts prove the resource stopped; no late callback may
        // take bytes or fulfill a request after this operation is retired.
        await Promise.all(
          bodies.map((body) => Promise.race([body.job ?? Promise.resolve(), body.cancellation])),
        );
        for (const body of bodies) if (!body.settled) await closeBody(body);
        for (const body of bodies) {
          for (const chunk of body.chunks) chunk.fill(0);
          body.chunks.length = 0;
        }
        if (fetchTouched) await send('Fetch.disable');
        await restoreBlob();
        released = true;
        unsubscribe();
        this.recovery = null;
        owners.delete(this.transport.owner);
      })().catch((error) => {
        cleanupPromise = undefined;
        throw error;
      });
      return cleanupPromise;
    };
    this.recovery = cleanup;
    const captureTimer = setTimeout(() => {
      expired = true;
      wake();
      void restoreBlob().catch(() => {});
    }, captureMs);
    const totalTimer = setTimeout(() => {
      timedOut = true;
      cancel();
    }, totalMs);
    options.signal?.addEventListener('abort', cancel, { once: true });
    let result: NativeDownloadCaptureResult | undefined;
    let operationError: NativeDownloadCaptureError | undefined;
    let buffer: Uint8Array | undefined;
    try {
      if (!current())
        result = {
          status: 'not_applied',
          clickOutcome: 'not_applied',
          reason: 'scope_unavailable',
        };
      else {
        type FrameTree = {
          frame: { id: string; url?: string; securityOrigin?: string };
          childFrames?: FrameTree[];
        };
        const tree = (await send('Page.getFrameTree')) as { frameTree?: FrameTree };
        const visit = (node: FrameTree, inside = false, parent: string | null = null) => {
          const selected = node.frame.id === options.frameId;
          const eligible =
            selected ||
            (inside &&
              ((sameOrigin(node.frame.url ?? '', options.origin) &&
                (node.frame.securityOrigin === undefined ||
                  node.frame.securityOrigin === options.origin)) ||
                (node.frame.url === 'about:blank' &&
                  node.frame.securityOrigin === options.origin)));
          if (eligible && frames.size < 64) frames.set(node.frame.id, parent);
          for (const child of node.childFrames ?? []) visit(child, eligible, node.frame.id);
        };
        if (tree?.frameTree) visit(tree.frameTree);
        fetchTouched = true;
        await send('Fetch.enable', {
          patterns: [
            ...new Set([`${options.origin}/*`, ...(options.responseSources?.patterns ?? [])]),
          ].map((urlPattern) => ({ urlPattern, requestStage: 'Response' })),
        });
        await options.prepare();
        if (!current() || expired)
          result = {
            status: 'not_applied',
            clickOutcome: 'not_applied',
            reason: !current() ? 'scope_unavailable' : 'capture_expired',
          };
        else {
          started = true;
          await options.click();
          clicked = true;
          while (
            current() &&
            !timedOut &&
            !ambiguous &&
            !bodyFailure &&
            !receipt?.cancelled &&
            !receipt?.completed &&
            !(
              expired &&
              !jobs.size &&
              !receipt &&
              ![...requests.values()].some((request) => request.pending) &&
              !bodies.some((body) => body.settled && body.buffer)
            )
          )
            await new Promise<void>((resolve) => {
              notify = resolve;
            });
          await restoreBlob();
          if (
            !current() ||
            timedOut ||
            ambiguous ||
            bodyFailure ||
            receipt?.cancelled ||
            !receipt?.completed
          )
            result = {
              status: 'clicked',
              clickOutcome: 'applied',
              reason: timedOut
                ? 'download_timeout'
                : !current()
                  ? 'scope_unavailable'
                  : ambiguous
                    ? 'download_ambiguous'
                    : (bodyFailure ?? (receipt?.cancelled ? 'download_cancelled' : 'not_captured')),
            };
          else {
            let mimeType: string;
            let originBasis: 'download_url' | 'owning_page';
            if (allowedResponse(receipt.url)) {
              if (receipt.url.startsWith('blob:')) {
                if (!options.blobs) throw new Error('blob_source_unavailable');
                const info = await options.blobs.describe(receipt.url);
                mimeType = mediaType(info.mimeType || 'application/octet-stream');
                originBasis = 'owning_page';
                if (info.sizeBytes > maxBytes) throw new Error('download_too_large');
                buffer = new Uint8Array(info.sizeBytes);
                for (let offset = 0; offset < buffer.length; offset += CHUNK_BYTES)
                  buffer.set(
                    await options.blobs.read(
                      receipt.url,
                      offset,
                      Math.min(CHUNK_BYTES, buffer.length - offset),
                    ),
                    offset,
                  );
              } else {
                await Promise.all([...jobs]);
                const candidates = bodies.filter(
                  (value) =>
                    value.url === receipt!.url &&
                    value.frameId === receipt!.frameId &&
                    value.settled &&
                    value.buffer,
                );
                if (candidates.length > 1) throw new Error('download_ambiguous');
                const body = candidates[0];
                if (!body?.buffer) throw new Error('original_response_unavailable');
                buffer = body.buffer;
                body.buffer = undefined;
                mimeType = body.mimeType;
                originBasis = sameOrigin(receipt.url, options.origin)
                  ? 'download_url'
                  : 'owning_page';
              }
            } else if (receipt.url.startsWith('data:')) {
              const parsed = decodeData(receipt.url, maxBytes);
              buffer = parsed.bytes;
              mimeType = parsed.mimeType;
              originBasis = 'owning_page';
            } else throw new Error('origin_grant_required');
            await options.finalCheck();
            if (!current()) throw new Error('scope_unavailable');
            if (ambiguous) throw new Error('download_ambiguous');
            const digest = new Uint8Array(
              await crypto.subtle.digest('SHA-256', buffer as Uint8Array<ArrayBuffer>),
            );
            if (!current()) throw new Error('scope_unavailable');
            if (ambiguous) throw new Error('download_ambiguous');
            const file = makeFile(
              buffer,
              {
                filename: filename(receipt.filename),
                mimeType,
                sizeBytes: buffer.length,
                sha256: Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join(''),
              },
              { origin: options.origin, originBasis, guid: receipt.guid, frameId: options.frameId },
              current,
            );
            buffer = undefined;
            result = { status: 'captured', clickOutcome: 'applied', file };
          }
        }
      }
    } catch (error) {
      if (started && !clicked)
        operationError = new NativeDownloadCaptureError('input_outcome_unknown', 'unknown');
      else if (!started)
        operationError = new NativeDownloadCaptureError(
          'download_target_unavailable',
          'not_applied',
        );
      else result = { status: 'clicked', clickOutcome: 'applied', reason: reason(error) };
    } finally {
      clearTimeout(captureTimer);
      clearTimeout(totalTimer);
      options.signal?.removeEventListener('abort', cancel);
      try {
        await cleanup();
      } catch {
        this.uncertain = true;
        operationError = new NativeDownloadCaptureError(
          'download_restore_unconfirmed',
          clicked ? 'applied' : started ? 'unknown' : 'not_applied',
        );
      }
      buffer?.fill(0);
      for (const body of bodies) {
        body.buffer?.fill(0);
        body.url = '';
      }
      requests.clear();
      receipt = undefined;
    }
    if (operationError) {
      if (result?.status === 'captured') result.file.dispose();
      throw operationError;
    }
    if (!current() && !timedOut) {
      if (result?.status === 'captured') result.file.dispose();
      return clicked
        ? { status: 'clicked', clickOutcome: 'applied', reason: 'scope_unavailable' }
        : { status: 'not_applied', clickOutcome: 'not_applied', reason: 'scope_unavailable' };
    }
    return result!;
  }
}

function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return [
    'blob_source_unavailable',
    'scope_unavailable',
    'download_too_large',
    'origin_grant_required',
    'download_metadata_invalid',
    'data_payload_invalid',
    'download_ambiguous',
  ].includes(message)
    ? message
    : 'original_response_unavailable';
}
function sameOrigin(url: string, origin: string): boolean {
  try {
    const value = new URL(url);
    return value.origin === origin && !value.username && !value.password;
  } catch {
    return false;
  }
}
function mediaType(raw: string): string {
  const value = raw.split(';')[0]!.trim().toLowerCase();
  if (value.length > 255 || !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(value))
    throw new Error('download_metadata_invalid');
  return value;
}
function filename(raw: string): string {
  if (
    !raw ||
    raw.length > 255 ||
    raw === '.' ||
    raw === '..' ||
    /[/\\]/.test(raw) ||
    Array.from(raw).some((value) => value.charCodeAt(0) < 32 || value.charCodeAt(0) === 127)
  )
    throw new Error('download_metadata_invalid');
  return raw;
}
function base64Bytes(value: string, max: number): Uint8Array {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const equal = value.indexOf('=');
  if (
    value.length > Math.ceil(max / 3) * 4 ||
    value.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(value) ||
    (equal >= 0 && equal !== value.length - padding)
  )
    throw new Error('data_payload_invalid');
  const binary = atob(value);
  if (binary.length > max) throw new Error('download_too_large');
  return Uint8Array.from(binary, (value) => value.charCodeAt(0));
}
function toBase64(value: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < value.length; offset += 8192)
    binary += String.fromCharCode(...value.subarray(offset, offset + 8192));
  return btoa(binary);
}
function percentBytes(value: string, max: number): Uint8Array {
  const result = new Uint8Array(Math.min(max, value.length * 3));
  let offset = 0;
  let cursor = 0;
  const encoder = new TextEncoder();
  while (cursor < value.length) {
    if (value[cursor] === '%') {
      const token = value.slice(cursor + 1, cursor + 3);
      if (!/^[a-fA-F0-9]{2}$/.test(token)) throw new Error('data_payload_invalid');
      if (offset >= result.length) throw new Error('download_too_large');
      result[offset++] = Number.parseInt(token, 16);
      cursor += 3;
    } else {
      const end = value.indexOf('%', cursor);
      const part = value.slice(cursor, end < 0 ? value.length : end);
      const encoded = encoder.encodeInto(part, result.subarray(offset));
      if (encoded.read !== part.length) throw new Error('download_too_large');
      offset += encoded.written;
      cursor += part.length;
    }
  }
  return result.slice(0, offset);
}
function decodeData(url: string, max: number): { bytes: Uint8Array; mimeType: string } {
  if (url.length > Math.ceil(max / 3) * 12 + 1024) throw new Error('download_too_large');
  const comma = url.indexOf(',');
  if (comma < 5 || comma > 1024) throw new Error('data_payload_invalid');
  const header = url.slice(5, comma).split(';');
  const mimeType = mediaType(header[0] || 'text/plain');
  const base64 = header.slice(1).some((value) => value.toLowerCase() === 'base64');
  const decoded = percentBytes(url.slice(comma + 1), base64 ? Math.ceil(max / 3) * 4 : max);
  if (!base64) return { bytes: decoded, mimeType };
  const bytes = base64Bytes(new TextDecoder('ascii', { fatal: true }).decode(decoded), max);
  decoded.fill(0);
  return { bytes, mimeType };
}
function makeFile(
  bytes: Uint8Array,
  metadata: ReturnType<NativeDownloadFile['metadata']>,
  source: ReturnType<NativeDownloadFile['source']>,
  current: () => boolean,
): NativeDownloadFile {
  let disposed = false;
  const dispose = () => {
    disposed = true;
    bytes.fill(0);
    clearTimeout(timer);
  };
  const timer = setTimeout(dispose, 120000);
  const check = () => {
    if (disposed || !current()) throw new Error('scope_unavailable');
  };
  return {
    get alive() {
      return !disposed && current();
    },
    metadata() {
      check();
      return { ...metadata };
    },
    source() {
      check();
      return { ...source };
    },
    read(offset, length) {
      check();
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > bytes.length ||
        !Number.isInteger(length) ||
        length < 1 ||
        length > CHUNK_BYTES
      )
        throw new Error('invalid_download_chunk');
      const value = bytes.slice(offset, offset + length);
      check();
      return value;
    },
    dispose,
  };
}
