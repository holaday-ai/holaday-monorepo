/**
 * Phase 5c — storage abstraction layer.
 *
 * Today every byte written via FileService lives on the orchestrator's
 * local disk under FILES_ROOT (Vultr's `/opt/holaday-files/`). That's
 * fine while the per-user upload + agent-generated-output volume is
 * small, but it blocks horizontal scaling and ties the orchestrator
 * to the disk's TTL behaviour for the 24h-expire output files.
 *
 * Phase 5c lays the abstraction without flipping the switch:
 *
 *   StorageProvider          — interface (put / get / delete / signed)
 *   LocalStorageProvider     — current behaviour, wraps fs.{write,read,unlink}
 *   R2StorageProvider        — Cloudflare R2 via @aws-sdk/client-s3
 *                              (R2 is S3-API-compatible; same SDK works)
 *   createStorageProvider()  — factory; reads STORAGE_PROVIDER env
 *                              (default 'local')
 *
 * FileService threads everything through the injected provider, so a
 * future flip to R2 (set STORAGE_PROVIDER=r2 + R2 creds in env) needs
 * NO FileService change and NO call-site change.
 *
 * Migration plan when we eventually flip:
 *   1. Run scripts/migrate-files-to-r2.ts to upload existing local
 *      files to R2 (script writes new storage_path values back to the
 *      task_files row)
 *   2. Flip STORAGE_PROVIDER=r2 in env + restart
 *   3. Once verified, drop the local files
 *
 * Today only the LOCAL provider is exercised; R2 has integration
 * tests in scripts/ but isn't wired into the boot path. A
 * provider-misconfiguration at boot (R2 creds missing while
 * STORAGE_PROVIDER=r2) throws early and visibly.
 */

import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Logger } from 'pino';

export type FileKind = 'input' | 'output';

/**
 * Opaque storage handle returned from `put` and consumed by `get` /
 * `delete` / `getSignedUrl`. Today providers store the full path /
 * S3 key in this string. Treat as opaque from outside: future
 * versions might encode metadata into it.
 */
export type StoragePath = string;

export interface PutInput {
  /** User's external_id (`usr_…`). Used to scope the storage path. */
  userExternalId: string;
  /** input = user upload, output = agent-generated. Drives the path prefix. */
  kind: FileKind;
  /** File's external_id (`file_…`). Guarantees collision-free per-file dir. */
  fileExternalId: string;
  /** Original filename (already sanitised by caller). */
  filename: string;
  /** Raw bytes. Caller has already checked the plan's size cap. */
  buffer: Buffer;
  /** MIME type — passed through to providers that retain it on disk metadata. */
  mimetype: string;
}

export interface StorageObjectInput {
  userExternalId: string;
  kind: FileKind;
  fileExternalId: string;
  filename: string;
}

export interface PutFileInput extends StorageObjectInput {
  /** Local path to stream/copy from without materializing the file as one Buffer. */
  sourcePath: string;
  sizeBytes: number;
  mimetype: string;
}

export interface GetSignedUrlOptions {
  /** TTL of the issued URL. Defaults to 1 hour. */
  expiresInSeconds?: number;
  /**
   * Filename to use in the Content-Disposition header when the client
   * downloads via the signed URL. Lets a stored path of `file_abc/abc`
   * surface to the user as e.g. `report-2026-05.xlsx`.
   */
  downloadFilename?: string;
}

export interface PutUrlInput {
  /** User's external_id (`usr_…`). Scopes the storage key. */
  userExternalId: string;
  /** input = user upload, output = agent-generated. Drives the key prefix. */
  kind: FileKind;
  /** File's external_id (`file_…`). Collision-free per-file key segment. */
  fileExternalId: string;
  /** Original filename (already sanitised by caller). */
  filename: string;
  /** MIME the client must send as Content-Type on the PUT (signed in). */
  contentType: string;
  /** TTL of the issued URL. Defaults to 15 minutes — long enough for a
   * 200MB upload on a slow link, short enough to limit replay. */
  expiresInSeconds?: number;
}

/** Object metadata from a HEAD — size + content-type without the body. */
export interface StatResult {
  sizeBytes: number;
  contentType?: string;
}

export interface DeleteStorageOptions {
  /** Remote providers must forward this to their native request. */
  signal?: AbortSignal;
}

export const ACCOUNT_CLOSURE_STORAGE_DELETE_TIMEOUT_MS = 5_000;

export interface StorageProvider {
  /**
   * Resolve the exact path/key that a subsequent put will use. Temporary
   * artifacts reserve this path in the DB before uploading, so a process crash
   * cannot leave an unindexed object behind.
   */
  pathFor(input: StorageObjectInput): StoragePath;
  /** Persist a buffer; returns the opaque storage handle for later get/delete. */
  put(input: PutInput): Promise<{ storagePath: StoragePath }>;
  /** Persist a local file without loading the whole artifact into memory. */
  putFile(input: PutFileInput): Promise<{ storagePath: StoragePath }>;
  /** Read bytes. Returns null when the path doesn't exist (caller decides 404 vs 500). */
  get(storagePath: StoragePath): Promise<Buffer | null>;
  /** Remove. No-op when the path doesn't exist (idempotent — handles double-cleanup). */
  delete(storagePath: StoragePath, options?: DeleteStorageOptions): Promise<void>;
  /**
   * Return a short-lived URL the SPA can use for a direct-download
   * GET. For providers without native signing (local disk), returns
   * `null` and the caller should fall back to the authed-blob path
   * already used by FileDownloadCard.
   */
  getSignedUrl(storagePath: StoragePath, opts?: GetSignedUrlOptions): Promise<string | null>;
  /**
   * Return a short-lived URL the client PUTs raw bytes to directly
   * (browser → R2), so a large upload never streams through the
   * orchestrator process / multer memoryStorage. Returns `null` for
   * providers without native signing (local disk) — the caller then
   * falls back to the multipart `/files/upload` path.
   */
  getSignedPutUrl(input: PutUrlInput): Promise<{ url: string; storagePath: StoragePath } | null>;
  /**
   * Cheap metadata read (HEAD) — size + content-type without fetching
   * the body. Used to verify a presigned-PUT upload actually landed and
   * to read its real size for the per-plan cap check (the client's
   * declared size is untrusted). Returns `null` when the object is
   * missing.
   */
  stat(storagePath: StoragePath): Promise<StatResult | null>;
}

/**
 * Closure-only object deletion. The provider receives a native cancellation
 * signal and this function awaits its settlement, so no mutation continues in
 * the background after the worker handles the result.
 */
export async function deleteStorageObjectForClosure(
  storage: Pick<StorageProvider, 'delete'>,
  storagePath: StoragePath,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? ACCOUNT_CLOSURE_STORAGE_DELETE_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    throw new Error('Invalid account closure storage timeout');
  }
  options.signal?.throwIfAborted();
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  await storage.delete(storagePath, { signal });
  options.signal?.throwIfAborted();
}

// ---------------------------------------------------------------------------
// Local provider — current production behaviour.
// ---------------------------------------------------------------------------

/**
 * Disk-backed provider. Path layout:
 *   <root>/<userExternalId>/<kind>/<fileExternalId>/<filename>
 *
 * `getSignedUrl` returns null because local doesn't sign — the
 * orchestrator's `/api/files/:id/download` route already handles
 * authed reads, so the SPA never actually needs a signed URL when
 * the provider is local.
 */
export class LocalStorageProvider implements StorageProvider {
  constructor(
    private readonly root: string,
    private readonly logger: Logger,
  ) {}

  pathFor(input: StorageObjectInput): StoragePath {
    return path.join(
      this.root,
      input.userExternalId,
      input.kind,
      input.fileExternalId,
      input.filename,
    );
  }

  async put(input: PutInput): Promise<{ storagePath: StoragePath }> {
    const dir = path.join(this.root, input.userExternalId, input.kind, input.fileExternalId);
    await fs.mkdir(dir, { recursive: true });
    const storagePath = this.pathFor(input);
    await fs.writeFile(storagePath, input.buffer);
    return { storagePath };
  }

  async putFile(input: PutFileInput): Promise<{ storagePath: StoragePath }> {
    const storagePath = this.pathFor(input);
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    await fs.copyFile(input.sourcePath, storagePath);
    return { storagePath };
  }

  async get(storagePath: StoragePath): Promise<Buffer | null> {
    try {
      return await fs.readFile(storagePath);
    } catch (err) {
      this.logger.warn(
        { err: errMsg(err), path: storagePath },
        'storage:local: read failed (file deleted out-of-band?)',
      );
      return null;
    }
  }

  async delete(storagePath: StoragePath, _options?: DeleteStorageOptions): Promise<void> {
    try {
      await fs.unlink(storagePath);
    } catch (err) {
      // ENOENT is expected when the file's already gone (double-clean).
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn({ err: errMsg(err), path: storagePath }, 'storage:local: delete failed');
        throw err;
      }
    }
  }

  async getSignedUrl(
    _storagePath: StoragePath,
    _opts?: GetSignedUrlOptions,
  ): Promise<string | null> {
    return null;
  }

  async getSignedPutUrl(
    _input: PutUrlInput,
  ): Promise<{ url: string; storagePath: StoragePath } | null> {
    // Local disk can't issue a presigned PUT — the caller falls back to
    // the multipart `/files/upload` path on local dev.
    return null;
  }

  async stat(storagePath: StoragePath): Promise<StatResult | null> {
    try {
      const s = await fs.stat(storagePath);
      return { sizeBytes: s.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      this.logger.warn({ err: errMsg(err), path: storagePath }, 'storage:local: stat failed');
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// R2 provider — wire-ready, off by default.
// ---------------------------------------------------------------------------

export interface R2Config {
  /** R2 endpoint: `https://<account_id>.r2.cloudflarestorage.com`. */
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Region for the SDK; R2 ignores it but the client requires a value. Defaults 'auto'. */
  region?: string;
}

/**
 * Cloudflare R2 provider via the AWS S3 SDK. R2's API is S3-compatible
 * (PutObject / GetObject / DeleteObject / presigned URLs all work).
 *
 * Today this class is constructable but NOT wired into FileService —
 * the factory below only returns it when STORAGE_PROVIDER=r2.
 * Per-method runtime errors surface as exceptions; the caller layer
 * (FileService) doesn't currently retry, so a transient R2 hiccup
 * would 500 the upload. Acceptable for v1 — retry can be added later
 * once we have real R2 traffic patterns to size the budget against.
 */
export class R2StorageProvider implements StorageProvider {
  private readonly client: S3Client;

  constructor(
    private readonly config: R2Config,
    private readonly logger: Logger,
    // DI point for tests — pass a fake S3Client to assert call shape
    // without hitting the network. Production uses the real S3Client.
    deps?: { client?: S3Client },
  ) {
    this.client =
      deps?.client ??
      new S3Client({
        region: config.region ?? 'auto',
        endpoint: config.endpoint,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
  }

  pathFor(input: StorageObjectInput): StoragePath {
    // Same logical path shape as local for migration parity. R2 has no
    // notion of directories — slashes are just key characters.
    return `${input.userExternalId}/${input.kind}/${input.fileExternalId}/${input.filename}`;
  }

  async put(input: PutInput): Promise<{ storagePath: StoragePath }> {
    const key = this.pathFor(input);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: input.buffer,
        ContentType: input.mimetype,
      }),
    );
    // Store the full key as storagePath; matches the local layout
    // pattern (path-shaped string) so migration scripts can swap one
    // for the other without re-encoding.
    return { storagePath: key };
  }

  async putFile(input: PutFileInput): Promise<{ storagePath: StoragePath }> {
    const key = this.pathFor(input);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: createReadStream(input.sourcePath),
        ContentLength: input.sizeBytes,
        ContentType: input.mimetype,
      }),
    );
    return { storagePath: key };
  }

  async get(storagePath: StoragePath): Promise<Buffer | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: storagePath,
        }),
      );
      const body = res.Body as NodeJS.ReadableStream | undefined;
      if (!body) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(chunk as Buffer);
      }
      return Buffer.concat(chunks);
    } catch (err) {
      const code = (err as { name?: string }).name;
      // NoSuchKey is the R2/S3 404 — treat as missing, return null
      // so the route layer can 404 cleanly.
      if (code === 'NoSuchKey' || code === 'NotFound') return null;
      this.logger.warn({ err: errMsg(err), path: storagePath, code }, 'storage:r2: get failed');
      throw err;
    }
  }

  async delete(storagePath: StoragePath, options?: DeleteStorageOptions): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.config.bucket,
          Key: storagePath,
        }),
        options?.signal ? { abortSignal: options.signal } : undefined,
      );
    } catch (err) {
      const code = (err as { name?: string }).name;
      if (code === 'NoSuchKey' || code === 'NotFound') return;
      this.logger.warn({ err: errMsg(err), path: storagePath, code }, 'storage:r2: delete failed');
      throw err;
    }
  }

  async getSignedUrl(storagePath: StoragePath, opts?: GetSignedUrlOptions): Promise<string | null> {
    try {
      const cmd = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: storagePath,
        ...(opts?.downloadFilename
          ? {
              ResponseContentDisposition: `attachment; filename="${opts.downloadFilename.replace(/"/g, '')}"`,
            }
          : {}),
      });
      return await getSignedUrl(this.client, cmd, {
        expiresIn: opts?.expiresInSeconds ?? 3600,
      });
    } catch (err) {
      this.logger.warn({ err: errMsg(err), path: storagePath }, 'storage:r2: getSignedUrl failed');
      return null;
    }
  }

  async getSignedPutUrl(
    input: PutUrlInput,
  ): Promise<{ url: string; storagePath: StoragePath } | null> {
    const key = this.pathFor(input);
    try {
      const cmd = new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: input.contentType,
      });
      const url = await getSignedUrl(this.client, cmd, {
        expiresIn: input.expiresInSeconds ?? 900,
      });
      return { url, storagePath: key };
    } catch (err) {
      this.logger.warn({ err: errMsg(err), path: key }, 'storage:r2: getSignedPutUrl failed');
      return null;
    }
  }

  async stat(storagePath: StoragePath): Promise<StatResult | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: storagePath,
        }),
      );
      return {
        sizeBytes: typeof res.ContentLength === 'number' ? res.ContentLength : 0,
        ...(res.ContentType ? { contentType: res.ContentType } : {}),
      };
    } catch (err) {
      const code = (err as { name?: string }).name;
      // NoSuchKey/NotFound is the HEAD 404 — object never landed.
      if (code === 'NoSuchKey' || code === 'NotFound') return null;
      this.logger.warn({ err: errMsg(err), path: storagePath, code }, 'storage:r2: stat failed');
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

export interface CreateStorageProviderOpts {
  /** Defaults to FILES_ROOT for local; ignored for R2. */
  localRoot?: string;
  logger: Logger;
}

/**
 * Process-wide singleton populated lazily on first
 * `getSharedStorageProvider()` call. Holds whichever provider the
 * factory returned (Local OR R2) so every FileService / migration
 * script picks up the SAME instance. Tests reset it via the exported
 * `_resetSharedStorageProviderForTesting` helper.
 *
 * Why a singleton: R2's S3Client is heavyweight (keeps an HTTP/2
 * connection pool); spinning up a fresh one per FileService — which
 * is constructed dozens of times per task lifecycle — would be
 * wasteful, even though correctness wouldn't suffer.
 */
let sharedStorageProvider: StorageProvider | null = null;

/**
 * Return (and lazily initialize) the process-wide storage provider.
 * First call reads env via createStorageProvider; subsequent calls
 * return the cached instance. Caller should pass the application
 * logger so the lazy-init path can warn / throw with context.
 */
export function getSharedStorageProvider(opts: CreateStorageProviderOpts): StorageProvider {
  if (sharedStorageProvider === null) {
    sharedStorageProvider = createStorageProvider(opts);
  }
  return sharedStorageProvider;
}

/**
 * Test-only reset. Production code never calls this — the singleton
 * is meant to live for the entire process lifetime.
 */
export function _resetSharedStorageProviderForTesting(): void {
  sharedStorageProvider = null;
}

/**
 * Read env + return the right provider. Default is LOCAL — flipping
 * to R2 requires STORAGE_PROVIDER=r2 plus the four R2_* creds. A
 * missing cred while flag=r2 throws here at boot so misconfiguration
 * fails LOUDLY instead of silently using local.
 *
 * Suppresses the random unused-var warning by exporting the helper
 * so config tests can drive it directly.
 */
export function createStorageProvider(opts: CreateStorageProviderOpts): StorageProvider {
  const flag = (process.env.STORAGE_PROVIDER ?? 'local').toLowerCase();
  if (flag === 'r2') {
    const endpoint = process.env.R2_ENDPOINT;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucket = process.env.R2_BUCKET;
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error(
        'STORAGE_PROVIDER=r2 requires R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET',
      );
    }
    return new R2StorageProvider(
      {
        endpoint,
        accessKeyId,
        secretAccessKey,
        bucket,
        ...(process.env.R2_REGION ? { region: process.env.R2_REGION } : {}),
      },
      opts.logger,
    );
  }
  if (flag !== 'local') {
    // Unknown value → fall through to local, log a warning so a
    // typo (STORAGE_PROVIDER=R2 vs r2) doesn't silently downgrade.
    opts.logger.warn({ flag }, 'storage: unknown STORAGE_PROVIDER value, falling back to local');
  }
  const root = opts.localRoot ?? process.env.HOLADAY_FILES_ROOT ?? '/tmp/holaday-files';
  return new LocalStorageProvider(root, opts.logger);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
