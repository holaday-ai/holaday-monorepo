import {
  type LoginContext,
  type UserBrowserActivity,
  type UserBrowserBinding,
  type UserBrowserElementSignals,
  type UserBrowserTargetDescription,
  browserUploadManifestSchema,
  nativeDocumentActivitySchema,
  readLoginContext,
} from '@holaday/shared-types';
import type { ElementHandle, Frame, Locator, Page } from 'playwright-crx';
import type { DriverAction } from './driver.js';
import { grantedFrameOrigin } from './frame-origin.js';
import { type NativeBlobSources, captureNativeBlobSources } from './native-blob-source.js';
import { nativeDownloadResponseSourcesForPage } from './native-download-sources.js';
import {
  NativeDownloadCaptureController,
  NativeDownloadCaptureError,
  type NativeDownloadCaptureResult,
  type NativeDownloadEvent,
  type NativeDownloadFile,
} from './native-download.js';
import {
  type NativeChooserCaptureResult,
  captureNativeFileChooser,
} from './native-file-chooser.js';
import { type LocatorSpec, buildSelectorPlan } from './selector-plan.js';

type DocumentVersion = {
  document: string;
  epoch: number;
  input: number;
  keys: number;
  pointers: number;
  composing: boolean;
  interrupted: boolean;
};
type NativeChooserIdentity = {
  document?: string;
  owned: boolean;
  connected: boolean;
  file: boolean;
};
const readChooserIdentity = (node: Element): NativeChooserIdentity => ({
  document: (window as typeof window & { __holadayV2Document?: { document: string } })
    .__holadayV2Document?.document,
  owned: node.ownerDocument === document,
  connected: node.isConnected,
  file: node.tagName === 'INPUT' && (node as HTMLInputElement).type === 'file',
});
// Executed in the document. No values, cookies, storage or network data leave it.
const readVersion = (collaborationV2 = false): DocumentVersion => {
  const win = window as typeof window & {
    __holadayV2Document?: {
      document: string;
      epoch: number;
      inputTracking?: true;
      activity?: {
        sequence: number;
        keys: Set<string>;
        pointers: Set<string>;
        composing: boolean;
        interrupted: boolean;
        active: boolean;
      };
    };
  };
  if (!win.__holadayV2Document) {
    const state = { document: crypto.randomUUID(), epoch: 0 };
    new MutationObserver(() => {
      state.epoch++;
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    win.__holadayV2Document = state;
  }
  const state = win.__holadayV2Document;
  if (!state.inputTracking) {
    // Typing changes input.value without a DOM mutation. Native input (including a gesture
    // begun while the model thinks) invalidates the old target without reading its contents.
    const changed = (event: Event) => {
      if (event.isTrusted) state.epoch++;
    };
    for (const kind of [
      'keydown',
      'keyup',
      'pointerdown',
      'pointerup',
      'pointercancel',
      'input',
      'change',
      'compositionstart',
      'compositionend',
      'wheel',
      'scroll',
    ])
      document.addEventListener(kind, changed, { capture: true, passive: true });
    document.addEventListener(
      'pointermove',
      (event) => {
        if (event.buttons) changed(event);
      },
      { capture: true, passive: true },
    );
    state.inputTracking = true;
  }
  if (!collaborationV2)
    return {
      document: state.document,
      epoch: state.epoch,
      input: 0,
      keys: 0,
      pointers: 0,
      composing: false,
      interrupted: false,
    };
  if (!state.activity) {
    const activity = {
      sequence: 0,
      keys: new Set<string>(),
      pointers: new Set<string>(),
      composing: false,
      interrupted: false,
      active: true,
    };
    state.activity = activity;
    let lastReport: string | null = null;
    const report = () => {
      if (!activity.active) return;
      const signature = JSON.stringify([
        activity.keys.size,
        activity.pointers.size,
        activity.composing,
        activity.interrupted,
      ]);
      if (signature === lastReport) return;
      lastReport = signature;
      const binding = (window as unknown as Record<string, unknown>).__holadayNativeActivity;
      if (typeof binding !== 'function') return;
      try {
        void Promise.resolve(
          binding({
            document: state.document,
            input: activity.sequence,
            keys: activity.keys.size,
            pointers: activity.pointers.size,
            composing: activity.composing,
            interrupted: activity.interrupted,
          }),
        ).catch(() => {});
      } catch {
        /* The owning extension may have detached. */
      }
    };
    const changed = (event: Event) => {
      if (!event.isTrusted) return;
      activity.sequence++;
      // A real browser input reports its compositor state. A page-created compositionend
      // cannot release the hold (Chromium's CDP insertText also emits an untrusted end).
      if ((event instanceof KeyboardEvent || event instanceof InputEvent) && !event.isComposing)
        activity.composing = false;
      if (event instanceof KeyboardEvent) {
        const key = event.code || event.key;
        if (event.type === 'keydown' && key && key !== 'Process' && key !== 'Unidentified')
          activity.keys.add(key);
        if (event.type === 'keyup') activity.keys.delete(key);
      }
      if (event instanceof PointerEvent) {
        const key = `${event.pointerId}:${event.button}`;
        if (event.type === 'pointerdown') activity.pointers.add(key);
        if (event.type === 'pointerup') activity.pointers.delete(key);
        if (event.type === 'pointercancel' && activity.pointers.size) activity.interrupted = true;
      }
      if (event.type === 'compositionstart') activity.composing = true;
      if (event.type === 'compositionend') activity.composing = false;
      if (!activity.keys.size && !activity.pointers.size && !activity.composing)
        activity.interrupted = false;
      report();
    };
    for (const kind of [
      'keydown',
      'keyup',
      'pointerdown',
      'pointerup',
      'pointercancel',
      'input',
      'change',
      'compositionstart',
      'compositionend',
      'wheel',
      'scroll',
    ])
      document.addEventListener(kind, changed, { capture: true, passive: true });
    document.addEventListener(
      'pointermove',
      (event) => {
        if (event.buttons) changed(event);
      },
      { capture: true, passive: true },
    );
    window.addEventListener('blur', () => {
      if (activity.keys.size || activity.pointers.size || activity.composing) {
        activity.interrupted = true;
        activity.sequence++;
        report();
      }
    });
  }
  state.activity.active = true;
  return {
    document: state.document,
    epoch: state.epoch,
    input: state.activity.sequence,
    keys: state.activity.keys.size,
    pointers: state.activity.pointers.size,
    composing: state.activity.composing,
    interrupted: state.activity.interrupted,
  };
};
/** A file lease cannot follow a later person-generated download into another
 * frame. Arm on the owned native pointer-up, after its own focus transition. */
const trackDownloadFocus = (input: { nonce: string; start: boolean }) => {
  const state = (
    window as typeof window & {
      __holadayV2Document?: {
        activity?: { sequence: number; interrupted: boolean; active: boolean };
        downloadFocus?: { nonce: string; armed: boolean };
        downloadFocusInstalled?: boolean;
      };
    }
  ).__holadayV2Document;
  if (!input.start) {
    if (state?.downloadFocus?.nonce === input.nonce) state.downloadFocus = undefined;
    return;
  }
  if (!state?.activity) throw new Error('scope_unavailable');
  if (state.downloadFocus) throw new Error('browser_busy');
  if (!state.downloadFocusInstalled) {
    document.addEventListener(
      'pointerup',
      (event) => {
        if (event.isTrusted && state.downloadFocus) state.downloadFocus.armed = true;
      },
      { capture: true, passive: true },
    );
    window.addEventListener('blur', () => {
      if (state.downloadFocus?.armed && state.activity?.active) {
        state.activity.sequence++;
        state.activity.interrupted = true;
      }
    });
    state.downloadFocusInstalled = true;
  }
  state.downloadFocus = { nonce: input.nonce, armed: false };
};
const readElement = async (
  node: Element,
  options: boolean | { fileInput: true; nativeChooser: true; documentOrigin: string } = false,
): Promise<
  Pick<
    UserBrowserTargetDescription,
    'elementId' | 'objectDigest' | 'element' | 'form' | 'fileInput'
  >
> => {
  const includeFileInput = options === true || typeof options === 'object';
  const nativeChooser = typeof options === 'object' && options.nativeChooser;
  const selector =
    'button,a[href],input,select,textarea,summary,label,[role=button],[role=link],[role=menuitem],[role=option],[role=tab],[onclick]';
  let el = node;
  for (let cur: Element | null = node, hops = 0; cur && hops < 200; hops++) {
    if (cur.matches(selector)) {
      el = cur;
      break;
    }
    const root = cur.getRootNode();
    cur = cur.parentElement ?? ('host' in root ? (root as ShadowRoot).host : null);
  }
  const win = window as typeof window & { __holadayV2Nodes?: WeakMap<Element, string> };
  const ids = win.__holadayV2Nodes ?? new WeakMap<Element, string>();
  win.__holadayV2Nodes = ids;
  let elementId = ids.get(el);
  if (!elementId) {
    elementId = crypto.randomUUID();
    ids.set(el, elementId);
  }
  const input = el as HTMLInputElement;
  const owner = input.form ?? el.closest('form');
  let fileInput: UserBrowserTargetDescription['fileInput'];
  let selection: unknown;
  if (includeFileInput && el.tagName === 'INPUT' && input.type === 'file') {
    if ((!el.isConnected && !nativeChooser) || input.accept.length > 1200)
      throw new Error('file_target_forbidden');
    let formOrigin: string | null = null;
    try {
      const raw = (owner as HTMLFormElement | null)?.action || el.ownerDocument.URL;
      // An orphan input inside srcdoc/blank belongs to the actual granted
      // frame's inherited origin. Do not infer it from page-authored <base>
      // or window properties. A form with an unknown action remains denied.
      const destination = new URL(
        !owner && typeof options === 'object' && /^(about:blank|about:srcdoc)$/.test(raw)
          ? options.documentOrigin
          : raw,
      );
      if (/^https?:$/.test(destination.protocol) && !destination.username && !destination.password)
        formOrigin = destination.origin;
    } catch {
      /* Unknown destinations remain unknown to the host. */
    }
    fileInput = {
      accept: input.accept,
      multiple: input.multiple,
      disabled: input.disabled || input.matches(':disabled'),
      directory: input.webkitdirectory,
      credentialForm: Array.from((owner as HTMLFormElement | null)?.elements ?? []).some(
        (field) =>
          field.tagName === 'INPUT' &&
          ((field as HTMLInputElement).type === 'password' ||
            field.getAttribute('autocomplete') === 'one-time-code'),
      ),
      formOrigin,
      formMethod: (owner as HTMLFormElement | null)?.method || 'get',
      selectedCount: input.files?.length ?? 0,
    };
    // Bind a human's current selection without exposing its names or contents.
    selection = Array.from(input.files ?? []).map((file) => [
      file.name,
      file.type,
      file.size,
      file.lastModified,
    ]);
  }
  const link = el.closest('a[href]') as HTMLAnchorElement | null;
  const objects = JSON.stringify([
    link?.href,
    link?.getAttribute('href'),
    (owner as HTMLFormElement | null)?.action,
    owner?.getAttribute('action'),
    owner?.getAttribute('method'),
    el.getAttribute('formaction'),
    el.getAttribute('formmethod'),
    ...Array.from(owner?.querySelectorAll('[formaction],[formmethod]') ?? []).map((control) => [
      control.getAttribute('formaction'),
      control.getAttribute('formmethod'),
    ]),
    ...(includeFileInput ? [fileInput, selection] : []),
  ]);
  // Only an opaque digest leaves the page; URL query credentials never enter the model.
  const objectDigest = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(objects))),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  const tag = el.tagName.toLowerCase();
  const text = String((el as HTMLElement).innerText || el.textContent || '')
    .trim()
    .slice(0, 200);
  const element: UserBrowserElementSignals = {
    role:
      el.getAttribute('role') ||
      (
        {
          button: 'button',
          a: 'link',
          select: 'combobox',
          textarea: 'textbox',
          input: 'textbox',
        } as Record<string, string>
      )[tag] ||
      null,
    visibleText:
      text ||
      (tag === 'input' && /^(submit|button)$/.test((el as HTMLInputElement).type)
        ? (el as HTMLInputElement).value.slice(0, 200)
        : null),
    ariaLabel:
      (
        el.getAttribute('aria-label') ||
        (el.getAttribute('aria-labelledby') || '')
          .split(/\s+/)
          .map((id) => el.ownerDocument.getElementById(id)?.textContent || '')
          .join(' ')
          .trim() ||
        Array.from((el as HTMLInputElement).labels || [])
          .map((label) => label.textContent || '')
          .join(' ')
          .trim()
      ).slice(0, 200) || null,
    title: el.getAttribute('title')?.slice(0, 200) ?? null,
    placeholder: el.getAttribute('placeholder')?.slice(0, 200) ?? null,
    name: (el.getAttribute('name') || el.getAttribute('id'))?.slice(0, 200) ?? null,
    inputType: el.getAttribute('type'),
    tagName: tag,
  };
  const form = (el as HTMLInputElement).form ?? el.closest('form');
  if (!form)
    return { elementId, objectDigest, element, form: null, ...(fileInput ? { fileInput } : {}) };
  const allFields = Array.from((form as HTMLFormElement).elements).filter((field) =>
    /^(INPUT|TEXTAREA|SELECT)$/.test(field.tagName),
  );
  const fields = allFields.slice(0, 40);
  const fieldSignal = fields
    .map((field) =>
      [
        field.getAttribute('name'),
        field.id,
        field.getAttribute('placeholder'),
        field.getAttribute('aria-label'),
        Array.from((field as HTMLInputElement).labels || [])
          .map((label) => label.textContent || '')
          .join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .slice(0, 120),
    )
    .join(' ')
    .slice(0, 1200);
  const submitters = Array.from((form as HTMLFormElement).elements).filter(
    (field) =>
      (field.tagName === 'BUTTON' && (field as HTMLButtonElement).type === 'submit') ||
      (field.tagName === 'INPUT' && /^(submit|image)$/.test((field as HTMLInputElement).type)),
  );
  // Clicking a submitter uses its overrides; Enter in a field uses the form's
  // actual default submitter, including controls associated via form=.
  const submit = submitters.includes(el) ? el : submitters[0];
  const method = (
    submit?.getAttribute('formmethod') ||
    form.getAttribute('method') ||
    'get'
  ).toLowerCase();
  const action = submit?.hasAttribute('formaction')
    ? new URL(submit.getAttribute('formaction') || location.href, document.baseURI)
    : new URL((form as HTMLFormElement).action || location.href);
  const transactionalAction =
    /pay|payment|checkout|cashier|order|settle|purchase|transfer|withdraw|delete|remove|destroy|unsubscribe|支付|付款|下单|订单|删除/i.test(
      action.href,
    );
  action.search = '';
  action.hash = '';
  action.username = '';
  action.password = '';
  return {
    elementId,
    objectDigest,
    element,
    ...(fileInput ? { fileInput } : {}),
    form: {
      action: action.href.slice(0, 1200),
      method,
      fieldSignal,
      transactionalAction,
      hasAmountField: fields.some(
        (field) =>
          (field as HTMLInputElement).type === 'number' ||
          (field as HTMLInputElement).inputMode === 'decimal',
      ),
      searchLike:
        method === 'get' &&
        /^https?:$/.test(action.protocol) &&
        allFields.length <= 40 &&
        (form.getAttribute('role') === 'search' ||
          /\/(?:s|search)(?:[/?]|$)/i.test(action.pathname) ||
          /搜索|search|(?:^|\s)(?:q|query|keyword|wd|kw)(?:\s|$)/i.test(fieldSignal)),
      submitControl: submit
        ? {
            role: submit.getAttribute('role') || 'button',
            visibleText:
              String((submit as HTMLElement).innerText || (submit as HTMLInputElement).value || '')
                .trim()
                .slice(0, 200) || null,
            ariaLabel: submit.getAttribute('aria-label')?.slice(0, 200) ?? null,
            title: submit.getAttribute('title')?.slice(0, 200) ?? null,
            placeholder: null,
            name: submit.getAttribute('name')?.slice(0, 200) ?? null,
            inputType: submit.getAttribute('type') || 'submit',
            tagName: submit.tagName.toLowerCase(),
          }
        : null,
    },
  };
};
/** Opaque per-node id shared by every read in the page's main world. */
const nodeId = (node: Element): string => {
  const win = window as typeof window & { __holadayV2Nodes?: WeakMap<Element, string> };
  const ids = win.__holadayV2Nodes ?? new WeakMap<Element, string>();
  win.__holadayV2Nodes = ids;
  let id = ids.get(node);
  if (!id) {
    id = crypto.randomUUID();
    ids.set(node, id);
  }
  return id;
};
type Signals = Pick<
  UserBrowserTargetDescription,
  'elementId' | 'objectDigest' | 'element' | 'form' | 'fileInput'
>;
/**
 * FIX-36 复审 #1: whether the target is a login field or a login / authorize control,
 * folded into its element signals (the orchestrator refuses typing / clicking there).
 */
const withLogin = (signals: Signals, login: LoginContext | null | undefined): Signals => ({
  ...signals,
  // Always present (复审 #2 #6): an absent field means an extension that cannot read them.
  element: {
    ...signals.element,
    loginField: !!login?.loginField,
    loginControl: !!login?.loginControl,
    loginBlock: !!login?.loginBlock,
  },
});
/** A field's own read (type / select / freshness), with its login context. */
const readField = async (
  handle: ElementHandle<Element>,
  upload = false,
  nativeChooserOrigin?: string,
): Promise<Signals> =>
  withLogin(
    (await handle.evaluate(
      readElement,
      upload && nativeChooserOrigin
        ? { fileInput: true, nativeChooser: true, documentOrigin: nativeChooserOrigin }
        : upload,
    )) as Signals,
    await handle.evaluate(readLoginContext, false),
  );
/**
 * Runs on the node Chromium hit-tests at the click point (`this`), which can be
 * inside open or closed shadow roots. `inside`: the hit is the selected
 * element or a shadow-including descendant of it; `document`: the observed
 * document it belongs to (bridges back to the Playwright frame). `opaque`:
 * hit testing stopped at an embedded document it cannot see into (an
 * out-of-process or cross-origin frame, e.g. a third-party payment widget).
 */
const HIT_READ = `async function (selectedId) {
  const node = this.nodeType === 1 ? this : this.parentElement;
  if (!node) return null;
  const ids = window.__holadayV2Nodes;
  let inside = false;
  for (let cur = node, hops = 0; cur && hops < 400; hops++) {
    if (ids && ids.get(cur) === selectedId) { inside = true; break; }
    const root = cur.getRootNode();
    cur = cur.parentElement || (root && 'host' in root ? root.host : null);
  }
  const version = window.__holadayV2Document;
  return {
    inside,
    opaque: /^(?:IFRAME|FRAME|OBJECT|EMBED|PORTAL|FENCEDFRAME)$/.test(node.tagName),
    document: version ? version.document : null,
    read: inside ? await (${readElement.toString()})(node) : null,
    login: inside ? (${readLoginContext.toString()})(node, false) : null,
  };
}`;
/** Same read for the deepest focused element (key actions). */
const FOCUS_READ = `async function () {
  const version = window.__holadayV2Document;
  return {
    document: version ? version.document : null,
    read: await (${readElement.toString()})(this),
    login: (${readLoginContext.toString()})(this, false),
  };
}`;
/** Tabs/addresses that are a payment or order step; the full address
 * (path, query and hash) is tested in the extension, only a boolean leaves. */
const TRANSACTION_URL_RE =
  /(?:\/|\b)(?:checkout|payment|cashier|order[-_/]?confirm|confirm[-_/]?order|order[-_/]?submit|submit[-_/]?order|booking\/confirm|settlement|pay)(?:\/|\b)|订单提交|确认订单|提交订单|收银台|支付|付款|结算/i;
/** Key-order independent: chrome.debugger returns by-value objects with sorted keys. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}
/** Raw CDP on the selected tab (`chrome.debugger.sendCommand` in the extension). */
export type SelectedTabCdp = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
interface Ticket {
  target: UserBrowserTargetDescription;
  action: string;
  handle: ElementHandle<Element> | null;
  frame: Frame;
  nativeChooserId?: string;
  /** Clicks: the exact point described and later clicked, and the selected node. */
  point?: { x: number; y: number; selectedId: string };
}
export type SelectedNativeChooserResult =
  | Exclude<NativeChooserCaptureResult, { status: 'captured' }>
  | { status: 'captured'; clickOutcome: 'applied'; chooserId: string }
  | { status: 'clicked'; clickOutcome: 'applied'; reason: 'chooser_unavailable' };
export type SelectedNativeDownloadResult =
  | Exclude<NativeDownloadCaptureResult, { status: 'captured' }>
  | {
      status: 'captured';
      clickOutcome: 'applied';
      downloadId: string;
      metadata: ReturnType<NativeDownloadFile['metadata']>;
      source: ReturnType<NativeDownloadFile['source']>;
    };
interface HeldNativeDownload {
  id: string;
  file: NativeDownloadFile;
  frame: Frame;
  document: string;
  rootDocument: string;
  origin: string;
  current: () => boolean;
  timer: ReturnType<typeof setTimeout>;
  navigated: (frame: Frame) => void;
  closed: () => void;
}
interface HeldNativeChooser {
  id: string;
  handle: ElementHandle<Element>;
  frame: Frame;
  document: string;
  rootDocument: string;
  origin: string;
  context: string;
  connected: boolean;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  navigated: (frame: Frame) => void;
  closed: () => void;
}
type NativeRelay = {
  receiver: ((frame: Frame, value: unknown) => void) | null;
  ready: Promise<void>;
};
const nativeRelays = new WeakMap<Page, NativeRelay>();

export interface NativeUploadPayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}
function uploadManifest(action: DriverAction) {
  const parsed = browserUploadManifestSchema.safeParse(action.payload?.files);
  if (!parsed.success) throw new Error('file_manifest_invalid');
  return parsed.data;
}
function assertUploadTarget(signals: Signals, action: DriverAction): void {
  const target = signals.fileInput;
  const files = uploadManifest(action);
  if (
    !target ||
    target.disabled ||
    target.directory ||
    target.credentialForm ||
    !target.formOrigin ||
    (!target.multiple && files.length !== 1) ||
    signals.element.loginField ||
    signals.element.loginControl ||
    signals.element.loginBlock
  )
    throw new Error('file_target_forbidden');
  const tokens = target.accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (
    tokens.length &&
    files.some(
      (file) =>
        !tokens.some((token) =>
          token.startsWith('.')
            ? file.name.toLowerCase().endsWith(token)
            : token.endsWith('/*')
              ? file.mimeType.toLowerCase().startsWith(token.slice(0, -1))
              : file.mimeType.toLowerCase() === token,
        ),
    )
  )
    throw new Error('file_target_forbidden');
}

/** One selected page; no selector healing or first-match execution in v2. */
export class SelectedTargetResolver {
  private disposed = false;
  private downloadActive = false;
  private downloadUncertain = false;
  private downloadSetupUncertain = false;
  private downloadInputTracking = false;
  private downloads: NativeDownloadCaptureController | null = null;
  private blobLease: NativeBlobSources | null = null;
  private download: HeldNativeDownload | null = null;
  private revision = 0;
  private documents = new Map<Frame, DocumentVersion>();
  private frames = new WeakMap<Frame, string>();
  private ticket: Ticket | null = null;
  private chooser: HeldNativeChooser | null = null;
  private nativeFrames = new Map<string, DocumentVersion>();
  private nativeInterrupted = false;
  private nativeEvents = new Map<string, Omit<DocumentVersion, 'epoch'>>();
  private nativeRelay: NativeRelay | null = null;
  private readonly receiveNativeActivity = (frame: Frame, value: unknown): void => {
    try {
      this.origin(frame);
    } catch {
      return;
    }
    const parsed = nativeDocumentActivitySchema.safeParse(value);
    if (!parsed.success) return;
    const event = parsed.data;
    if (
      (this.nativeFrames.get(event.document)?.input ?? -1) >= event.input ||
      (this.nativeEvents.get(event.document)?.input ?? -1) >= event.input
    )
      return;
    this.nativeEvents.set(event.document, event);
    if (this.nativeEvents.size > 40) {
      this.nativeInterrupted = true;
      this.nativeEvents.delete(this.nativeEvents.keys().next().value ?? '');
    }
  };
  private async ensureNativeRelay(): Promise<void> {
    if (!this.collaborationV2 || this.nativeRelay) return;
    let relay = nativeRelays.get(this.page);
    if (!relay) {
      relay = { receiver: null, ready: Promise.resolve() };
      nativeRelays.set(this.page, relay);
      const current = relay;
      const page = this.page;
      relay.ready = this.page.exposeBinding('__holadayNativeActivity', (source, value: unknown) => {
        if (source.page === page) current.receiver?.(source.frame, value);
      });
    }
    await relay.ready;
    relay.receiver = this.receiveNativeActivity;
    this.nativeRelay = relay;
  }
  constructor(
    private readonly page: Page,
    private readonly tabId: number,
    private readonly origins: readonly string[],
    private readonly cdp: SelectedTabCdp,
    private readonly collaborationV2 = false,
    private readonly downloadEvents?: { subscribe(listener: NativeDownloadEvent): () => void },
  ) {}
  get stopped(): boolean {
    return this.disposed || this.downloadUncertain || !!this.downloads?.stopped;
  }
  get busy(): boolean {
    return this.downloadActive;
  }
  private assertAvailable(allowDownload = false): void {
    if (this.stopped) throw new Error('session_unavailable');
    if (this.downloadActive && !allowDownload) throw new Error('browser_busy');
  }
  get observationRevision(): number {
    return this.revision;
  }
  private origin(frame: Frame): string {
    return grantedFrameOrigin(frame, this.origins);
  }
  async observe(): Promise<void> {
    this.assertAvailable();
    this.origin(this.page.mainFrame());
    await this.ensureNativeRelay();
    if (this.collaborationV2) await this.activity();
    await this.clearTicket();
    this.documents.clear();
    // Never evaluate an ungranted cross-origin frame.
    for (const frame of this.page.frames().slice(0, 20)) {
      try {
        this.origin(frame);
      } catch {
        continue;
      }
      this.documents.set(frame, await frame.evaluate(readVersion, this.collaborationV2));
      if (!this.frames.has(frame)) this.frames.set(frame, crypto.randomUUID());
    }
    this.revision++;
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.releaseDownload();
    // A failed installation has no returned source lease to retry. Keep the
    // exact driver quarantined until its real page closes; a missing receipt
    // alone does not prove that the old document's temporary hook is gone.
    if (this.downloadSetupUncertain && !this.page.isClosed())
      throw new NativeDownloadCaptureError('download_restore_unconfirmed', 'not_applied');
    await this.downloads?.dispose();
    await this.blobLease?.dispose();
    this.blobLease = null;
    await this.clearNativeChooser();
    if (this.nativeRelay?.receiver === this.receiveNativeActivity) this.nativeRelay.receiver = null;
    this.nativeRelay = null;
    this.nativeEvents.clear();
    if (this.collaborationV2 || this.downloadInputTracking) {
      for (const frame of this.documents.keys()) {
        try {
          this.origin(frame);
          await frame.evaluate(() => {
            const activity = (
              window as typeof window & { __holadayV2Document?: { activity?: { active: boolean } } }
            ).__holadayV2Document?.activity;
            if (activity) activity.active = false;
          });
        } catch {
          /* A replaced/closed document has no relay left to deactivate. */
        }
      }
    }
    this.nativeFrames.clear();
    await this.clearTicket();
    this.documents.clear();
    this.frames = new WeakMap();
  }
  async assertObservationFresh(): Promise<void> {
    for (const frame of this.documents.keys()) await this.assertFresh(frame, this.revision);
  }
  async activity(): Promise<UserBrowserActivity> {
    this.assertAvailable();
    this.origin(this.page.mainFrame());
    const versions: DocumentVersion[] = [];
    for (const frame of this.page.frames().slice(0, 20)) {
      try {
        this.origin(frame);
      } catch {
        continue;
      }
      versions.push(await frame.evaluate(readVersion, this.collaborationV2));
    }
    for (const previous of [...this.nativeFrames.values(), ...this.nativeEvents.values()]) {
      if (
        (previous.keys || previous.pointers || previous.composing) &&
        !versions.some((v) => v.document === previous.document)
      )
        this.nativeInterrupted = true;
    }
    this.nativeFrames = new Map(versions.map((v) => [v.document, v]));
    for (const version of versions) {
      if ((this.nativeEvents.get(version.document)?.input ?? -1) <= version.input)
        this.nativeEvents.delete(version.document);
    }
    return this.encodeActivity(versions);
  }
  async observedActivity(): Promise<UserBrowserActivity> {
    return this.encodeActivity([...this.documents.values()]);
  }
  async assertNativeIdle(): Promise<void> {
    if (!this.collaborationV2) return;
    const activity = await this.activity();
    if (activity.keys || activity.pointers || activity.composing || activity.interrupted)
      throw new Error('human_input_active');
  }
  private async encodeActivity(versions: DocumentVersion[]): Promise<UserBrowserActivity> {
    const stamp = JSON.stringify(
      versions
        .map((v) => [v.document, v.input])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stamp));
    return {
      tabId: this.tabId,
      stamp: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''),
      keys: versions.reduce((sum, v) => sum + v.keys, 0),
      pointers: versions.reduce((sum, v) => sum + v.pointers, 0),
      composing: versions.some((v) => v.composing),
      interrupted: this.nativeInterrupted || versions.some((v) => v.interrupted),
    };
  }
  frameContexts(): Array<{ frame: Frame; frameId: string; origin: string }> {
    return [...this.documents.keys()].map((frame) => ({
      frame,
      frameId: this.frames.get(frame) ?? '',
      origin: this.origin(frame),
    }));
  }
  private async clearTicket(): Promise<void> {
    const ticket = this.ticket;
    this.ticket = null;
    if (!ticket?.nativeChooserId) await ticket?.handle?.dispose().catch(() => undefined);
  }
  private async clearNativeChooser(id?: string): Promise<void> {
    const held = this.chooser;
    if (!held || (id && held.id !== id)) return;
    this.chooser = null;
    clearTimeout(held.timer);
    // These only invalidate the retained handle; interception has already been
    // released. Always discard handle authority even if the page has closed.
    for (const detach of [
      () => this.page.off('framenavigated', held.navigated),
      () => this.page.off('framedetached', held.navigated),
      () => this.page.off('close', held.closed),
    ]) {
      try {
        detach();
      } catch {
        /* closed connection */
      }
    }
    await held.handle.dispose().catch(() => undefined);
  }
  private nativeChooserCurrent(id: string): boolean {
    const held = this.chooser;
    if (!held || held.id !== id || Date.now() >= held.expiresAt) return false;
    try {
      return (
        this.page.frames().includes(held.frame) &&
        this.origin(held.frame) === held.origin &&
        canonical(this.pageContext(held.frame)) === held.context
      );
    } catch {
      return false;
    }
  }
  private async requireNativeChooser(id: unknown): Promise<HeldNativeChooser> {
    const held = this.chooser;
    if (!held || id !== held.id) throw new Error('file_target_forbidden');
    try {
      if (!this.nativeChooserCurrent(held.id)) throw new Error();
      const root = await this.page
        .mainFrame()
        .evaluate<DocumentVersion, boolean>(readVersion, this.collaborationV2);
      const version = await held.frame.evaluate<DocumentVersion, boolean>(
        readVersion,
        this.collaborationV2,
      );
      const nativeOrigin = await held.handle.evaluate<string>(() => window.origin);
      // Native chooser handles live in the SDK utility world. Adopt the same
      // actual node into its owner's main world to compare document identity.
      const identity = await held.frame.evaluate<NativeChooserIdentity, ElementHandle<Element>>(
        readChooserIdentity,
        held.handle,
      );
      if (
        this.chooser !== held ||
        !this.nativeChooserCurrent(held.id) ||
        nativeOrigin !== held.origin ||
        root.document !== held.rootDocument ||
        version.document !== held.document ||
        identity.document !== held.document ||
        !identity.owned ||
        !identity.file ||
        identity.connected !== held.connected
      )
        throw new Error();
      return held;
    } catch {
      await this.clearNativeChooser(held.id);
      throw new Error('file_target_forbidden');
    }
  }
  private async assertFresh(frame: Frame, expected: number): Promise<void> {
    this.origin(this.page.mainFrame());
    this.origin(frame);
    if (expected !== this.revision || !this.documents.has(frame))
      throw new Error('stale_observation');
    const current = await frame.evaluate<DocumentVersion, boolean>(
      readVersion,
      this.collaborationV2,
    );
    if (
      this.collaborationV2 &&
      (current.keys ||
        current.pointers ||
        current.composing ||
        current.interrupted ||
        this.nativeInterrupted)
    )
      throw new Error('human_input_active');
    if (JSON.stringify(current) !== JSON.stringify(this.documents.get(frame)))
      throw new Error('stale_observation');
  }
  private frameFor(documentId: unknown): Frame {
    for (const [frame, version] of this.documents)
      if (typeof documentId === 'string' && version.document === documentId) return frame;
    // Not an observed, granted document (or observed before it was replaced).
    throw new Error('stale_observation');
  }
  /** Runs one CDP read and maps transport/page failures to `target_unreadable`. */
  private async withObjects<T>(work: (track: (id: string) => string) => Promise<T>): Promise<T> {
    const objects: string[] = [];
    try {
      return await work((id) => {
        objects.push(id);
        return id;
      });
    } catch (error) {
      if (error instanceof NativeDownloadCaptureError) throw error;
      const code = error instanceof Error ? error.message : '';
      if (/^(?:target_[a-z_]+|stale_observation|origin_grant_required)$/.test(code)) throw error;
      throw new Error('target_unreadable');
    } finally {
      for (const objectId of objects)
        await this.cdp('Runtime.releaseObject', { objectId }).catch(() => undefined);
    }
  }
  private async callOn(objectId: string, functionDeclaration: string, args: unknown[] = []) {
    const result = (await this.cdp('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      awaitPromise: true,
      returnByValue: true,
    })) as { result?: { value?: unknown }; exceptionDetails?: unknown };
    if (result.exceptionDetails) throw new Error('target_unreadable');
    return result.result?.value;
  }
  private async objectFrom(objectId: string, functionDeclaration: string): Promise<string | null> {
    const result = (await this.cdp('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration,
      returnByValue: false,
    })) as { result?: { objectId?: string; subtype?: string }; exceptionDetails?: unknown };
    if (result.exceptionDetails) throw new Error('target_unreadable');
    return result.result?.subtype === 'null' ? null : (result.result?.objectId ?? null);
  }
  /**
   * What a real click at viewport point (x, y) lands on: Chromium hit testing
   * pierces open and closed shadow roots and same-process frames and, like
   * the mouse, skips pointer-events:none overlays. The hit must be the
   * selected element or inside it; anything else (an overlay, an
   * out-of-process frame, an unobserved document) is not described.
   */
  private async readAt(
    point: { x: number; y: number },
    selectedId: string,
    visit?: (target: {
      frame: Frame;
      signals: Signals;
      frameId: string;
      objectId: string;
    }) => Promise<void>,
  ): Promise<{ frame: Frame; signals: Signals }> {
    return this.withObjects(async (track) => {
      const hit = (await this.cdp('DOM.getNodeForLocation', {
        x: point.x,
        y: point.y,
        includeUserAgentShadowDOM: false,
        ignorePointerEventsNone: false,
      })) as { backendNodeId?: number; frameId?: string };
      const resolved = (await this.cdp('DOM.resolveNode', {
        backendNodeId: hit.backendNodeId,
      })) as { object?: { objectId?: string } };
      if (!resolved.object?.objectId) throw new Error('target_unreadable');
      const value = (await this.callOn(track(resolved.object.objectId), HIT_READ, [
        selectedId,
      ])) as {
        inside: boolean;
        opaque: boolean;
        document: unknown;
        read: Signals | null;
        login: LoginContext | null;
      } | null;
      if (!value) throw new Error('target_unreadable');
      if (!value.inside || !value.read) throw new Error('target_obscured');
      // What a click inside it would hit is unknown: the user decides.
      if (value.opaque) throw new Error('target_unreadable');
      const target = {
        frame: this.frameFor(value.document),
        signals: withLogin(value.read, value.login),
      };
      if (visit) {
        if (!hit.frameId) throw new Error('target_unreadable');
        await visit({ ...target, frameId: hit.frameId, objectId: resolved.object.objectId });
      }
      return target;
    });
  }
  /**
   * The deepest focused element, through open and closed shadow roots and
   * same-process frames: Enter/Space act on it, not on a shadow host.
   */
  private async focusTarget(): Promise<{ frame: Frame; signals: Signals }> {
    return this.withObjects(async (track) => {
      const start = (await this.cdp('Runtime.evaluate', {
        expression: 'document.activeElement',
        returnByValue: false,
      })) as { result?: { objectId?: string; subtype?: string } };
      let current = start.result?.subtype === 'null' ? null : (start.result?.objectId ?? null);
      for (let depth = 0; current && depth < 32; depth++) {
        track(current);
        const { node } = (await this.cdp('DOM.describeNode', {
          objectId: current,
          depth: 0,
          pierce: true,
        })) as {
          node: {
            nodeName: string;
            shadowRoots?: Array<{ backendNodeId: number; shadowRootType?: string }>;
          };
        };
        let next: string | null = null;
        const root = node.shadowRoots?.find((r) => r.shadowRootType !== 'user-agent');
        if (root) {
          const resolved = (await this.cdp('DOM.resolveNode', {
            backendNodeId: root.backendNodeId,
          })) as { object?: { objectId?: string } };
          if (!resolved.object?.objectId) throw new Error('target_unreadable');
          next = await this.objectFrom(
            track(resolved.object.objectId),
            'function () { return this.activeElement; }',
          );
        } else if (/^i?frame$/i.test(node.nodeName)) {
          next = await this.objectFrom(
            current,
            'function () { const d = this.contentDocument; return d ? d.activeElement : undefined; }',
          );
          // An out-of-process frame cannot be read from this tab session.
          if (!next) throw new Error('target_unreadable');
        }
        if (!next) {
          const value = (await this.callOn(current, FOCUS_READ)) as {
            document: unknown;
            read: Signals;
            login: LoginContext | null;
          } | null;
          if (!value?.read || /^(?:body|html)$/.test(value.read.element.tagName ?? ''))
            throw new Error('target_missing');
          return {
            frame: this.frameFor(value.document),
            signals: withLogin(value.read, value.login),
          };
        }
        current = next;
      }
      throw new Error('target_missing');
    });
  }
  /** The point a click is sent to: the centre of the (scrolled-into-view) element. */
  private async clickPoint(handle: ElementHandle<Element>): Promise<{ x: number; y: number }> {
    await handle.scrollIntoViewIfNeeded({ timeout: 2000 });
    const box = await handle.boundingBox();
    if (!box || box.width < 1 || box.height < 1) throw new Error('target_unreadable');
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  }
  /** The tab's current page: path only (no query/hash values) plus transaction context. */
  private pageContext(frame: Frame): UserBrowserTargetDescription['page'] {
    const main = new URL(this.page.mainFrame().url());
    const decoded = (raw: string) => {
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    };
    return {
      url: `${main.origin}${main.pathname}`.slice(0, 2048),
      transactional: [this.page.mainFrame().url(), frame.url()].some((raw) =>
        TRANSACTION_URL_RE.test(decoded(raw)),
      ),
    };
  }
  private async resolve(
    action: DriverAction,
  ): Promise<{ handle: ElementHandle<Element>; frame: Frame; nativeChooserId?: string }> {
    if (action.kind === 'key') throw new Error('target_missing');
    if (action.kind === 'upload' && action.payload && 'chooserId' in action.payload) {
      if (action.selector) throw new Error('file_target_forbidden');
      const held = await this.requireNativeChooser(action.payload.chooserId);
      return { handle: held.handle, frame: held.frame, nativeChooserId: held.id };
    }
    if (!action.selector) throw new Error('target_missing');
    const plan = buildSelectorPlan(action.selector);
    for (const spec of plan.attempts) {
      const matches: { locator: Locator; frame: Frame }[] = [];
      for (const frame of this.documents.keys()) {
        try {
          this.origin(frame);
        } catch {
          continue;
        }
        const scope = plan.scopeCss ? frame.locator(plan.scopeCss) : null;
        const locator = locatorFor(frame, scope, spec);
        const count = await locator.count();
        // nth is not a licence to turn an ambiguous description into permission.
        if (count > 1) throw new Error('target_ambiguous');
        if (count === 1) matches.push({ locator, frame });
      }
      if (matches.length > 1) throw new Error('target_ambiguous');
      const match = matches[0];
      if (match) {
        const handle = (await match.locator.elementHandle({
          timeout: 2000,
        })) as ElementHandle<Element> | null;
        if (handle) return { handle, frame: match.frame };
      }
    }
    throw new Error('target_missing');
  }
  async describe(action: DriverAction, expected: number): Promise<UserBrowserTargetDescription> {
    this.assertAvailable();
    await this.clearTicket();
    let handle: ElementHandle<Element> | null = null;
    let nativeChooserId: string | undefined;
    try {
      let frame: Frame;
      let signals: Signals;
      let point: Ticket['point'];
      if (action.kind === 'key') {
        ({ frame, signals } = await this.focusTarget());
        await this.assertFresh(frame, expected);
      } else {
        const resolved = await this.resolve(action);
        handle = resolved.handle;
        nativeChooserId = resolved.nativeChooserId;
        frame = resolved.frame;
        await this.assertFresh(frame, expected);
        if (action.kind !== 'upload' && !(await handle.isVisible()))
          throw new Error('target_unreadable');
        if (action.kind === 'click') {
          // Describe what the click will actually hit, not the selector's node:
          // a shadow host's inner payment button is the real target.
          const selectedId = String(await handle.evaluate(nodeId));
          const at = await this.clickPoint(handle);
          const hit = await this.readAt(at, selectedId);
          if (hit.frame !== frame) throw new Error('target_obscured');
          signals = hit.signals;
          point = { ...at, selectedId };
        } else
          signals = await readField(
            handle,
            action.kind === 'upload',
            nativeChooserId ? this.origin(frame) : undefined,
          );
        if (action.kind === 'upload') assertUploadTarget(signals, action);
      }
      let frameId = this.frames.get(frame);
      if (!frameId) {
        frameId = crypto.randomUUID();
        this.frames.set(frame, frameId);
      }
      const target: UserBrowserTargetDescription = {
        token: crypto.randomUUID(),
        tabId: this.tabId,
        frameId,
        origin: this.origin(frame),
        observationRevision: expected,
        capturedAt: Date.now(),
        ...signals,
        page: this.pageContext(frame),
      };
      await this.assertFresh(frame, expected);
      this.ticket = {
        target,
        action: JSON.stringify(action),
        handle,
        frame,
        point,
        nativeChooserId,
      };
      return target;
    } catch (error) {
      if (nativeChooserId) await this.clearNativeChooser(nativeChooserId);
      else await handle?.dispose();
      throw error;
    }
  }
  async execute(
    action: DriverAction,
    binding: UserBrowserBinding,
    uploadFiles?: readonly NativeUploadPayload[],
    dispatchAllowed?: () => boolean,
  ): Promise<void> {
    await this.executeInternal(action, binding, uploadFiles, dispatchAllowed);
  }
  /** Only the explicit file-button operation calls this. Ordinary clicks never
   * install a filechooser listener. The same ticket/hit test protects both. */
  async captureFileChooser(
    action: DriverAction,
    binding: UserBrowserBinding,
    dispatchAllowed: () => boolean,
    signal?: AbortSignal,
  ): Promise<SelectedNativeChooserResult> {
    this.assertAvailable();
    if (action.kind !== 'click' || typeof dispatchAllowed !== 'function')
      throw new Error('capability_missing');
    const captured: { result?: NativeChooserCaptureResult } = {};
    await this.executeInternal(
      action,
      binding,
      undefined,
      dispatchAllowed,
      async (prepare, click) => {
        await this.clearNativeChooser();
        captured.result = await captureNativeFileChooser(this.page, {
          prepare,
          click,
          current: dispatchAllowed,
          signal,
          intercept: async (enabled) => {
            await this.cdp('Page.setInterceptFileChooserDialog', { enabled });
          },
        });
      },
    );
    const result = captured.result;
    if (!result) throw new Error('capability_missing');
    if (result.status !== 'captured') return result;
    const handle = result.chooser.element() as ElementHandle<Element>;
    try {
      if (result.chooser.page() !== this.page || !dispatchAllowed() || signal?.aborted)
        throw new Error();
      const frame = await handle.ownerFrame();
      if (!frame || !this.page.frames().includes(frame)) throw new Error();
      const original = this.documents.get(frame);
      const originalRoot = this.documents.get(this.page.mainFrame());
      if (!original || !originalRoot) throw new Error();
      const origin = this.origin(frame);
      // The pinned CRX SDK creates native chooser handles in its utility world.
      // Its untouched Window.origin distinguishes opaque sandboxed srcdoc from
      // a genuinely inherited origin; a page's main-world override cannot grant it.
      if ((await handle.evaluate(() => window.origin)) !== origin) throw new Error();
      const version = await frame.evaluate<DocumentVersion, boolean>(
        readVersion,
        this.collaborationV2,
      );
      const root = await this.page
        .mainFrame()
        .evaluate<DocumentVersion, boolean>(readVersion, this.collaborationV2);
      const identity = await frame.evaluate<NativeChooserIdentity, ElementHandle<Element>>(
        readChooserIdentity,
        handle,
      );
      if (
        !dispatchAllowed() ||
        signal?.aborted ||
        version.document !== original.document ||
        root.document !== originalRoot.document ||
        identity.document !== version.document ||
        !identity.owned ||
        !identity.file
      )
        throw new Error();
      const id = crypto.randomUUID();
      const navigated = (changed: Frame) => {
        if (changed === frame || changed === this.page.mainFrame())
          void this.clearNativeChooser(id);
      };
      const closed = () => {
        void this.clearNativeChooser(id);
      };
      this.chooser = {
        id,
        handle,
        frame,
        document: version.document,
        rootDocument: root.document,
        origin,
        context: canonical(this.pageContext(frame)),
        connected: identity.connected,
        expiresAt: Date.now() + 120_000,
        timer: setTimeout(closed, 120_000),
        navigated,
        closed,
      };
      this.page.on('framenavigated', navigated);
      this.page.on('framedetached', navigated);
      this.page.on('close', closed);
      return { status: 'captured', clickOutcome: 'applied', chooserId: id };
    } catch {
      await this.clearNativeChooser();
      await handle.dispose().catch(() => undefined);
      return { status: 'clicked', clickOutcome: 'applied', reason: 'chooser_unavailable' };
    }
  }
  /** Explicit download only. The same ticket and final native hit-test protect
   * the original click; no address is re-fetched to manufacture a file. */
  async captureDownload(
    action: DriverAction,
    binding: UserBrowserBinding,
    dispatchAllowed: () => boolean,
    signal?: AbortSignal,
  ): Promise<SelectedNativeDownloadResult> {
    this.assertAvailable();
    if (!this.downloadEvents || action.kind !== 'click' || typeof dispatchAllowed !== 'function')
      throw new Error('capability_missing');
    if (this.download && !this.download.file.alive) this.releaseDownload();
    if (this.download) throw new Error('browser_busy');
    const ticket = this.ticket;
    if (!ticket?.point) throw new Error('target_binding_required');
    const original = this.documents.get(ticket.frame);
    const root = this.documents.get(this.page.mainFrame());
    if (!original || !root) throw new Error('stale_observation');
    const context = {
      frame: ticket.frame,
      document: original.document,
      rootDocument: root.document,
      origin: this.origin(ticket.frame),
    };
    const current = () => !this.disposed && !signal?.aborted && dispatchAllowed();
    let result: NativeDownloadCaptureResult | undefined;
    let finalInputCheck: (() => Promise<void>) | undefined;
    const focusLease = crypto.randomUUID();
    this.downloadActive = true;
    try {
      await this.executeInternal(
        action,
        binding,
        undefined,
        dispatchAllowed,
        async (prepare, click) => {
          this.downloadInputTracking = true;
          const rootFrame = this.page.mainFrame();
          const rootInput = await rootFrame.evaluate<DocumentVersion, boolean>(readVersion, true);
          const frameInput =
            ticket.frame === rootFrame
              ? rootInput
              : await ticket.frame.evaluate<DocumentVersion, boolean>(readVersion, true);
          await ticket.frame.evaluate(trackDownloadFocus, { nonce: focusLease, start: true });
          const checkInput = async (applied: boolean) => {
            const rootNow = await rootFrame.evaluate<DocumentVersion, boolean>(readVersion, true);
            const frameNow =
              ticket.frame === rootFrame
                ? rootNow
                : await ticket.frame.evaluate<DocumentVersion, boolean>(readVersion, true);
            // One native mouse click sends its own down/up. A later trusted
            // key, pointer, input, composition or scroll belongs to a changed
            // interaction context, not authority over another exported file.
            if (
              !current() ||
              rootNow.document !== context.rootDocument ||
              frameNow.document !== context.document ||
              rootNow.input !== rootInput.input + (applied && ticket.frame === rootFrame ? 2 : 0) ||
              frameNow.input !== frameInput.input + (applied ? 2 : 0) ||
              rootNow.keys ||
              rootNow.pointers ||
              rootNow.composing ||
              rootNow.interrupted ||
              frameNow.keys ||
              frameNow.pointers ||
              frameNow.composing ||
              frameNow.interrupted
            )
              throw new Error('scope_unavailable');
          };
          await checkInput(false);
          finalInputCheck = () => checkInput(true);
          await this.readAt(ticket.point!, ticket.point!.selectedId, async (target) => {
            if (
              target.frame !== ticket.frame ||
              canonical(target.signals) !==
                canonical({
                  elementId: ticket.target.elementId,
                  objectDigest: ticket.target.objectDigest,
                  element: ticket.target.element,
                  form: ticket.target.form,
                })
            )
              throw new Error('target_changed');
            const link = (await this.cdp('Runtime.callFunctionOn', {
              objectId: target.objectId,
              functionDeclaration:
                'function(){const a=this.closest("a[download]");return a&&typeof a.href==="string"?a.href:null;}',
              returnByValue: true,
            })) as { result?: { value?: unknown } };
            const downloadLink =
              typeof link.result?.value === 'string' ? link.result.value : undefined;
            try {
              this.blobLease = await captureNativeBlobSources({
                owner: this.page,
                frameId: target.frameId,
                nodeObjectId: target.objectId,
                origin: context.origin,
                cdp: this.cdp,
                current,
                signal,
                timeoutMs: 5000,
              });
            } catch (error) {
              if (error instanceof Error && error.message === 'blob_capture_restore_unconfirmed') {
                this.downloadUncertain = true;
                this.downloadSetupUncertain = true;
                throw new NativeDownloadCaptureError('download_restore_unconfirmed', 'not_applied');
              }
              // A site's custom platform API cannot supply Blob bytes. Network
              // and data downloads may still use actual native download receipts.
              if (!(error instanceof Error) || error.message !== 'blob_api_unavailable')
                throw error;
            }
            this.downloads ??= new NativeDownloadCaptureController({
              owner: this.page,
              send: this.cdp,
              subscribe: (listener) => this.downloadEvents!.subscribe(listener),
            });
            result = await this.downloads.capture({
              frameId: target.frameId,
              origin: context.origin,
              responseSources: nativeDownloadResponseSourcesForPage(ticket.frame.url()),
              downloadLink,
              current,
              prepare: async () => {
                await checkInput(false);
                await prepare();
              },
              click,
              signal,
              blobs: this.blobLease ?? undefined,
              totalMs: 55_000,
              finalCheck: async () => {
                await this.assertDownloadDocument(context, current);
                await finalInputCheck!();
              },
            });
          });
        },
      );
      if (!result) throw new Error('capability_missing');
      if (this.blobLease) {
        try {
          await this.blobLease.dispose();
          this.blobLease = null;
        } catch {
          this.downloadUncertain = true;
          if (result.status === 'captured') result.file.dispose();
          throw new NativeDownloadCaptureError('download_restore_unconfirmed', result.clickOutcome);
        }
      }
      if (result.status !== 'captured') return result;
      try {
        await this.assertDownloadDocument(context, current);
        await finalInputCheck!();
        const metadata = result.file.metadata();
        const source = result.file.source();
        const id = crypto.randomUUID();
        const navigated = (frame: Frame) => {
          if (frame === context.frame || frame === this.page.mainFrame()) this.releaseDownload(id);
        };
        const closed = () => this.releaseDownload(id);
        this.download = {
          ...context,
          id,
          file: result.file,
          current,
          timer: setTimeout(closed, 120_000),
          navigated,
          closed,
        };
        this.page.on('framenavigated', navigated);
        this.page.on('framedetached', navigated);
        this.page.on('close', closed);
        return { status: 'captured', clickOutcome: 'applied', downloadId: id, metadata, source };
      } catch {
        result.file.dispose();
        return { status: 'clicked', clickOutcome: 'applied', reason: 'scope_unavailable' };
      }
    } catch (error) {
      if (this.blobLease && !this.downloads?.stopped) {
        try {
          await this.blobLease.dispose();
          this.blobLease = null;
        } catch {
          this.downloadUncertain = true;
          if (result?.status === 'captured') result.file.dispose();
          throw new NativeDownloadCaptureError(
            'download_restore_unconfirmed',
            result?.clickOutcome ??
              (error instanceof NativeDownloadCaptureError ? error.clickOutcome : 'not_applied'),
          );
        }
      }
      throw error;
    } finally {
      try {
        if (this.origin(ticket.frame) === context.origin)
          await ticket.frame.evaluate(trackDownloadFocus, { nonce: focusLease, start: false });
      } catch {
        /* A closed or newly ungranted document has no lease to release here. */
      }
      this.downloadActive = false;
    }
  }
  private async assertDownloadDocument(
    held: Pick<HeldNativeDownload, 'frame' | 'origin' | 'document' | 'rootDocument'>,
    current: () => boolean,
  ): Promise<void> {
    const check = () => {
      if (
        !current() ||
        !this.page.frames().includes(held.frame) ||
        this.origin(held.frame) !== held.origin
      )
        throw new Error('download_unavailable');
      this.origin(this.page.mainFrame());
    };
    check();
    const root = await this.page
      .mainFrame()
      .evaluate<DocumentVersion, boolean>(readVersion, this.collaborationV2);
    const version = await held.frame.evaluate<DocumentVersion, boolean>(
      readVersion,
      this.collaborationV2,
    );
    check();
    if (root.document !== held.rootDocument || version.document !== held.document)
      throw new Error('download_unavailable');
  }
  async readDownloadChunk(
    id: string,
    offset: number,
    length: number,
    current: () => boolean,
  ): Promise<Uint8Array> {
    this.assertAvailable();
    const held = this.download;
    if (!held || held.id !== id || typeof current !== 'function')
      throw new Error('download_unavailable');
    try {
      const allowed = () => this.download === held && !this.disposed && current() && held.current();
      await this.assertDownloadDocument(held, allowed);
      const bytes = held.file.read(offset, length);
      if (!allowed()) {
        bytes.fill(0);
        throw new Error('download_unavailable');
      }
      return bytes;
    } catch {
      this.releaseDownload(id);
      throw new Error('download_unavailable');
    }
  }
  releaseDownload(id?: string): void {
    const held = this.download;
    if (!held || (id !== undefined && held.id !== id)) return;
    this.download = null;
    clearTimeout(held.timer);
    held.file.dispose();
    for (const detach of [
      () => this.page.off('framenavigated', held.navigated),
      () => this.page.off('framedetached', held.navigated),
      () => this.page.off('close', held.closed),
    ]) {
      try {
        detach();
      } catch {
        /* the owned page may already be detached */
      }
    }
  }
  private async executeInternal(
    action: DriverAction,
    binding: UserBrowserBinding,
    uploadFiles?: readonly NativeUploadPayload[],
    dispatchAllowed?: () => boolean,
    nativeChooserClick?: (
      prepare: () => Promise<void>,
      click: () => Promise<void>,
    ) => Promise<void>,
  ): Promise<void> {
    this.assertAvailable(!!nativeChooserClick);
    const ticket = this.ticket;
    this.ticket = null;
    if (
      !ticket ||
      ticket.target.token !== binding.token ||
      ticket.target.observationRevision !== binding.observationRevision ||
      ticket.action !== JSON.stringify(action)
    ) {
      if (ticket?.nativeChooserId) await this.clearNativeChooser(ticket.nativeChooserId);
      else await ticket?.handle?.dispose();
      throw new Error('target_binding_required');
    }
    const expected = canonical({
      elementId: ticket.target.elementId,
      objectDigest: ticket.target.objectDigest,
      element: ticket.target.element,
      form: ticket.target.form,
      ...(action.kind === 'upload' ? { fileInput: ticket.target.fileInput } : {}),
    });
    try {
      await this.assertFresh(ticket.frame, binding.observationRevision);
      // The confirmed page context is part of the action (a pushState to
      // /pay keeps the DOM but changes what "继续" means).
      if (canonical(this.pageContext(ticket.frame)) !== canonical(ticket.target.page))
        throw new Error('target_changed');
      const timeout = action.deadlineMs ?? 2000;
      switch (action.kind) {
        case 'upload': {
          const handle = ticket.handle;
          const files = uploadManifest(action);
          if (!handle || !uploadFiles || uploadFiles.length !== files.length)
            throw new Error('file_payload_invalid');
          for (let i = 0; i < files.length; i++) {
            const file = files[i]!;
            const payload = uploadFiles[i]!;
            if (
              payload.name !== file.name ||
              payload.mimeType !== file.mimeType ||
              !(payload.buffer instanceof Uint8Array) ||
              payload.buffer.length !== file.sizeBytes
            )
              throw new Error('file_payload_invalid');
            const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', payload.buffer));
            if (
              Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('') !==
              file.sha256
            )
              throw new Error('file_payload_invalid');
          }
          if (ticket.nativeChooserId) await this.requireNativeChooser(ticket.nativeChooserId);
          const fresh = await readField(
            handle,
            true,
            ticket.nativeChooserId ? this.origin(ticket.frame) : undefined,
          );
          assertUploadTarget(fresh, action);
          if (canonical(fresh) !== expected) throw new Error('target_changed');
          if (ticket.nativeChooserId) await this.requireNativeChooser(ticket.nativeChooserId);
          await this.assertFresh(ticket.frame, binding.observationRevision);
          if (dispatchAllowed && !dispatchAllowed()) throw new Error('session_unavailable');
          if (ticket.nativeChooserId && !this.nativeChooserCurrent(ticket.nativeChooserId))
            throw new Error('file_target_forbidden');
          try {
            await handle.setInputFiles(uploadFiles, { timeout: action.deadlineMs ?? 10_000 });
          } catch {
            throw new Error('input_outcome_unknown');
          }
          break;
        }
        case 'click': {
          const point = ticket.point;
          if (!point) throw new Error('target_binding_required');
          // Re-hit-test the very point that will be clicked: same node, same
          // semantics, still inside the selected element.
          const prepare = async () => {
            const hit = await this.readAt(point, point.selectedId);
            if (hit.frame !== ticket.frame || canonical(hit.signals) !== expected)
              throw new Error('target_changed');
            await this.assertFresh(ticket.frame, binding.observationRevision);
            if (canonical(this.pageContext(ticket.frame)) !== canonical(ticket.target.page))
              throw new Error('target_changed');
            if (dispatchAllowed && !dispatchAllowed()) throw new Error('session_unavailable');
          };
          const click = () => this.page.mouse.click(point.x, point.y);
          if (nativeChooserClick) await nativeChooserClick(prepare, click);
          else {
            await prepare();
            await click();
          }
          break;
        }
        case 'key': {
          // The key goes to the focused element; it must be the described one.
          const focus = await this.focusTarget();
          if (focus.frame !== ticket.frame || canonical(focus.signals) !== expected)
            throw new Error('target_changed');
          await this.assertFresh(ticket.frame, binding.observationRevision);
          if (dispatchAllowed && !dispatchAllowed()) throw new Error('session_unavailable');
          await this.page.keyboard.press(String(action.payload?.key ?? ''));
          break;
        }
        case 'type':
        case 'select': {
          const handle = ticket.handle;
          if (!handle) throw new Error('target_binding_required');
          const fresh = await readField(handle);
          if (!(await handle.isVisible()) || canonical(fresh) !== expected)
            throw new Error('target_changed');
          if (action.kind === 'type') {
            await this.assertFresh(ticket.frame, binding.observationRevision);
            if (dispatchAllowed && !dispatchAllowed()) throw new Error('session_unavailable');
            await handle.fill(String(action.payload?.text ?? ''), { timeout });
            break;
          }
          const text = String(action.payload?.text ?? '');
          const options = (await handle.evaluate((el: Element) =>
            Array.from((el as HTMLSelectElement).options || [])
              .filter((option) => !option.disabled)
              .map((option) => ({ label: option.label, value: option.value })),
          )) as Array<{ label: string; value: string }>;
          const matching = options.filter(
            (option) => option.label === text || option.value === text,
          );
          if (matching.length !== 1 || !matching[0]) throw new Error('target_ambiguous');
          await this.assertFresh(ticket.frame, binding.observationRevision);
          if (dispatchAllowed && !dispatchAllowed()) throw new Error('session_unavailable');
          await handle.selectOption(matching[0], { timeout });
          break;
        }
        default:
          throw new Error('unsupported_action');
      }
    } finally {
      if (ticket.nativeChooserId) await this.clearNativeChooser(ticket.nativeChooserId);
      else await ticket.handle?.dispose();
    }
  }
  async scroll(deltaX: number, deltaY: number): Promise<void> {
    this.assertAvailable();
    this.origin(this.page.mainFrame());
    await this.page.mouse.wheel(deltaX, deltaY);
  }
}
function locatorFor(frame: Frame, scope: Locator | null, spec: LocatorSpec): Locator {
  const root = scope ?? frame;
  switch (spec.how) {
    case 'role':
      return root.getByRole(spec.role as Parameters<typeof root.getByRole>[0], {
        name: spec.name,
        exact: spec.exact,
      });
    case 'text':
      return root.getByText(spec.value, { exact: spec.exact });
    case 'testid':
      return spec.attr === 'data-testid'
        ? root.getByTestId(spec.value)
        : root.locator(`[${spec.attr}="${spec.value.replace(/[\\"]/g, '\\$&')}"]`);
    case 'css':
      return root.locator(spec.value);
    case 'xpath':
      return root.locator(`xpath=${spec.value}`);
    case 'label':
      return root.getByLabel(spec.value, { exact: spec.exact });
    case 'placeholder':
      return root.getByPlaceholder(spec.value);
  }
}
