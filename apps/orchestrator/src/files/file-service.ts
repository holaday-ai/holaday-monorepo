/**
 * File service — single entry point for both directions of the
 * Phase 10 Tier 3 file flow.
 *
 *   - Inputs: user uploads (CSV / PDF / image / …) that the supercar
 *     agent reads into a user-message content block.
 *   - Outputs: files the agent generates via the `create_file` tool
 *     (xlsx / pdf / docx / …) for the user to download.
 *
 * Storage layout under FILES_ROOT (configurable via env, defaults to
 * /tmp/holaday-files):
 *
 *   <FILES_ROOT>/<userExternalId>/<kind>/<fileExternalId>/<filename>
 *
 * The per-(user, kind, fileId) directory keeps name collisions
 * impossible without ever reading user input as a path component
 * (every segment is server-generated).
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { type PlanId, newExternalId } from '@holaday/shared-types';
import { and, asc, eq, gt, isNull, like, notLike, or } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import { type TaskFile, taskFiles } from '../db/schema/task-files.js';
import { tasks } from '../db/schema/tasks.js';
import type { StorageProvider } from './storage-provider.js';
import { deleteStorageObjectForClosure, getSharedStorageProvider } from './storage-provider.js';

export type FileKind = 'input' | 'output';

export const FILES_ROOT = process.env.HOLADAY_FILES_ROOT ?? '/tmp/holaday-files';

/**
 * TTL for agent-generated `output` files (成片 等), in whole days, read from
 * `OUTPUT_FILE_TTL_DAYS` (default 30). Invalid / non-positive values fall back
 * to the default. The download read-gate (`loadForUser` expires_at check) and
 * the hourly cleanup-cron both key off each row's `expires_at`, so they follow
 * this value automatically — no other code needs touching to retune it.
 *
 * Read per-call (not a boot-time const) so it is unit-testable via `vi.stubEnv`
 * without reloading the module; prod sets it once via .env so the per-call cost
 * is irrelevant. ONLY `output` files use this — direct media uploads keep
 * their own 24h lifecycle unless a product flow explicitly retains one as a
 * durable user asset.
 */
export const DEFAULT_OUTPUT_FILE_TTL_DAYS = 30;
export const TEMPORARY_OUTPUT_TTL_MS = 15 * 60 * 1000;
export function outputFileTtlMs(): number {
  const raw = Number(process.env.OUTPUT_FILE_TTL_DAYS);
  const days = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_OUTPUT_FILE_TTL_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

/**
 * Per-plan upload caps in bytes. 0 disables uploads entirely; the
 * upload route returns a typed 403 in that case so the SPA can
 * render the right upsell copy.
 */
export const UPLOAD_BYTE_LIMIT: Record<PlanId, number> = {
  free: 0,
  basic: 5 * 1024 * 1024,
  pro: 10 * 1024 * 1024,
};

/**
 * MIME types we'll accept. Everything else 415s. Keep in sync with
 * the SPA's `accept` attr on the file input — divergence shows up as
 * "looks like it works in dev but server rejects" bug reports.
 */
export const ACCEPTED_MIMES = new Set<string>([
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Phase 1 #1 — docx so users can upload a Word TEMPLATE to fill.
  // (xlsx was already accepted above for data files / templates.)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

/** Loose extension fallback for clients that send octet-stream. */
export const ACCEPTED_EXTENSIONS = new Set<string>([
  '.txt',
  '.csv',
  '.md',
  '.json',
  '.pdf',
  '.xlsx',
  '.xls',
  '.docx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
]);

/**
 * Phase 1 (video) — media MIME/extension allowlist for the video
 * onboarding upload path. Kept SEPARATE from ACCEPTED_MIMES so the
 * 200MB media cap applies to video/audio without also letting a 200MB
 * PDF through the document path.
 */
export const MEDIA_ACCEPTED_MIMES = new Set<string>([
  // video
  'video/mp4',
  'video/quicktime', // .mov
  'video/webm',
  'video/x-m4v', // .m4v
  // audio (voice samples for cloning + BGM)
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mpeg', // .mp3
  'audio/mp4', // .m4a (some browsers)
  'audio/x-m4a', // .m4a
  'audio/aac',
  'audio/ogg',
]);

export const MEDIA_ACCEPTED_EXTENSIONS = new Set<string>([
  '.mp4',
  '.mov',
  '.webm',
  '.m4v',
  '.wav',
  '.mp3',
  '.m4a',
  '.aac',
  '.ogg',
]);

/**
 * Per-plan cap for the media (video/audio) presigned-upload path.
 * Base on-camera videos (15-60s @1080p) and voice samples need far
 * more than the 5/10MB document caps. free=0 keeps uploads gated to
 * paid plans, consistent with UPLOAD_BYTE_LIMIT.
 */
export const MEDIA_UPLOAD_BYTE_LIMIT: Record<PlanId, number> = {
  free: 0,
  basic: 200 * 1024 * 1024,
  pro: 200 * 1024 * 1024,
};

export type UploadClass = 'document' | 'media';

/**
 * Classify an upload by MIME/extension into the document vs media lane.
 * Returns null when neither allowlist matches (the route 415s). Media
 * is checked first so an .mp4 sent as application/octet-stream still
 * lands in the media lane via the extension fallback.
 */
export function classifyUpload(filename: string, mimetype: string): UploadClass | null {
  const dotIdx = filename.lastIndexOf('.');
  const ext = dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : '';
  const mime = mimetype.toLowerCase();
  if (MEDIA_ACCEPTED_MIMES.has(mime) || (ext.length > 0 && MEDIA_ACCEPTED_EXTENSIONS.has(ext))) {
    return 'media';
  }
  if (ACCEPTED_MIMES.has(mime) || (ext.length > 0 && ACCEPTED_EXTENSIONS.has(ext))) {
    return 'document';
  }
  return null;
}

/** Resolve the byte cap for a given upload class + plan. */
export function uploadByteLimit(cls: UploadClass, plan: PlanId): number {
  return cls === 'media' ? MEDIA_UPLOAD_BYTE_LIMIT[plan] : UPLOAD_BYTE_LIMIT[plan];
}

/**
 * Macro-enabled Office files (.docm/.xlsm/.pptm + their template
 * variants) carry executable VBA. The upload gate rejects them with a
 * clear message BEFORE storage; the template-fill safety layer
 * (template-safety.ts) is the real defence — it rejects any file with a
 * `vbaProject.bin` part even if the extension was renamed to .docx.
 */
const MACRO_OFFICE_EXT = /\.(?:docm|xlsm|pptm|dotm|xltm|potm)$/i;

export function isMacroOfficeUpload(filename: string, mimetype: string): boolean {
  const dotIdx = filename.lastIndexOf('.');
  const ext = dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : '';
  return MACRO_OFFICE_EXT.test(ext) || /macroenabled/i.test(mimetype.toLowerCase());
}

/** Whether an upload passes the MIME OR extension allowlist. Pure + testable. */
export function isAcceptedUpload(filename: string, mimetype: string): boolean {
  const dotIdx = filename.lastIndexOf('.');
  const ext = dotIdx >= 0 ? filename.slice(dotIdx).toLowerCase() : '';
  return (
    ACCEPTED_MIMES.has(mimetype.toLowerCase()) || (ext.length > 0 && ACCEPTED_EXTENSIONS.has(ext))
  );
}

/**
 * Decode a multipart upload filename (P2). busboy/multer surfaces the
 * Content-Disposition `filename` param decoded as LATIN1, which turns a
 * UTF-8 name (发票模板.docx) into mojibake — that garbled text then shows
 * up in the task summary («...»). The RFC 5987 `filename*` param, when a
 * browser sends it, is already proper UTF-8. We must recover the UTF-8
 * WITHOUT corrupting an already-correct name:
 *   - real Unicode present (CJK, >U+00FF) → came from filename* / fine → keep
 *   - pure ASCII → nothing to fix → keep
 *   - latin1 high bytes (0x80–0xFF) → UTF-8 bytes mis-read as latin1 →
 *     re-decode; if that yields replacement chars it was a genuine latin1
 *     name (café.docx), so keep the original.
 */
export function decodeUploadFilename(name: string): string {
  if (!name) return name;
  let hasHighByte = false;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c > 0xff) return name; // real Unicode (filename*) — already correct
    if (c >= 0x80) hasHighByte = true;
  }
  if (!hasHighByte) return name; // pure ASCII
  // latin1 high bytes → UTF-8 bytes mis-read as latin1; recover unless that
  // yields a replacement char (a genuine latin1 name like café.docx).
  const latin1Bytes = Buffer.from(name, 'latin1');
  const recovered = latin1Bytes.toString('utf8');
  if (!recovered.includes('\uFFFD')) return recovered;

  // Some legacy database/client paths normalized the mojibake character
  // U+00A0 to an ASCII space. Restore 0xA0 only when that space occupies a
  // continuation-byte slot in an otherwise valid UTF-8 byte sequence. The
  // C1-control guard keeps genuine Latin-1 names with ordinary spaces intact.
  if (!looksLikeMojibake(name)) return name;
  const repairedBytes = restoreNormalizedNbspContinuation(latin1Bytes);
  if (!repairedBytes) return name;
  const repaired = repairedBytes.toString('utf8');
  return repaired.includes('\uFFFD') ? name : repaired;
}

function restoreNormalizedNbspContinuation(bytes: Buffer): Buffer | null {
  const repaired = Buffer.from(bytes);
  let changed = false;

  for (let i = 0; i < repaired.length; ) {
    const lead = repaired[i];
    if (lead === undefined) return null;
    if (lead <= 0x7f) {
      i += 1;
      continue;
    }

    let sequenceLength = 0;
    if (lead >= 0xc2 && lead <= 0xdf) sequenceLength = 2;
    else if (lead >= 0xe0 && lead <= 0xef) sequenceLength = 3;
    else if (lead >= 0xf0 && lead <= 0xf4) sequenceLength = 4;
    else return null;

    if (i + sequenceLength > repaired.length) return null;
    for (let offset = 1; offset < sequenceLength; offset += 1) {
      const index = i + offset;
      if (repaired[index] === 0x20) {
        repaired[index] = 0xa0;
        changed = true;
      }
      const continuation = repaired[index];
      if (continuation === undefined) return null;
      if (continuation < 0x80 || continuation > 0xbf) return null;
    }

    const second = repaired[i + 1];
    if (second === undefined) return null;
    if (lead === 0xe0 && second < 0xa0) return null;
    if (lead === 0xed && second > 0x9f) return null;
    if (lead === 0xf0 && second < 0x90) return null;
    if (lead === 0xf4 && second > 0x8f) return null;
    i += sequenceLength;
  }

  return changed ? repaired : null;
}

/**
 * Build a download `Content-Disposition: attachment` header value that keeps a
 * non-ASCII (e.g. CJK) filename intact (P0 / E10). Per RFC 6266 we emit BOTH:
 *   - `filename="<ascii>"` \u2014 fallback for ancient clients; MUST be ASCII-only
 *     so a Chinese name never lands as latin1 mojibake (\u5468\u62A5 \u2192 \u00E5\u00A8\u00E6\u00A5\u2026). Non-ASCII
 *     bytes and the quote/backslash chars are replaced with '_'.
 *   - `filename*=UTF-8''<pct>` \u2014 the real UTF-8 name, percent-encoded; every
 *     modern browser prefers this and shows the correct name.
 */
export function contentDispositionAttachment(filename: string): string {
  const safe = (filename || 'download').trim() || 'download';
  // eslint-disable-next-line no-control-regex
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const star = encodeURIComponent(safe);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}

/**
 * Heuristic: does this string still look like UTF-8-as-latin1 mojibake AFTER a
 * recovery attempt? A readable filename is ASCII + real letters (incl. CJK
 * > U+00FF and accented latin like é = U+00E9). Mojibake from UTF-8 bytes read
 * as latin1 leaves C1 control codepoints (U+0080–U+009F — the continuation
 * bytes of a multi-byte char, e.g. 周 = E5 91 A8 → 'å','','¨'), which
 * NEVER appear in a legitimate filename. Replacement chars (U+FFFD) likewise
 * signal a failed decode. café (only U+00E9, not C1) is NOT flagged.
 */
export function looksLikeMojibake(s: string): boolean {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 0x80 && c <= 0x9f) || c === 0xfffd) return true;
  }
  return false;
}

export type FileClosureCategory = 'task_execution' | 'media_assets';

export interface DeleteUserFilesPageInput {
  userIdInternal: number;
  afterId?: number;
  limit: number;
  categoryId: FileClosureCategory;
}

export interface DeleteUserFilesPageResult {
  nextAfterId: number | null;
  deleted: number;
  done: boolean;
}

export interface UserFileClosureRow {
  id: number;
  userId: number;
  storagePath: string;
  mimetype: string | null;
}

export interface UserFileClosureStore {
  listOwnedPage(input: {
    userIdInternal: number;
    afterId: number;
    limit: number;
    categoryId: FileClosureCategory;
  }): Promise<UserFileClosureRow[]>;
  deleteOwnedRow(input: {
    id: number;
    userIdInternal: number;
    categoryId: FileClosureCategory;
  }): Promise<boolean>;
}

export interface DeleteUserFilesPageDependencies {
  store: UserFileClosureStore;
  storage: Pick<StorageProvider, 'delete'>;
  deleteTimeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Stable, exhaustive closure ownership rule for `task_files`. Media MIME
 * families belong to `media_assets`; null, empty, and every non-standard MIME
 * conservatively belong to `task_execution`, so no row can fall between the
 * two category handlers.
 */
export function closureFileCategoryForMimetype(
  mimetype: string | null | undefined,
): FileClosureCategory {
  const normalized = mimetype?.toLowerCase() ?? '';
  return normalized.startsWith('image/') ||
    normalized.startsWith('video/') ||
    normalized.startsWith('audio/')
    ? 'media_assets'
    : 'task_execution';
}

/**
 * Deletes at most 100 owned files in deterministic primary-key order. The
 * backing object is always deleted (or confirmed missing by the provider)
 * before the ownership-scoped row mutation. A thrown object delete leaves the
 * current row durable and prevents the caller from saving a later cursor.
 */
export async function deleteUserFilesPage(
  input: DeleteUserFilesPageInput,
  dependencies: DeleteUserFilesPageDependencies,
): Promise<DeleteUserFilesPageResult> {
  if (
    !Number.isSafeInteger(input.userIdInternal) ||
    input.userIdInternal <= 0 ||
    !Number.isSafeInteger(input.limit) ||
    input.limit <= 0 ||
    input.limit > 100 ||
    (input.afterId !== undefined && (!Number.isSafeInteger(input.afterId) || input.afterId < 0))
  ) {
    throw new Error('deleteUserFilesPage: invariant violation');
  }
  const afterId = input.afterId ?? 0;
  const selected = await dependencies.store.listOwnedPage({
    userIdInternal: input.userIdInternal,
    afterId,
    limit: input.limit + 1,
    categoryId: input.categoryId,
  });
  if (
    selected.length > input.limit + 1 ||
    selected.some(
      (row) =>
        !Number.isSafeInteger(row.id) ||
        row.id <= afterId ||
        row.userId !== input.userIdInternal ||
        closureFileCategoryForMimetype(row.mimetype) !== input.categoryId,
    )
  ) {
    throw new Error('deleteUserFilesPage: invariant violation');
  }

  const page = selected.slice(0, input.limit);
  for (const row of page) {
    await deleteStorageObjectForClosure(dependencies.storage, row.storagePath, {
      ...(dependencies.deleteTimeoutMs !== undefined
        ? { timeoutMs: dependencies.deleteTimeoutMs }
        : {}),
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
    });
    const deleted = await dependencies.store.deleteOwnedRow({
      id: row.id,
      userIdInternal: input.userIdInternal,
      categoryId: input.categoryId,
    });
    if (!deleted) throw new Error('deleteUserFilesPage: owned row changed during deletion');
  }

  const done = selected.length <= input.limit;
  return {
    nextAfterId: done ? null : (page.at(-1)?.id ?? null),
    deleted: page.length,
    done,
  };
}

export function createDbUserFileClosureStore(db: DB): UserFileClosureStore {
  return {
    async listOwnedPage(input) {
      const partition = fileClosurePartitionPredicate(input.categoryId);
      return db
        .select({
          id: taskFiles.id,
          userId: taskFiles.userId,
          storagePath: taskFiles.storagePath,
          mimetype: taskFiles.mimetype,
        })
        .from(taskFiles)
        .where(
          and(
            eq(taskFiles.userId, input.userIdInternal),
            gt(taskFiles.id, input.afterId),
            partition,
          ),
        )
        .orderBy(asc(taskFiles.id))
        .limit(input.limit);
    },
    async deleteOwnedRow(input) {
      const result = await db
        .delete(taskFiles)
        .where(
          and(
            eq(taskFiles.id, input.id),
            eq(taskFiles.userId, input.userIdInternal),
            fileClosurePartitionPredicate(input.categoryId),
          ),
        );
      const affected = readAffectedRows(result);
      if (affected > 1) throw new Error('deleteUserFilesPage: invariant violation');
      return affected === 1;
    },
  };
}

function fileClosurePartitionPredicate(categoryId: FileClosureCategory) {
  const media = or(
    like(taskFiles.mimetype, 'image/%'),
    like(taskFiles.mimetype, 'video/%'),
    like(taskFiles.mimetype, 'audio/%'),
  );
  if (categoryId === 'media_assets') return media;
  return or(
    isNull(taskFiles.mimetype),
    and(
      notLike(taskFiles.mimetype, 'image/%'),
      notLike(taskFiles.mimetype, 'video/%'),
      notLike(taskFiles.mimetype, 'audio/%'),
    ),
  );
}

export class FileService {
  /**
   * Phase 5c — disk I/O routed through a StorageProvider. When the
   * caller doesn't pass an explicit provider, we resolve the shared
   * process-wide singleton (`getSharedStorageProvider`), which
   * honours `STORAGE_PROVIDER=local|r2` env. This means a flip to
   * R2 actually plumbs through every FileService construction site
   * (Codex P5 follow-up — the previous default-LocalStorageProvider
   * branch silently overrode the env flag for every FileService
   * built outside the boot path).
   */
  private readonly storage: StorageProvider;
  constructor(
    private readonly db: DB,
    private readonly logger: Logger,
    storage?: StorageProvider,
  ) {
    this.storage = storage ?? getSharedStorageProvider({ logger });
  }

  /**
   * Persist a freshly-uploaded buffer to disk and write the index
   * row. Returns the inserted task_files row (sans buffer).
   *
   * Caller must have already validated:
   *   - User's plan allows uploads
   *   - File size is within the plan cap
   *   - mimetype is in `ACCEPTED_MIMES` (or extension whitelist)
   */
  async storeUpload(opts: {
    userIdInternal: number;
    userExternalId: string;
    filename: string;
    mimetype: string;
    buffer: Buffer;
  }): Promise<TaskFile> {
    const externalId = newExternalId('file');
    const safeFilename = sanitiseFilename(opts.filename);
    // Phase 5c — route through StorageProvider. LocalProvider writes
    // under FILES_ROOT preserving the pre-5c path layout exactly so
    // existing rows stay readable.
    const { storagePath } = await this.storage.put({
      userExternalId: opts.userExternalId,
      kind: 'input',
      fileExternalId: externalId,
      filename: safeFilename,
      buffer: opts.buffer,
      mimetype: opts.mimetype,
    });
    await this.db.insert(taskFiles).values({
      externalId,
      userId: opts.userIdInternal,
      taskId: null,
      kind: 'input',
      filename: safeFilename,
      mimetype: opts.mimetype,
      sizeBytes: opts.buffer.length,
      storagePath,
    });
    const [row] = await this.db
      .select()
      .from(taskFiles)
      .where(eq(taskFiles.externalId, externalId))
      .limit(1);
    if (!row) throw new Error('storeUpload: row vanished after insert');
    this.logger.info(
      {
        fileId: externalId,
        userId: opts.userExternalId,
        size: opts.buffer.length,
        mimetype: opts.mimetype,
      },
      'file: stored upload',
    );
    return row;
  }

  /**
   * Phase 1 (video) — begin a direct-to-R2 presigned PUT upload, so a
   * large file (≤200MB base video) never streams through the
   * orchestrator / multer memoryStorage. Writes a `status='pending'`
   * task_files row (sizeBytes = client-DECLARED, provisional) and
   * returns the presigned PUT URL the browser uploads to directly. The
   * route layer has already validated mime + declared size against the
   * caller's plan; the REAL size is verified in `confirmUpload` via a
   * HEAD once the bytes land.
   *
   * Returns null when the provider can't presign (local dev) — the
   * caller falls back to the multipart `/files/upload` path.
   */
  async createPendingUpload(opts: {
    userIdInternal: number;
    userExternalId: string;
    filename: string;
    mimetype: string;
    declaredSize: number;
  }): Promise<{ fileId: string; uploadUrl: string; storagePath: string } | null> {
    const externalId = newExternalId('file');
    const safeFilename = sanitiseFilename(opts.filename);
    const signed = await this.storage.getSignedPutUrl({
      userExternalId: opts.userExternalId,
      kind: 'input',
      fileExternalId: externalId,
      filename: safeFilename,
      contentType: opts.mimetype,
    });
    if (!signed) return null;
    await this.db.insert(taskFiles).values({
      externalId,
      userId: opts.userIdInternal,
      taskId: null,
      kind: 'input',
      filename: safeFilename,
      mimetype: opts.mimetype,
      sizeBytes: opts.declaredSize,
      storagePath: signed.storagePath,
      status: 'pending',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    this.logger.info(
      {
        fileId: externalId,
        userId: opts.userExternalId,
        mimetype: opts.mimetype,
        declaredSize: opts.declaredSize,
      },
      'file: pending presigned upload created',
    );
    return { fileId: externalId, uploadUrl: signed.url, storagePath: signed.storagePath };
  }

  /**
   * Phase 1 (video) — finalize a presigned-PUT upload. Verifies the
   * object actually landed (HEAD), reads its REAL size (the client's
   * declared size is untrusted), enforces the per-plan cap, and flips
   * the row to status='active'. On oversize it deletes both the object
   * and the pending row so a cap-buster can't leave a 200MB+ orphan in
   * the bucket. Returns the finalized row or a typed failure the route
   * maps to a 4xx.
   */
  async confirmUpload(opts: {
    userIdInternal: number;
    fileExternalId: string;
    plan: PlanId;
  }): Promise<
    | { ok: true; row: TaskFile }
    | { ok: false; reason: 'not_found' | 'not_uploaded' | 'too_large'; sizeBytes?: number }
  > {
    const [row] = await this.db
      .select()
      .from(taskFiles)
      .where(eq(taskFiles.externalId, opts.fileExternalId))
      .limit(1);
    if (!row || row.userId !== opts.userIdInternal) return { ok: false, reason: 'not_found' };
    const meta = await this.storage.stat(row.storagePath);
    if (!meta) return { ok: false, reason: 'not_uploaded' };
    // Cap is derived from the STORED mime/filename (what actually landed),
    // not anything the client re-sends at confirm time.
    const cap = uploadByteLimit(
      classifyUpload(row.filename, row.mimetype) ?? 'document',
      opts.plan,
    );
    if (meta.sizeBytes > cap) {
      await this.storage.delete(row.storagePath);
      await this.db.delete(taskFiles).where(eq(taskFiles.externalId, opts.fileExternalId));
      return { ok: false, reason: 'too_large', sizeBytes: meta.sizeBytes };
    }
    await this.db
      .update(taskFiles)
      .set({ status: 'active', sizeBytes: meta.sizeBytes })
      .where(eq(taskFiles.externalId, opts.fileExternalId));
    const [updated] = await this.db
      .select()
      .from(taskFiles)
      .where(eq(taskFiles.externalId, opts.fileExternalId))
      .limit(1);
    if (!updated) return { ok: false, reason: 'not_found' };
    this.logger.info(
      { fileId: opts.fileExternalId, sizeBytes: meta.sizeBytes },
      'file: presigned upload confirmed',
    );
    return { ok: true, row: updated };
  }

  /**
   * Persist an agent-generated buffer. Same shape as storeUpload but
   * tagged kind='output' and given a configurable TTL via expires_at
   * (`OUTPUT_FILE_TTL_DAYS`, default 30d — see outputFileTtlMs). Always
   * scoped to a specific task — outputs only exist as a result of
   * tool calls inside a running task.
   */
  async storeOutput(opts: {
    userIdInternal: number;
    userExternalId: string;
    taskIdInternal: number;
    filename: string;
    mimetype: string;
    buffer: Buffer;
  }): Promise<TaskFile> {
    const externalId = newExternalId('file');
    const safeFilename = sanitiseFilename(opts.filename);
    const { storagePath } = await this.storage.put({
      userExternalId: opts.userExternalId,
      kind: 'output',
      fileExternalId: externalId,
      filename: safeFilename,
      buffer: opts.buffer,
      mimetype: opts.mimetype,
    });
    const expiresAt = new Date(Date.now() + outputFileTtlMs());
    await this.db.insert(taskFiles).values({
      externalId,
      userId: opts.userIdInternal,
      taskId: opts.taskIdInternal,
      kind: 'output',
      filename: safeFilename,
      mimetype: opts.mimetype,
      sizeBytes: opts.buffer.length,
      storagePath,
      expiresAt,
    });
    const [row] = await this.db
      .select()
      .from(taskFiles)
      .where(eq(taskFiles.externalId, externalId))
      .limit(1);
    if (!row) throw new Error('storeOutput: row vanished after insert');
    return row;
  }

  /**
   * Persist a generated artifact from a local file path. Video lanes use this
   * path so multi-hundred-megabyte MP4s are copied/streamed to storage instead
   * of being read into the Orchestrator heap.
   */
  async storeOutputFile(opts: {
    userIdInternal: number;
    userExternalId: string;
    taskIdInternal: number;
    filename: string;
    mimetype: string;
    sourcePath: string;
  }): Promise<TaskFile> {
    const externalId = newExternalId('file');
    const safeFilename = sanitiseFilename(opts.filename);
    const meta = await fs.stat(opts.sourcePath);
    if (!meta.isFile()) throw new Error('storeOutputFile: source is not a regular file');
    if (meta.size > 0xffff_ffff) {
      throw new Error('storeOutputFile: artifact exceeds task_files size limit');
    }
    const { storagePath } = await this.storage.putFile({
      userExternalId: opts.userExternalId,
      kind: 'output',
      fileExternalId: externalId,
      filename: safeFilename,
      sourcePath: opts.sourcePath,
      sizeBytes: meta.size,
      mimetype: opts.mimetype,
    });
    const expiresAt = new Date(Date.now() + outputFileTtlMs());
    try {
      await this.db.insert(taskFiles).values({
        externalId,
        userId: opts.userIdInternal,
        taskId: opts.taskIdInternal,
        kind: 'output',
        filename: safeFilename,
        mimetype: opts.mimetype,
        sizeBytes: meta.size,
        storagePath,
        expiresAt,
      });
      const [row] = await this.db
        .select()
        .from(taskFiles)
        .where(eq(taskFiles.externalId, externalId))
        .limit(1);
      if (!row) throw new Error('storeOutputFile: row vanished after insert');
      return row;
    } catch (err) {
      try {
        await this.storage.delete(storagePath);
      } catch (cleanupErr) {
        this.logger.error(
          { cleanupErr, storagePath, fileId: externalId },
          'file: failed to compensate streamed output after DB failure',
        );
      }
      throw err;
    }
  }

  /**
   * Persist a provider-handoff artifact that must never appear as a user
   * deliverable. The storage object uses the ordinary output namespace, while
   * the DB row is kind='temp' so result/file listings exclude it. A short TTL
   * lets the hourly cleanup job recover objects left behind by a process crash;
   * normal callers still delete the row immediately after provider ingestion.
   */
  async storeTemporaryOutput(opts: {
    userIdInternal: number;
    userExternalId: string;
    taskIdInternal: number;
    filename: string;
    mimetype: string;
    buffer: Buffer;
  }): Promise<TaskFile> {
    const externalId = newExternalId('file');
    const safeFilename = sanitiseFilename(opts.filename);
    const storageInput = {
      userExternalId: opts.userExternalId,
      kind: 'output',
      fileExternalId: externalId,
      filename: safeFilename,
    } as const;
    const storagePath = this.storage.pathFor(storageInput);
    const expiresAt = new Date(Date.now() + TEMPORARY_OUTPUT_TTL_MS);
    // Reserve the exact storage path before uploading. If the process dies
    // anywhere after this insert, cleanup-cron can still remove the object (or
    // harmlessly confirm it never landed) after the short TTL.
    await this.db.insert(taskFiles).values({
      externalId,
      userId: opts.userIdInternal,
      taskId: opts.taskIdInternal,
      kind: 'temp',
      filename: safeFilename,
      mimetype: opts.mimetype,
      sizeBytes: opts.buffer.length,
      storagePath,
      status: 'pending',
      expiresAt,
    });
    const stored = await this.storage.put({
      ...storageInput,
      buffer: opts.buffer,
      mimetype: opts.mimetype,
    });
    if (stored.storagePath !== storagePath) {
      await this.storage.delete(stored.storagePath);
      throw new Error('storeTemporaryOutput: storage provider path mismatch');
    }
    await this.db
      .update(taskFiles)
      .set({ status: 'active' })
      .where(eq(taskFiles.externalId, externalId));
    const [row] = await this.db
      .select()
      .from(taskFiles)
      .where(eq(taskFiles.externalId, externalId))
      .limit(1);
    if (!row) throw new Error('storeTemporaryOutput: row vanished after upload');
    return row;
  }

  /**
   * Stream a provider-handoff artifact from disk while preserving the same
   * hidden-row and crash-recovery semantics as storeTemporaryOutput.
   */
  async storeTemporaryOutputFile(opts: {
    userIdInternal: number;
    userExternalId: string;
    taskIdInternal: number;
    filename: string;
    mimetype: string;
    sourcePath: string;
  }): Promise<TaskFile> {
    const meta = await fs.stat(opts.sourcePath);
    const externalId = newExternalId('file');
    const safeFilename = sanitiseFilename(opts.filename);
    const storageInput = {
      userExternalId: opts.userExternalId,
      kind: 'output',
      fileExternalId: externalId,
      filename: safeFilename,
    } as const;
    const storagePath = this.storage.pathFor(storageInput);
    const expiresAt = new Date(Date.now() + TEMPORARY_OUTPUT_TTL_MS);
    await this.db.insert(taskFiles).values({
      externalId,
      userId: opts.userIdInternal,
      taskId: opts.taskIdInternal,
      kind: 'temp',
      filename: safeFilename,
      mimetype: opts.mimetype,
      sizeBytes: meta.size,
      storagePath,
      status: 'pending',
      expiresAt,
    });
    const stored = await this.storage.putFile({
      ...storageInput,
      sourcePath: opts.sourcePath,
      sizeBytes: meta.size,
      mimetype: opts.mimetype,
    });
    if (stored.storagePath !== storagePath) {
      await this.storage.delete(stored.storagePath);
      throw new Error('storeTemporaryOutputFile: storage provider path mismatch');
    }
    await this.db
      .update(taskFiles)
      .set({ status: 'active' })
      .where(eq(taskFiles.externalId, externalId));
    const [row] = await this.db
      .select()
      .from(taskFiles)
      .where(eq(taskFiles.externalId, externalId))
      .limit(1);
    if (!row) throw new Error('storeTemporaryOutputFile: row vanished after upload');
    return row;
  }

  /**
   * Check whether an uploaded file is still a real, readable object for this
   * user. A non-null DB id alone is not readiness: cleanup may already have
   * expired the row or removed the backing object.
   */
  async isReadableForUser(fileExternalId: string, userIdInternal: number): Promise<boolean> {
    return (await this.readableRowForUser(fileExternalId, userIdInternal)) !== null;
  }

  /**
   * Promote a readable input to a durable user asset. Ordinary direct media
   * uploads retain their 24h cleanup window; onboarding calls this only after
   * the user designates a file as their reusable IP-video base.
   */
  async retainInputForUser(fileExternalId: string, userIdInternal: number): Promise<boolean> {
    const row = await this.readableRowForUser(fileExternalId, userIdInternal);
    if (!row || row.kind !== 'input') return false;
    if (row.expiresAt) {
      await this.db
        .update(taskFiles)
        .set({ expiresAt: null })
        .where(
          and(
            eq(taskFiles.externalId, fileExternalId),
            eq(taskFiles.userId, userIdInternal),
            eq(taskFiles.status, 'active'),
          ),
        );
    }
    return true;
  }

  /**
   * Mint a short-lived public GET URL for an uploaded file (ownership,
   * active status, expiry and backing-object existence checked). Phase 2
   * 第二期: the pet i2v lane needs a PUBLIC img_url
   * the DashScope model can fetch — R2 presigned GET does that. Returns
   * null when missing / not-owned / expired, or when the provider can't
   * sign (LocalStorageProvider → no signed url in dev). `userIdInternal`
   * is the internal bigint id (resolved at the route/caller layer).
   */
  async signedReadUrl(
    fileExternalId: string,
    userIdInternal: number,
    expiresInSeconds = 3600,
  ): Promise<string | null> {
    const row = await this.readableRowForUser(fileExternalId, userIdInternal);
    if (!row) return null;
    return this.storage.getSignedUrl(row.storagePath, { expiresInSeconds });
  }

  private async readableRowForUser(
    fileExternalId: string,
    userIdInternal: number,
  ): Promise<TaskFile | null> {
    const [row] = await this.db
      .select()
      .from(taskFiles)
      .where(eq(taskFiles.externalId, fileExternalId))
      .limit(1);
    if (!row || row.userId !== userIdInternal) return null;
    if (row.status !== 'active') return null;
    if (row.expiresAt && row.expiresAt < new Date()) return null;
    const meta = await this.storage.stat(row.storagePath);
    return meta ? row : null;
  }

  /**
   * Delete a file (R2 object + task_files row) for the caller. Ownership-
   * checked. Used by the video onboarding flow: 样本即弃 (delete the voice
   * sample right after enrollment mints the voice_id) + base-video removal
   * when the user clears their IP assets. Returns false when missing /
   * not-owned (idempotent-friendly). The DB row is retained when storage
   * deletion fails so cleanup-cron can retry instead of losing the only
   * durable reference to a sensitive temporary object.
   */
  async deleteForUser(fileExternalId: string, userIdInternal: number): Promise<boolean> {
    const [row] = await this.db
      .select()
      .from(taskFiles)
      .where(eq(taskFiles.externalId, fileExternalId))
      .limit(1);
    if (!row || row.userId !== userIdInternal) return false;
    await this.storage.delete(row.storagePath);
    await this.db.delete(taskFiles).where(eq(taskFiles.externalId, fileExternalId));
    return true;
  }

  /**
   * Load a file by external id, verifying it belongs to the caller.
   * Returns null when the file is missing OR owned by a different
   * user — both are 404s on the API surface (don't leak existence).
   */
  async loadForUser(
    fileExternalId: string,
    userIdInternal: number,
  ): Promise<{ row: TaskFile; buffer: Buffer } | null> {
    const [row] = await this.db
      .select()
      .from(taskFiles)
      .where(eq(taskFiles.externalId, fileExternalId))
      .limit(1);
    if (!row) return null;
    if (row.userId !== userIdInternal) return null;
    if (row.status !== 'active') return null;
    if (row.expiresAt && row.expiresAt < new Date()) return null;
    const buffer = await this.storage.get(row.storagePath);
    if (!buffer) return null;
    return { row, buffer };
  }

  /**
   * Bulk-fetch the buffers + metadata for a set of file ids. Used
   * by the agent-loop to build the multi-modal user message. Skips
   * files that fail ownership or expiry checks (logged but not
   * surfaced — the agent should not crash because one file
   * disappeared between the upload and the task starting).
   */
  async loadMany(
    fileExternalIds: readonly string[],
    userIdInternal: number,
  ): Promise<Array<{ row: TaskFile; buffer: Buffer }>> {
    const out: Array<{ row: TaskFile; buffer: Buffer }> = [];
    for (const id of fileExternalIds) {
      const [row] = await this.db
        .select()
        .from(taskFiles)
        .where(eq(taskFiles.externalId, id))
        .limit(1);
      if (!row) continue;
      if (row.userId !== userIdInternal) continue;
      if (row.status !== 'active') continue;
      if (row.expiresAt && row.expiresAt < new Date()) continue;
      const buffer = await this.storage.get(row.storagePath);
      if (buffer) {
        out.push({ row, buffer });
      } else {
        this.logger.warn({ fileId: id }, 'file: load skipped (storage read returned null)');
      }
    }
    return out;
  }

  /**
   * Backfill `task_id` on a set of input files. Called from
   * tasks.create after the task row lands so `/files/by-task/:id`
   * (future endpoint) can list a task's attachments.
   */
  async linkToTask(
    fileExternalIds: readonly string[],
    taskIdInternal: number,
    userIdInternal: number,
  ): Promise<void> {
    for (const id of fileExternalIds) {
      await this.db
        .update(taskFiles)
        .set({ taskId: taskIdInternal })
        .where(
          and(
            eq(taskFiles.externalId, id),
            eq(taskFiles.userId, userIdInternal),
            eq(taskFiles.status, 'active'),
          ),
        );
    }
  }

  /**
   * List a task's files (both kinds). Used by the SPA to render the
   * download cards on completed tasks.
   */
  async listForTask(taskIdInternal: number): Promise<TaskFile[]> {
    return this.db.select().from(taskFiles).where(eq(taskFiles.taskId, taskIdInternal));
  }
}

/**
 * Map a file's internal task id (bigint) → external task id (the
 * one the SPA / API surface uses). Helper for routes that take the
 * external id and need to operate against the db row.
 */
export async function taskInternalIdFor(db: DB, taskExternalId: string): Promise<number | null> {
  const [row] = await db
    .select({ id: tasks.id, userId: tasks.userId })
    .from(tasks)
    .where(eq(tasks.externalId, taskExternalId))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Strip path separators + restrict length so a malicious filename
 * can't escape the per-file directory. Also removes leading dots so
 * we don't end up with hidden files.
 */
function sanitiseFilename(name: string): string {
  const stripped = name
    .replace(/[/\\\0]/g, '_')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const truncated = stripped.length > 200 ? stripped.slice(0, 200) : stripped;
  return truncated || `file-${randomUUID().slice(0, 8)}`;
}
