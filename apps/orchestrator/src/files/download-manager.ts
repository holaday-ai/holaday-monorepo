/**
 * Phase 3 R3 — DownloadManager.
 *
 * Thin wrapper around `FileService.storeOutput`. The underlying
 * storage / retrieval / 24h TTL / cleanup-cron / ownership-checked
 * download endpoint already exist (Phase 10 Tier 3, see
 * `file-service.ts` + `http.ts:GET /files/:id/download`). This
 * module:
 *
 *   - Enforces the Phase 3 R3 50 MB per-file ceiling for agent-
 *     generated downloads (screenshots / PDFs / etc.). The general
 *     output path doesn't cap individual file size — agents could
 *     accidentally produce huge files (gigantic screenshot of a
 *     full-page render) and fill the disk.
 *   - Returns a normalised `{ fileId, downloadUrl, expiresAt,
 *     filename, mimetype, sizeBytes }` so callers (agent-loop's
 *     `save_pdf` tool, the post-terminal screenshot hook) don't
 *     have to build the URL themselves.
 *   - Accepts Buffer OR base64 string transparently (the agent's
 *     screenshot helper returns base64; the PDF tool returns
 *     Buffer).
 *
 * Security:
 *   - Ownership is enforced at the download endpoint (`/files/:id/
 *     download`) via JWT userId match + DB taskFiles.userId match.
 *     This layer just produces the URL; the GET handler verifies
 *     access on request.
 *   - 24h expiry is enforced at the same endpoint (expires_at <
 *     NOW → 404) and on disk by cleanup-cron.ts.
 *   - The signed-URL semantics the spec asked for are implemented
 *     via the user's session JWT (no separate signing key) — the
 *     URL is unguessable (file-external-id is random 32-char
 *     nano-id) AND auth-gated, so an attacker would need both the
 *     URL AND a valid session for the owning user.
 */
import type { FileService } from './file-service.js';

/** Per-file ceiling for agent-generated downloads. */
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

export interface DownloadResult {
  /** External (nano-id) file id; the URL parameter on /files/:id/download. */
  fileId: string;
  /**
   * URL to GET the file. When `publicBaseUrl` was configured, this
   * is absolute (e.g. https://holaday.ai/files/file_xyz/download);
   * otherwise it's a root-relative path the consumer can resolve
   * against its own base. The SPA's API client already does that.
   */
  downloadUrl: string;
  /** Absolute expiry (24h from save). */
  expiresAt: Date;
  /** Sanitised filename as persisted on disk + in the response. */
  filename: string;
  mimetype: string;
  sizeBytes: number;
}

export interface DownloadSaveOpts {
  userIdInternal: number;
  userExternalId: string;
  taskIdInternal: number;
  content: Buffer | string;
  /** Treated as base64 when content is a string. */
  contentEncoding?: 'base64';
  filename: string;
  mimetype: string;
}

export class DownloadManager {
  constructor(
    private readonly fileService: FileService,
    /**
     * Public base URL of the orchestrator (e.g. https://holaday.ai
     * or http://localhost:4001). When empty, downloadUrl is
     * root-relative (`/files/<id>/download`); consumers prepend
     * their own base. The Vultr deploy ships this as the
     * customer-facing https URL so links in agent summaries are
     * clickable in chat outside the SPA.
     */
    private readonly publicBaseUrl: string = '',
  ) {}

  async save(opts: DownloadSaveOpts): Promise<DownloadResult> {
    const buffer = toBuffer(opts.content, opts.contentEncoding);
    if (buffer.length === 0) {
      throw new Error('download_manager: refusing to save empty content');
    }
    if (buffer.length > MAX_DOWNLOAD_BYTES) {
      throw new Error(
        `download_manager: file too large (${buffer.length} bytes > ${MAX_DOWNLOAD_BYTES} cap)`,
      );
    }
    const row = await this.fileService.storeOutput({
      userIdInternal: opts.userIdInternal,
      userExternalId: opts.userExternalId,
      taskIdInternal: opts.taskIdInternal,
      filename: opts.filename,
      mimetype: opts.mimetype,
      buffer,
    });
    // `storeOutput` always stamps a 24h expiresAt; the type permits
    // null because input files have no TTL. Coerce + assert for the
    // public contract.
    if (!row.expiresAt) {
      throw new Error('download_manager: storeOutput returned row without expiresAt');
    }
    return {
      fileId: row.externalId,
      downloadUrl: buildDownloadUrl(this.publicBaseUrl, row.externalId),
      expiresAt: row.expiresAt,
      filename: row.filename,
      mimetype: row.mimetype,
      sizeBytes: Number(row.sizeBytes),
    };
  }
}

/**
 * Compose the download URL. Trims trailing slashes off the base so
 * we don't end up with `https://x//files/...`. Pure / exported for
 * test reuse.
 */
export function buildDownloadUrl(baseUrl: string, fileId: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed}/files/${fileId}/download`;
}

function toBuffer(
  content: Buffer | string,
  encoding: 'base64' | undefined,
): Buffer {
  if (Buffer.isBuffer(content)) return content;
  // Default string encoding is base64 — the agent's screenshot
  // helper produces base64, and that's the most common shape we'll
  // hand-off through here. Callers that have utf8 text payloads
  // can wrap themselves: `Buffer.from(s, 'utf8')`.
  return Buffer.from(content, encoding ?? 'base64');
}
