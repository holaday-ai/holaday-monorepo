import { createHash } from 'node:crypto';
import {
  type ResilientSelector,
  type SelectedChromeUploadAction,
  type UserBrowserTargetDescription,
  selectedChromeUploadActionSchema,
} from '@holaday/shared-types';
import type { BrowserTaskFiles } from '../browser-tools/browser-task-files.js';
import type { PreparedUploadForGate } from '../browser-tools/browser-upload-gate.js';
import type { SelectedChromeClient, SelectedChromeClientReply } from './selected-chrome-client.js';

type Options = {
  taskId: string;
  files: BrowserTaskFiles;
  client: SelectedChromeClient;
  fileIds: readonly string[];
  selector: ResilientSelector;
};
const targetKey = (target: UserBrowserTargetDescription) =>
  JSON.stringify([
    target.tabId,
    target.frameId,
    target.origin,
    target.elementId,
    target.objectDigest,
    target.observationRevision,
    target.page,
    target.fileInput,
  ]);

/** The model names task file IDs and a selector. This host capability derives
 * the manifest from actual owned bytes and retains the original native target. */
export class PreparedChromeUpload implements PreparedUploadForGate {
  private state: 'prepared' | 'approved' | 'delivering' | 'settled' | 'disposed' = 'prepared';
  private delivery?: Promise<SelectedChromeClientReply>;
  readonly description: PreparedUploadForGate['description'];
  private constructor(
    private readonly options: Options,
    private readonly action: SelectedChromeUploadAction,
    private readonly target: UserBrowserTargetDescription,
    private readonly revision: number,
  ) {
    const input = target.fileInput!;
    if (!input.formOrigin) throw new Error('无法核实文件接收站点。');
    this.description = Object.freeze({
      origin: target.origin,
      formOrigin: input.formOrigin,
      name: target.element.name || target.element.ariaLabel || 'file',
      accept: input.accept,
      multiple: input.multiple,
      selectedCount: input.selectedCount,
      files: Object.freeze(
        action.payload.files.map(({ sha256: _hash, ...file }) => Object.freeze(file)),
      ),
    });
  }
  static async capture(options: Options): Promise<PreparedChromeUpload> {
    if (
      options.files.taskId !== options.taskId ||
      options.client.taskId !== options.taskId ||
      !options.client.fileUploadsEnabled
    )
      throw new Error('当前任务没有可用的网页文件交付能力。');
    const actual = await options.files.resolve(options.taskId, options.fileIds);
    const action = selectedChromeUploadActionSchema.parse({
      kind: 'upload',
      selector: options.selector,
      payload: {
        files: actual.map((file) => ({
          fileId: file.fileId,
          name: file.name,
          mimeType: file.mimeType,
          sizeBytes: file.buffer.length,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
        })),
      },
    });
    const revision = options.client.revision;
    const described = await options.client.describeUpload(action, revision);
    if (!described.ok || !described.target?.fileInput || !(await options.files.isActive()))
      throw new Error('文件控件或当前任务已不可用，请重新观察。');
    return new PreparedChromeUpload(options, action, described.target, revision);
  }
  async isCurrent(): Promise<boolean> {
    try {
      const admitted = () =>
        !['disposed', 'settled'].includes(this.state) &&
        this.options.client.revision === this.revision;
      if (!admitted() || !(await this.options.files.isActive()) || !admitted()) return false;
      const fresh = await this.options.client.describeUpload(this.action, this.revision);
      return (
        fresh.ok &&
        Boolean(fresh.target) &&
        targetKey(fresh.target!) === targetKey(this.target) &&
        admitted() &&
        (await this.options.files.isActive()) &&
        admitted()
      );
    } catch {
      return false;
    }
  }
  hostBinding(): ReturnType<PreparedUploadForGate['hostBinding']> {
    return {
      kind: 'remote',
      elementId: this.target.elementId,
      tabId: this.target.tabId,
      frameId: this.target.frameId,
      origin: this.target.origin,
    };
  }
  runtimeAction(): ReturnType<PreparedUploadForGate['runtimeAction']> {
    return {
      kind: 'type',
      inputType: 'file',
      label: this.description.name,
      pageUrl: this.target.page.url,
      credentialForm: this.target.fileInput!.credentialForm,
    };
  }
  approve(): void {
    if (this.state !== 'prepared') throw new Error('文件交付准备已失效。');
    this.state = 'approved';
  }
  async deliver(): Promise<SelectedChromeClientReply> {
    if (this.delivery) return this.delivery;
    if (this.state !== 'approved') throw new Error('尚未获得网页文件交付授权。');
    this.state = 'delivering';
    this.delivery = (async (): Promise<SelectedChromeClientReply> => {
      if (!(await this.isCurrent()) || this.state !== 'delivering')
        return { ok: false, error: 'target_changed', actionOutcome: 'not_applied' };
      return this.options.client.upload(this.action, this.revision, {
        resolve: () =>
          this.options.files.resolve(
            this.options.taskId,
            this.action.payload.files.map((file) => file.fileId),
          ),
        current: async () =>
          this.state === 'delivering' &&
          (await this.options.files.isActive()) &&
          this.state === 'delivering',
      });
    })().finally(() => {
      if (this.state !== 'disposed') this.state = 'settled';
    });
    return this.delivery;
  }
  dispose(): void {
    this.state = 'disposed';
  }
}
