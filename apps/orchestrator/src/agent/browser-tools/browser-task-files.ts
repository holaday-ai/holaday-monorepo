import { createHash } from 'node:crypto';
import type { FileService } from '../../files/file-service.js';
import { taskBrowserDownloadSource } from './browser-download.js';
import type { BrowserUploadFile } from './browser-upload-target.js';
import type { BrowserDownloadReceipt } from './playwright-unified-executor.js';

type LoadedFile = Awaited<ReturnType<FileService['loadMany']>>[number];
interface Reference {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}
const VALIDATED = Symbol('server-validated-task-file');
export interface ValidatedBrowserTaskFile extends Reference {
  readonly [VALIDATED]: true;
  readonly userId: number;
  readonly expiresAt: number | null;
}
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

/** A run's admitted user materials, not a grant over all of the account's files. */
export class BrowserTaskFiles {
  private readonly inputs = new Map<string, Reference>();
  private readonly downloadSources = new Map<
    string,
    Readonly<{
      kind: 'browser_download';
      origin: string;
      originBasis: 'download_url' | 'owning_page';
    }>
  >();
  constructor(
    private readonly options: {
      taskId: string;
      userId: number;
      files: Pick<FileService, 'loadMany'>;
      active: () => Promise<boolean>;
    },
  ) {}
  get taskId(): string {
    return this.options.taskId;
  }
  isActive(): Promise<boolean> {
    return this.options.active();
  }
  references() {
    return [...this.inputs.values()].map(({ sha256: _hash, ...reference }) => reference);
  }
  source(
    fileId: string,
  ): Readonly<
    | { kind: 'browser_download'; origin: string; originBasis: 'download_url' | 'owning_page' }
    | { kind: 'user_attachment' }
  > {
    return this.downloadSources.get(fileId) ?? { kind: 'user_attachment' };
  }
  /** Called only with the original host receipt of a saved download from this run. */
  async admitDownloaded(receipt: BrowserDownloadReceipt): Promise<void> {
    const source = taskBrowserDownloadSource(receipt, this.options.taskId);
    if (!source || !(await this.options.active()))
      throw new Error('下载不属于当前任务的可用材料。');
    const loaded = await this.options.files.loadMany([receipt.fileId], this.options.userId);
    const file = loaded.find((item) => item.row.externalId === receipt.fileId);
    if (
      !file ||
      file.row.kind !== 'output' ||
      file.row.filename !== receipt.filename ||
      file.buffer.length !== receipt.sizeBytes ||
      hash(file.buffer) !== receipt.sha256 ||
      file.row.mimetype !== receipt.mimetype ||
      file.row.expiresAt?.toISOString() !== receipt.expiresAt
    )
      throw new Error('下载保存回执与实际文件不一致。');
    const refs = BrowserTaskFiles.validatedReferences([file], this.options.userId);
    if (!(await this.options.active())) throw new Error('任务或账号已不可用。');
    this.admitReferences(refs);
    this.downloadSources.set(
      receipt.fileId,
      Object.freeze({
        kind: 'browser_download',
        origin: source.origin,
        originBasis: source.originBasis,
      }),
    );
  }
  /** Only server-validated FileService results enter here, including a later user reply. */
  admitValidated(files: readonly LoadedFile[]): void {
    this.admitReferences(BrowserTaskFiles.validatedReferences(files, this.options.userId));
  }
  static validatedReferences(
    files: readonly LoadedFile[],
    userId: number,
  ): ValidatedBrowserTaskFile[] {
    return files.map(({ row, buffer }) => {
      if (
        row.userId !== userId ||
        row.status !== 'active' ||
        row.kind === 'temp' ||
        (row.expiresAt && row.expiresAt <= new Date()) ||
        row.sizeBytes !== buffer.length
      )
        throw new Error('附件不属于当前任务的可用材料。');
      return Object.freeze({
        [VALIDATED]: true as const,
        userId,
        fileId: row.externalId,
        name: row.filename,
        mimeType: row.mimetype,
        sizeBytes: buffer.length,
        sha256: hash(buffer),
        expiresAt: row.expiresAt?.getTime() ?? null,
      });
    });
  }
  admitReferences(files: readonly ValidatedBrowserTaskFile[]): void {
    for (const reference of this.checkedReferences(files))
      this.inputs.set(reference.fileId, reference);
  }
  /** A reply preflight validates authority without changing the task's materials. */
  validateReferences(files: readonly ValidatedBrowserTaskFile[]): void {
    this.checkedReferences(files);
  }
  private checkedReferences(files: readonly ValidatedBrowserTaskFile[]): Reference[] {
    const references: Reference[] = [];
    for (const file of files) {
      if (
        file[VALIDATED] !== true ||
        file.userId !== this.options.userId ||
        (file.expiresAt !== null && file.expiresAt <= Date.now())
      )
        throw new Error('附件不属于当前任务的可用材料。');
      const reference: Reference = {
        fileId: file.fileId,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
      };
      const prior = this.inputs.get(reference.fileId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(reference))
        throw new Error('已选附件内容发生变化，请重新提交材料。');
      references.push(reference);
    }
    return references;
  }
  async resolve(taskId: string, ids: readonly string[]): Promise<BrowserUploadFile[]> {
    if (
      taskId !== this.options.taskId ||
      !ids.length ||
      ids.length > 5 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !this.inputs.has(id))
    )
      throw new Error('附件不在当前任务明确提供的材料范围内。');
    if (!(await this.options.active())) throw new Error('任务或账号已不可用。');
    const loaded = await this.options.files.loadMany(ids, this.options.userId);
    const result: BrowserUploadFile[] = [];
    for (const id of ids) {
      const file = loaded.find((file) => file.row.externalId === id);
      const original = this.inputs.get(id)!;
      if (
        !file ||
        file.row.userId !== this.options.userId ||
        file.row.kind === 'temp' ||
        file.row.filename !== original.name ||
        file.row.mimetype !== original.mimeType ||
        file.buffer.length !== original.sizeBytes ||
        hash(file.buffer) !== original.sha256
      )
        throw new Error('附件已失效或内容已变化，请重新提供。');
      result.push({
        fileId: id,
        name: original.name,
        mimeType: original.mimeType,
        buffer: file.buffer,
      });
    }
    if (!(await this.options.active())) throw new Error('任务或账号已不可用。');
    return result;
  }
}
