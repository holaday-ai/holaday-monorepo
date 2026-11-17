import {
  BROWSER_UPLOAD_CHUNK_BYTES,
  BROWSER_UPLOAD_IDLE_MS,
  BROWSER_UPLOAD_LIFETIME_MS,
  type BrowserUploadChunk,
  type BrowserUploadManifest,
  type BrowserUploadOutcome,
  type BrowserUploadTransferReceipt,
  browserUploadChunkSchema,
  browserUploadManifestSchema,
  browserUploadOutcomeSchema,
} from '@holaday/shared-types';

type StagedFile = { metadata: BrowserUploadManifest[number]; bytes: Uint8Array; received: number };
interface Staging {
  id: string;
  createdAt: number;
  touchedAt: number;
  files: StagedFile[];
  pending: Promise<BrowserUploadTransferReceipt> | null;
  deliveryStarted: boolean;
  expiry?: ReturnType<typeof setTimeout>;
}
export type VerifiedTaskFile = Readonly<BrowserUploadManifest[number] & { bytes: Uint8Array }>;

/** One owned browser session's bounded byte staging. The existing session and
 * real-target binding must authorize `deliver`; this store grants neither. */
export class TaskFileTransfer {
  private staging: Staging | null = null;
  private readonly receipts = new Map<string, BrowserUploadTransferReceipt>();
  private closed = false;
  private uncertain = false;
  constructor(
    private readonly options: {
      active: () => boolean;
      deliver: (files: readonly VerifiedTaskFile[]) => Promise<BrowserUploadOutcome>;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
  private assertActive(): void {
    try {
      if (!this.closed && this.options.active()) return;
    } catch {
      /* unavailable */
    }
    throw new Error('scope_unavailable');
  }
  private release(stage: Staging): void {
    clearTimeout(stage.expiry);
    for (const file of stage.files) file.bytes.fill(0);
    if (this.staging === stage) this.staging = null;
  }
  private scheduleExpiry(stage: Staging): void {
    clearTimeout(stage.expiry);
    const delay =
      Math.min(
        stage.touchedAt + BROWSER_UPLOAD_IDLE_MS,
        stage.createdAt + BROWSER_UPLOAD_LIFETIME_MS,
      ) - this.now();
    stage.expiry = setTimeout(
      () => {
        if (this.staging !== stage || stage.deliveryStarted) return;
        this.expire();
        if (this.staging === stage) this.scheduleExpiry(stage);
      },
      Math.max(1, delay + 1),
    );
    // A browser worker uses numeric timers; local Node checks must not be held
    // open solely by an otherwise idle staging object.
    if (typeof stage.expiry === 'object') stage.expiry.unref?.();
  }
  private expire(): void {
    const stage = this.staging;
    if (
      stage &&
      !stage.deliveryStarted &&
      (this.now() - stage.touchedAt > BROWSER_UPLOAD_IDLE_MS ||
        this.now() - stage.createdAt > BROWSER_UPLOAD_LIFETIME_MS)
    )
      this.release(stage);
  }
  private current(id: string): Staging {
    this.assertActive();
    this.expire();
    const stage = this.staging;
    if (!stage || stage.id !== id) throw new Error('transfer_unavailable');
    return stage;
  }
  begin(input: unknown): { transferId: string } {
    this.assertActive();
    this.expire();
    if (this.uncertain) throw new Error('upload_outcome_unknown');
    if (this.staging) throw new Error('transfer_busy');
    const parsed = browserUploadManifestSchema.safeParse(input);
    if (!parsed.success) throw new Error('invalid_manifest');
    const id = crypto.randomUUID();
    const now = this.now();
    this.staging = {
      id,
      createdAt: now,
      touchedAt: now,
      files: parsed.data.map((metadata) => ({
        metadata,
        bytes: new Uint8Array(metadata.sizeBytes),
        received: 0,
      })),
      pending: null,
      deliveryStarted: false,
    };
    this.scheduleExpiry(this.staging);
    return { transferId: id };
  }
  append(input: BrowserUploadChunk): { transferId: string; fileIndex: number; nextOffset: number } {
    const parsed = browserUploadChunkSchema.safeParse(input);
    if (!parsed.success) throw new Error('invalid_chunk');
    const { transferId, fileIndex, offset, data } = parsed.data;
    const stage = this.current(transferId);
    if (stage.pending) throw new Error('transfer_busy');
    const file = stage.files[fileIndex];
    if (!file) throw new Error('invalid_chunk');
    let decoded: string;
    try {
      decoded = atob(data);
    } catch {
      throw new Error('invalid_chunk');
    }
    if (decoded.length > BROWSER_UPLOAD_CHUNK_BYTES || btoa(decoded) !== data)
      throw new Error('invalid_chunk');
    if (
      offset > file.received ||
      offset + decoded.length > file.bytes.length ||
      (offset < file.received && offset + decoded.length > file.received)
    )
      throw new Error('offset_mismatch');
    for (let i = 0; i < decoded.length; i++) {
      const value = decoded.charCodeAt(i);
      if (offset < file.received && file.bytes[offset + i] !== value)
        throw new Error('chunk_mismatch');
    }
    if (offset === file.received) {
      for (let i = 0; i < decoded.length; i++) file.bytes[offset + i] = decoded.charCodeAt(i);
      file.received += decoded.length;
    }
    stage.touchedAt = this.now();
    this.scheduleExpiry(stage);
    return { transferId, fileIndex, nextOffset: file.received };
  }
  async commit(id: string): Promise<BrowserUploadTransferReceipt> {
    this.assertActive();
    const receipt = this.receipts.get(id);
    if (receipt) return structuredClone(receipt);
    const stage = this.current(id);
    stage.pending ??= this.finish(stage);
    try {
      return structuredClone(await stage.pending);
    } finally {
      if (this.staging === stage) stage.pending = null;
    }
  }
  private async finish(stage: Staging): Promise<BrowserUploadTransferReceipt> {
    if (stage.files.some((file) => file.received !== file.bytes.length))
      throw new Error('file_incomplete');
    try {
      for (const file of stage.files) {
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', file.bytes));
        this.assertActive();
        if (this.current(stage.id) !== stage) throw new Error('transfer_unavailable');
        const hash = Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
        if (hash !== file.metadata.sha256) {
          throw new Error('file_hash_mismatch');
        }
      }
    } catch (error) {
      this.release(stage);
      throw error;
    }
    this.assertActive();
    stage.deliveryStarted = true;
    clearTimeout(stage.expiry);
    let outcome: BrowserUploadOutcome;
    try {
      const result = browserUploadOutcomeSchema.safeParse(
        await this.options.deliver(
          stage.files.map((file) => ({ ...file.metadata, bytes: file.bytes })),
        ),
      );
      outcome = result.success
        ? result.data
        : { status: 'unknown', reason: 'invalid_delivery_receipt' };
    } catch {
      outcome = { status: 'unknown', reason: 'delivery_outcome_unknown' };
    }
    try {
      this.assertActive();
    } catch {
      outcome = { status: 'unknown', reason: 'scope_unavailable' };
    }
    const receipt: BrowserUploadTransferReceipt = {
      ...outcome,
      transferId: stage.id,
      files: stage.files.map((file) => ({ ...file.metadata })),
    };
    if (receipt.status === 'unknown') this.uncertain = true;
    this.receipts.set(stage.id, receipt);
    while (this.receipts.size > 8) this.receipts.delete(this.receipts.keys().next().value!);
    this.release(stage);
    return receipt;
  }
  abort(id: string): boolean {
    const stage = this.current(id);
    if (stage.deliveryStarted) return false;
    this.release(stage);
    return true;
  }
  dispose(): void {
    this.closed = true;
    if (this.staging && !this.staging.deliveryStarted) this.release(this.staging);
    this.receipts.clear();
  }
}
