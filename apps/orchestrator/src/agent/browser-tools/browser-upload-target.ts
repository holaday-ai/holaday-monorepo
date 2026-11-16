import type { ElementHandle, FileChooser, Frame, Locator } from 'playwright';

export interface BrowserUploadFile {
  fileId: string;
  name: string;
  mimeType: string;
  buffer: Buffer;
}
export interface BrowserUploadReceipt {
  status: 'handed_to_page' | 'unknown';
  origin: string;
  files: Array<{ fileId: string; name: string; mimeType: string; sizeBytes: number }>;
}
interface InputSnapshot {
  connected: boolean;
  documentUrl: string;
  name: string;
  id: string;
  accept: string;
  multiple: boolean;
  disabled: boolean;
  directory: boolean;
  formAction: string;
  formMethod: string;
  credentialForm: boolean;
}
export const MAX_BROWSER_UPLOAD_BYTES = 50 * 1024 * 1024;
function acceptsFile(accept: string, file: BrowserUploadFile): boolean {
  const tokens = accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (!tokens.length) return true;
  return tokens.some((token) =>
    token.startsWith('.')
      ? file.name.toLowerCase().endsWith(token)
      : token.endsWith('/*')
        ? file.mimeType.toLowerCase().startsWith(token.slice(0, -1))
        : file.mimeType.toLowerCase() === token,
  );
}
const readInput = (node: HTMLInputElement): InputSnapshot | null => {
  if (node.tagName !== 'INPUT' || node.type !== 'file') return null;
  return {
    connected: node.isConnected,
    documentUrl: node.ownerDocument.URL,
    name: node.name,
    id: node.id,
    accept: node.accept,
    multiple: node.multiple,
    disabled: node.disabled,
    directory: node.webkitdirectory,
    formAction: node.form?.action || node.ownerDocument.URL,
    formMethod: node.form?.method || 'get',
    credentialForm: Boolean(
      node.form?.querySelector('input[type="password"],input[autocomplete="one-time-code"]'),
    ),
  };
};

/** Only a real Playwright FileChooser event creates this server-held capability. */
export interface CapturedBrowserFileChooser {
  readonly frame: Frame;
  readonly description: Readonly<{ origin: string; accept: string; multiple: boolean }>;
  isCurrent(): Promise<boolean>;
  prepare(
    ids: readonly string[],
    resolve: (ids: readonly string[]) => Promise<BrowserUploadFile[]>,
  ): Promise<PreparedBrowserUpload>;
  dispose(): Promise<void>;
}

/** Server-held, one-shot target. Capture precedes any slow file read or user confirmation. */
export class PreparedBrowserUpload {
  private state: 'prepared' | 'approved' | 'delivering' | 'delivered' | 'disposed' = 'prepared';
  private receipt?: BrowserUploadReceipt;
  private dispatchCheck?: () => void;
  readonly description: Readonly<{
    origin: string;
    formOrigin: string;
    name: string;
    accept: string;
    multiple: boolean;
    files: ReadonlyArray<Readonly<BrowserUploadReceipt['files'][number]>>;
  }>;
  private constructor(
    private readonly element: ElementHandle<HTMLInputElement>,
    private readonly frame: Frame,
    private readonly snapshot: InputSnapshot,
    private payloads: BrowserUploadFile[],
    private readonly resolve: (ids: readonly string[]) => Promise<BrowserUploadFile[]>,
    private readonly chooser?: FileChooser,
    private readonly sourceCurrent?: () => boolean,
  ) {
    this.description = Object.freeze({
      origin: new URL(snapshot.documentUrl).origin,
      formOrigin: new URL(snapshot.formAction).origin,
      name: snapshot.name || snapshot.id || '文件',
      accept: snapshot.accept,
      multiple: snapshot.multiple,
      files: Object.freeze(
        payloads.map(({ fileId, name, mimeType, buffer }) =>
          Object.freeze({ fileId, name, mimeType, sizeBytes: buffer.length }),
        ),
      ),
    });
  }
  static async capture(
    locator: Locator,
    ids: readonly string[],
    resolve: (ids: readonly string[]) => Promise<BrowserUploadFile[]>,
  ): Promise<PreparedBrowserUpload> {
    const element = (await locator.elementHandle({
      timeout: 5000,
    })) as ElementHandle<HTMLInputElement> | null;
    if (!element) throw new Error('文件控件已不可用，请重新观察页面。');
    return PreparedBrowserUpload.captureInput(element, ids, resolve);
  }
  static async captureChooser(
    chooser: FileChooser,
    sourceCurrent?: () => boolean,
  ): Promise<CapturedBrowserFileChooser> {
    const element = chooser.element() as ElementHandle<HTMLInputElement>;
    try {
      const frame = await element.ownerFrame();
      const snapshot = await element.evaluate(readInput);
      if (!frame || !snapshot || frame.page() !== chooser.page() || frame.isDetached())
        throw new Error('文件选择器已失效。');
      let consumed = false;
      let disposed = false;
      const current = async () => {
        if (
          disposed ||
          frame.isDetached() ||
          chooser.page().isClosed() ||
          sourceCurrent?.() === false
        )
          return false;
        try {
          return (
            frame.url() === snapshot.documentUrl &&
            (await element.ownerFrame()) === frame &&
            JSON.stringify(await element.evaluate(readInput)) === JSON.stringify(snapshot)
          );
        } catch {
          return false;
        }
      };
      return {
        frame,
        description: Object.freeze({
          origin: new URL(snapshot.documentUrl).origin,
          accept: snapshot.accept,
          multiple: snapshot.multiple,
        }),
        isCurrent: current,
        async prepare(ids, resolve) {
          if (consumed) throw new Error('文件选择器已失效。');
          consumed = true;
          if (!(await current())) throw new Error('文件选择器已失效。');
          return PreparedBrowserUpload.captureInput(
            element,
            ids,
            resolve,
            chooser,
            snapshot,
            sourceCurrent,
          );
        },
        async dispose() {
          disposed = true;
          await element.dispose().catch(() => undefined);
        },
      };
    } catch (error) {
      await element.dispose().catch(() => undefined);
      throw error;
    }
  }
  private static async captureInput(
    element: ElementHandle<HTMLInputElement>,
    ids: readonly string[],
    resolve: (ids: readonly string[]) => Promise<BrowserUploadFile[]>,
    chooser?: FileChooser,
    captured?: InputSnapshot,
    sourceCurrent?: () => boolean,
  ): Promise<PreparedBrowserUpload> {
    try {
      if (
        !ids.length ||
        ids.length > 5 ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !/^[A-Za-z0-9_-]{1,160}$/.test(id))
      )
        throw new Error('上传文件标识无效。');
      const frame = await element.ownerFrame();
      const snapshot = await element.evaluate(readInput);
      if (
        !frame ||
        !snapshot ||
        sourceCurrent?.() === false ||
        (!chooser && !snapshot.connected) ||
        (chooser && chooser.page() !== frame.page()) ||
        (captured && JSON.stringify(captured) !== JSON.stringify(snapshot)) ||
        snapshot.disabled ||
        snapshot.directory ||
        !/^https?:/.test(snapshot.documentUrl) ||
        !/^https?:/.test(snapshot.formAction)
      )
        throw new Error('该文件控件暂不可用。');
      const files = await resolve(ids);
      if (files.length !== ids.length || files.some((file, index) => file.fileId !== ids[index]))
        throw new Error('附件不属于当前任务的已选材料。');
      let bytes = 0;
      for (const file of files) {
        if (
          !Buffer.isBuffer(file.buffer) ||
          file.buffer.length === 0 ||
          !file.name ||
          file.name.length > 200 ||
          [...file.name].some((char) => char.charCodeAt(0) < 32 || char === '\\' || char === '/') ||
          !file.mimeType ||
          /[\r\n]/.test(file.mimeType)
        )
          throw new Error('文件内容或名称无效。');
        if (!acceptsFile(snapshot.accept, file))
          throw new Error('附件类型不符合当前文件控件要求。');
        bytes += file.buffer.length;
      }
      if (bytes > MAX_BROWSER_UPLOAD_BYTES || (!snapshot.multiple && files.length > 1))
        throw new Error('文件数量或总大小超过此控件的交付范围。');
      const prepared = new PreparedBrowserUpload(
        element,
        frame,
        snapshot,
        files.map((file) => ({ ...file, buffer: Buffer.from(file.buffer) })),
        resolve,
        chooser,
        sourceCurrent,
      );
      await prepared.assertCurrent();
      return prepared;
    } catch (error) {
      await element.dispose();
      throw error;
    }
  }
  private async assertCurrent(): Promise<void> {
    if (
      this.sourceCurrent?.() === false ||
      this.frame.isDetached() ||
      this.frame.url() !== this.snapshot.documentUrl ||
      (await this.element.ownerFrame()) !== this.frame ||
      JSON.stringify(await this.element.evaluate(readInput)) !== JSON.stringify(this.snapshot)
    )
      throw new Error('文件控件或接收页面已变化，请重新观察并确认。');
  }
  /** Called only by the host authorization path; never returned by a model tool. */
  approve(dispatchCheck?: () => void): void {
    if (this.state !== 'prepared') throw new Error('文件交付准备已失效。');
    this.state = 'approved';
    this.dispatchCheck = dispatchCheck;
  }
  async isCurrent(): Promise<boolean> {
    try {
      await this.assertCurrent();
      return true;
    } catch {
      return false;
    }
  }
  hostBinding() {
    return { kind: 'handle' as const, handle: this.element };
  }
  runtimeAction() {
    return {
      kind: 'type' as const,
      inputType: 'file',
      label: this.description.name,
      pageUrl: this.snapshot.documentUrl,
      credentialForm: this.snapshot.credentialForm,
    };
  }
  async deliver(): Promise<BrowserUploadReceipt> {
    if (this.receipt) return this.receipt;
    if (this.state !== 'approved') throw new Error('尚未获得网页文件交付授权。');
    this.state = 'delivering';
    const fresh = await this.resolve(this.description.files.map((file) => file.fileId));
    if (
      this.state !== 'delivering' ||
      fresh.length !== this.payloads.length ||
      fresh.some((file, index) => {
        const original = this.payloads[index];
        return (
          !original ||
          file.fileId !== original.fileId ||
          file.name !== original.name ||
          file.mimeType !== original.mimeType ||
          !Buffer.isBuffer(file.buffer) ||
          !file.buffer.equals(original.buffer)
        );
      })
    )
      throw new Error('附件已失效或内容发生变化，请重新提供。');
    await this.assertCurrent();
    if (this.state !== 'delivering') throw new Error('文件交付准备已失效。');
    this.dispatchCheck?.();
    this.state = 'delivered';
    const files = this.description.files.map((file) => ({ ...file }));
    try {
      // Buffers use Playwright's file payload channel; no cloud filesystem path reaches Chrome.
      const payloads = this.payloads.map(({ name, mimeType, buffer }) => ({
        name,
        mimeType,
        buffer,
      }));
      if (this.chooser) await this.chooser.setFiles(payloads, { timeout: 10_000 });
      else await this.element.setInputFiles(payloads, { timeout: 10_000 });
      this.receipt = { status: 'handed_to_page', origin: this.description.origin, files };
    } catch {
      // A timed-out CDP request may already have caused a site's automatic upload.
      this.receipt = { status: 'unknown', origin: this.description.origin, files };
    } finally {
      this.payloads = [];
    }
    return this.receipt;
  }
  async dispose(): Promise<void> {
    this.state = 'disposed';
    this.payloads = [];
    await this.element.dispose().catch(() => undefined);
  }
}
