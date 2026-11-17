import {
  type DriverAction,
  type DriverResult,
  TaskFileTransfer,
  type VerifiedTaskFile,
} from '@holaday/browser-driver';
import {
  type BrowserUploadOutcome,
  type SelectedChromeChooserCommand,
  type SelectedChromeDownloadCommand,
  type SelectedChromeUploadAction,
  type SelectedChromeUploadCommand,
  USER_BROWSER_ACTIVITY_CAPABILITY,
  USER_BROWSER_CHOOSER_CAPABILITY,
  USER_BROWSER_DOWNLOAD_CAPABILITY,
  USER_BROWSER_PROTOCOL,
  USER_BROWSER_UPLOAD_CAPABILITY,
  type UserBrowserActivity,
  type UserBrowserBinding,
  type UserBrowserChooserState,
  type UserBrowserDownloadChunk,
  type UserBrowserDownloadState,
  type UserBrowserProtocol,
  type UserBrowserTargetDescription,
  type UserBrowserUploadState,
  selectedChromeDownloadCommandSchema,
  userBrowserActivitySchema,
  userBrowserChooserFailureSchema,
  userBrowserChooserStateSchema,
  userBrowserDownloadStateSchema,
  userBrowserTargetDescriptionSchema,
} from '@holaday/shared-types';

export interface SelectedChromeDriver {
  attachExistingTab(): Promise<DriverResult>;
  observeCurrentPage(): Promise<DriverResult>;
  execute(action: DriverAction): Promise<DriverResult>;
  describeTarget?(action: DriverAction, revision: number): Promise<DriverResult>;
  executeBound?(
    action: DriverAction,
    binding: UserBrowserBinding,
    dispatchAllowed?: () => boolean,
  ): Promise<DriverResult>;
  readActivity?(): Promise<DriverResult>;
  captureFileChooserBound?(
    action: DriverAction,
    binding: UserBrowserBinding,
    dispatchAllowed: () => boolean,
    signal?: AbortSignal,
  ): Promise<DriverResult>;
  captureDownloadBound?(
    action: DriverAction,
    binding: UserBrowserBinding,
    dispatchAllowed: () => boolean,
    signal?: AbortSignal,
  ): Promise<DriverResult>;
  readDownloadChunk?(
    id: string,
    offset: number,
    length: number,
    current: () => boolean,
  ): Promise<DriverResult>;
  releaseDownload?(id: string): void;
  uploadBound?(
    action: DriverAction,
    binding: UserBrowserBinding,
    files: readonly VerifiedTaskFile[],
    dispatchAllowed: () => boolean,
  ): Promise<DriverResult>;
  dispose(): Promise<void>;
}

export type SessionReply =
  | {
      ok: true;
      sessionId: string;
      observation?: unknown;
      activity?: UserBrowserActivity;
      target?: UserBrowserTargetDescription;
      protocol?: UserBrowserProtocol;
      tabs?: Array<{ tabId: number; origin: string; ownership: 'selected' | 'task' }>;
      actionOutcome?: 'applied' | 'not_applied';
      uploadState?: UserBrowserUploadState;
      chooserState?: UserBrowserChooserState;
      downloadState?: UserBrowserDownloadState;
      downloadChunk?: UserBrowserDownloadChunk;
      downloadReleased?: string;
    }
  | { ok: false; error: string; actionOutcome?: 'applied' | 'not_applied' | 'unknown' };

interface Entry {
  id: string;
  taskId: string;
  tabId: number;
  owner: string | null;
  driver: SelectedChromeDriver | null;
  stopped: boolean;
  quarantined: boolean;
  ready: boolean;
  pending: Promise<SessionReply> | null;
  disposal?: Promise<void>;
  /** The session's tab was closed (chrome.tabs.onRemoved). */
  tabClosed: boolean;
  v2: boolean;
  collaborationV2: boolean;
  uploadsEnabled: boolean;
  choosersEnabled: boolean;
  downloadsEnabled: boolean;
  downloadAbort?: AbortController;
  download?: {
    id: string;
    driver: SelectedChromeDriver;
    tabId: number;
    sizeBytes: number;
    expiresAt: number;
  };
  releasedDownloads: string[];
  chooserAbort?: AbortController;
  uploadsStopped: boolean;
  uploadTransfer?: TaskFileTransfer;
  uploadPrepared?: {
    driver: SelectedChromeDriver;
    tabId: number;
    action: SelectedChromeUploadAction;
    target: UserBrowserTargetDescription;
  };
  uploadBindings: Map<
    string,
    {
      driver: SelectedChromeDriver;
      tabId: number;
      action: SelectedChromeUploadAction;
      binding: UserBrowserBinding;
    }
  >;
  uploadBegins: Map<string, { fingerprint: string; transferId: string }>;
  activityBaseline?: string;
  origins: readonly string[];
  tabs: Map<
    number,
    { driver: SelectedChromeDriver | null; origin: string; ownership: 'selected' | 'task' }
  >;
}

const SUPPORTED = new Set(['click', 'type', 'key', 'goto', 'wait']);
const BOUND_KINDS = new Set(['click', 'type', 'key', 'select']);
const NOT_APPLIED = new Set([
  'SELECTOR_NOT_FOUND',
  'SELECTOR_MISSING',
  'PAYLOAD_MISSING',
  'ORIGIN_BLOCKED',
  'NOT_ATTACHED',
  'target_binding_required',
  'target_changed',
  'stale_observation',
  'target_ambiguous',
  'target_missing',
  'target_unreadable',
  'target_obscured',
  'origin_grant_required',
  'capability_missing',
  'human_input_active',
  'activity_unavailable',
  'file_manifest_invalid',
  'file_payload_invalid',
  'file_target_forbidden',
  'session_unavailable',
]);

/** One local Chrome execution seat; the native CRX driver owns selectors. */
export class SelectedChromeSession {
  private entry: Entry | null = null;
  constructor(
    private readonly deps: {
      makeDriver: (
        tabId: number,
        options?: { v2: boolean; origins: readonly string[]; collaborationV2?: true },
      ) => SelectedChromeDriver;
      newTab?: (url: string) => Promise<number>;
      owner: () => string | null;
    },
  ) {}

  async open(input: {
    taskId: string;
    tabId: number;
    validate: () => Promise<void>;
    protocol?: UserBrowserProtocol;
    grantedOrigins?: readonly string[];
    ownership?: 'selected' | 'task';
  }): Promise<SessionReply> {
    if (this.entry) return { ok: false, error: 'browser_busy' };
    const owner = this.deps.owner();
    if (!owner) return { ok: false, error: 'session_unavailable' };
    const entry: Entry = {
      id: crypto.randomUUID(),
      taskId: input.taskId,
      tabId: input.tabId,
      owner,
      driver: null,
      stopped: false,
      quarantined: false,
      ready: false,
      pending: null,
      tabClosed: false,
      v2: Boolean(input.protocol),
      collaborationV2: Boolean(
        input.protocol?.capabilities.includes(USER_BROWSER_ACTIVITY_CAPABILITY),
      ),
      uploadsEnabled: false,
      choosersEnabled: false,
      downloadsEnabled: false,
      releasedDownloads: [],
      uploadsStopped: false,
      uploadBindings: new Map(),
      uploadBegins: new Map(),
      origins: input.grantedOrigins ?? [],
      tabs: new Map(),
    };
    this.entry = entry;
    const result = await this.track(entry, async () => {
      if (!this.current(entry)) return { ok: false, error: 'session_unavailable' };
      try {
        await input.validate();
      } catch {
        return { ok: false, error: 'target_changed' };
      }
      if (!this.current(entry)) return { ok: false, error: 'session_unavailable' };
      if (entry.v2 && !entry.origins.length) return { ok: false, error: 'origin_grant_required' };
      entry.driver = entry.v2
        ? this.deps.makeDriver(input.tabId, {
            v2: true,
            origins: entry.origins,
            ...(entry.collaborationV2 ? { collaborationV2: true as const } : {}),
          })
        : this.deps.makeDriver(input.tabId);
      if (entry.v2 && (!entry.driver.describeTarget || !entry.driver.executeBound))
        return { ok: false, error: 'capability_missing' };
      if (entry.collaborationV2 && !entry.driver.readActivity)
        return { ok: false, error: 'capability_missing' };
      entry.uploadsEnabled = Boolean(
        input.protocol?.capabilities.includes(USER_BROWSER_UPLOAD_CAPABILITY) &&
          entry.driver.uploadBound,
      );
      entry.choosersEnabled = Boolean(
        entry.uploadsEnabled &&
          input.protocol?.capabilities.includes(USER_BROWSER_CHOOSER_CAPABILITY) &&
          entry.driver.captureFileChooserBound,
      );
      entry.downloadsEnabled = Boolean(
        input.protocol?.capabilities.includes(USER_BROWSER_DOWNLOAD_CAPABILITY) &&
          entry.driver.captureDownloadBound &&
          entry.driver.readDownloadChunk &&
          entry.driver.releaseDownload,
      );
      entry.tabs.set(input.tabId, {
        driver: entry.driver,
        origin: entry.origins[0] ?? '',
        ownership: input.ownership ?? 'selected',
      });
      const attached = await entry.driver.attachExistingTab();
      if (attached.status !== 'ok')
        return {
          ok: false,
          error:
            attached.error?.code === 'ORIGIN_BLOCKED' ? 'origin_grant_required' : 'attach_failed',
        };
      if (!identifiesTab(attached.data, entry.tabId)) return { ok: false, error: 'target_changed' };
      if (!this.current(entry)) return { ok: false, error: 'session_unavailable' };
      // Do not let a page change or account switch during attachment select a
      // different document for the first action.
      try {
        await input.validate();
      } catch {
        return { ok: false, error: 'target_changed' };
      }
      if (!this.current(entry)) return { ok: false, error: 'session_unavailable' };
      const observed = await this.observeEntry(entry);
      if (observed.ok) entry.ready = true;
      return observed;
    });
    if (!result.ok) await this.stopTask(input.taskId);
    return result;
  }

  /** Called from chrome.tabs.onRemoved: later actions fail fast with tab_closed. */
  markTabClosed(tabId: number): void {
    if (this.entry && this.entry.tabId === tabId) {
      this.entry.tabClosed = true;
      this.entry.chooserAbort?.abort();
      this.entry.downloadAbort?.abort();
      this.clearDownload(this.entry);
    }
  }

  async observe(taskId: string, sessionId: string): Promise<SessionReply> {
    const entry = this.find(taskId, sessionId);
    if (!entry) return { ok: false, error: 'session_unavailable' };
    if (entry.pending) return { ok: false, error: 'browser_busy' };
    if (entry.quarantined)
      return { ok: false, error: 'input_outcome_unknown', actionOutcome: 'unknown' };
    return this.track(entry, () => this.observeEntry(entry));
  }

  async activity(taskId: string, sessionId: string): Promise<SessionReply> {
    const entry = this.find(taskId, sessionId);
    if (!entry) return { ok: false, error: 'session_unavailable' };
    if (!entry.collaborationV2) return { ok: false, error: 'capability_missing' };
    if (entry.pending) return { ok: false, error: 'browser_busy' };
    return this.track(entry, async () => {
      const activity = await this.readActivity(entry);
      return activity
        ? { ok: true, sessionId: entry.id, activity }
        : { ok: false, error: entry.tabClosed ? 'tab_closed' : 'activity_unavailable' };
    });
  }

  private async readActivity(entry: Entry): Promise<UserBrowserActivity | null> {
    if (!this.current(entry) || entry.tabClosed || entry.quarantined) return null;
    let result: DriverResult | undefined;
    try {
      result = await entry.driver?.readActivity?.();
    } catch {
      return null;
    }
    const parsed = userBrowserActivitySchema.safeParse(result?.data);
    return this.current(entry) &&
      !entry.tabClosed &&
      result?.status === 'ok' &&
      parsed.success &&
      parsed.data.tabId === entry.tabId
      ? parsed.data
      : null;
  }
  private async nativeGate(entry: Entry): Promise<SessionReply | null> {
    if (!entry.collaborationV2) return null;
    const activity = await this.readActivity(entry);
    if (!activity)
      return { ok: false, error: 'activity_unavailable', actionOutcome: 'not_applied' };
    if (activity.keys || activity.pointers || activity.composing || activity.interrupted)
      return { ok: false, error: 'human_input_active', actionOutcome: 'not_applied' };
    if (activity.stamp !== entry.activityBaseline)
      return { ok: false, error: 'stale_observation', actionOutcome: 'not_applied' };
    return null;
  }

  private invalidateUploadTargets(entry: Entry): void {
    entry.uploadPrepared = undefined;
    for (const id of entry.uploadBindings.keys()) {
      try {
        if (entry.uploadTransfer?.abort(id) === false) continue;
      } catch {
        /* expired or already settled */
      }
      entry.uploadBindings.delete(id);
    }
  }

  private async deliverUpload(
    entry: Entry,
    files: readonly VerifiedTaskFile[],
    id: string,
  ): Promise<BrowserUploadOutcome> {
    const bound = entry.uploadBindings.get(id);
    if (
      !bound ||
      !this.current(entry) ||
      entry.uploadsStopped ||
      entry.tabClosed ||
      entry.quarantined ||
      bound.driver !== entry.driver ||
      bound.tabId !== entry.tabId ||
      !bound.driver.uploadBound
    )
      return { status: 'not_applied', reason: 'target_changed' };
    const native = await this.nativeGate(entry);
    if (native && !native.ok) return { status: 'not_applied', reason: native.error };
    if (!this.current(entry) || entry.driver !== bound.driver || entry.tabId !== bound.tabId)
      return { status: 'not_applied', reason: 'session_unavailable' };
    const result = await bound.driver.uploadBound(
      bound.action,
      bound.binding,
      files,
      () =>
        this.current(entry) &&
        !entry.uploadsStopped &&
        !entry.tabClosed &&
        !entry.quarantined &&
        entry.driver === bound.driver &&
        entry.tabId === bound.tabId,
    );
    if (result.status === 'ok') return { status: 'handed_to_page' };
    const reason = result.error?.code ?? 'input_outcome_unknown';
    return NOT_APPLIED.has(reason)
      ? { status: 'not_applied', reason }
      : { status: 'unknown', reason: 'input_outcome_unknown' };
  }

  async upload(taskId: string, command: SelectedChromeUploadCommand): Promise<SessionReply> {
    const entry = this.find(taskId, command.sessionId);
    if (!entry) return { ok: false, error: 'session_unavailable' };
    if (!entry.uploadsEnabled || !entry.driver?.uploadBound)
      return { ok: false, error: 'capability_missing' };
    if ('action' in command && command.action.payload.chooserId && !entry.choosersEnabled)
      return { ok: false, error: 'capability_missing' };
    if (entry.uploadsStopped) return { ok: false, error: 'session_unavailable' };
    if (entry.pending) return { ok: false, error: 'browser_busy' };
    if (entry.tabClosed) return { ok: false, error: 'tab_closed' };
    if (entry.quarantined && command.op !== 'upload_commit')
      return { ok: false, error: 'input_outcome_unknown', actionOutcome: 'unknown' };
    return this.track(
      entry,
      async () => {
        if (!this.current(entry)) return { ok: false, error: 'session_unavailable' };
        try {
          if (command.op === 'upload_describe') {
            if (!entry.ready) return { ok: false, error: 'observation_required' };
            this.invalidateUploadTargets(entry);
            const driver = entry.driver;
            if (!driver?.describeTarget) return { ok: false, error: 'capability_missing' };
            const result = await driver.describeTarget(command.action, command.observationRevision);
            if (!this.current(entry) || driver !== entry.driver)
              return { ok: false, error: 'session_unavailable' };
            if (result.status !== 'ok')
              return { ok: false, error: result.error?.code ?? 'target_unreadable' };
            const target = userBrowserTargetDescriptionSchema.safeParse(result.data);
            if (
              !target.success ||
              !target.data.fileInput ||
              target.data.tabId !== entry.tabId ||
              target.data.observationRevision !== command.observationRevision ||
              !entry.origins.includes(target.data.origin)
            )
              return { ok: false, error: 'target_unreadable' };
            entry.uploadPrepared = {
              driver,
              tabId: entry.tabId,
              action: command.action,
              target: target.data,
            };
            return { ok: true, sessionId: entry.id, target: target.data };
          }
          if (command.op === 'upload_begin') {
            const fingerprint = JSON.stringify([command.action, command.binding]);
            const previous = entry.uploadBegins.get(command.binding.token);
            if (previous)
              return previous.fingerprint === fingerprint
                ? {
                    ok: true,
                    sessionId: entry.id,
                    uploadState: { phase: 'begun', transferId: previous.transferId },
                  }
                : { ok: false, error: 'target_binding_required' };
            const prepared = entry.uploadPrepared;
            if (
              !entry.ready ||
              !prepared ||
              prepared.driver !== entry.driver ||
              prepared.tabId !== entry.tabId ||
              prepared.target.token !== command.binding.token ||
              prepared.target.observationRevision !== command.binding.observationRevision ||
              JSON.stringify(prepared.action) !== JSON.stringify(command.action)
            )
              return { ok: false, error: 'target_binding_required' };
            const native = await this.nativeGate(entry);
            if (native) return native;
            if (!this.current(entry)) return { ok: false, error: 'session_unavailable' };
            entry.uploadTransfer ??= new TaskFileTransfer({
              active: () => this.current(entry) && !entry.uploadsStopped && !entry.tabClosed,
              deliver: (files, id) => this.deliverUpload(entry, files, id),
            });
            const { transferId } = entry.uploadTransfer.begin(command.action.payload.files);
            entry.uploadBindings.set(transferId, {
              driver: prepared.driver,
              tabId: prepared.tabId,
              action: command.action,
              binding: command.binding,
            });
            entry.uploadBegins.set(command.binding.token, { fingerprint, transferId });
            while (entry.uploadBegins.size > 8)
              entry.uploadBegins.delete(entry.uploadBegins.keys().next().value!);
            entry.uploadPrepared = undefined;
            return { ok: true, sessionId: entry.id, uploadState: { phase: 'begun', transferId } };
          }
          if (!entry.uploadTransfer) return { ok: false, error: 'transfer_unavailable' };
          if (command.op === 'upload_chunk') {
            const { op: _op, sessionId: _session, ...part } = command;
            const progress = entry.uploadTransfer.append(part);
            return {
              ok: true,
              sessionId: entry.id,
              uploadState: { phase: 'progress', ...progress },
            };
          }
          if (command.op === 'upload_abort') {
            if (!entry.uploadTransfer.abort(command.transferId))
              return { ok: false, error: 'input_outcome_unknown', actionOutcome: 'unknown' };
            entry.uploadBindings.delete(command.transferId);
            return {
              ok: true,
              sessionId: entry.id,
              uploadState: { phase: 'aborted', transferId: command.transferId },
            };
          }
          const receipt = await entry.uploadTransfer.commit(command.transferId);
          entry.uploadBindings.delete(command.transferId);
          if (!this.current(entry))
            return {
              ok: false,
              error: 'session_stopped',
              ...(receipt.status === 'not_applied'
                ? { actionOutcome: 'not_applied' as const }
                : { actionOutcome: 'unknown' as const }),
            };
          const observed = await this.observeEntry(entry);
          if (receipt.status === 'unknown') {
            entry.quarantined = true;
            entry.ready = false;
          }
          return {
            ...(observed.ok ? observed : { ok: true as const, sessionId: entry.id }),
            uploadState: { phase: 'finished', receipt },
          };
        } catch (error) {
          const reason = error instanceof Error ? error.message : '';
          const known = [
            'invalid_manifest',
            'invalid_chunk',
            'transfer_unavailable',
            'transfer_busy',
            'scope_unavailable',
            'offset_mismatch',
            'chunk_mismatch',
            'file_incomplete',
            'file_hash_mismatch',
            'upload_outcome_unknown',
          ];
          if (known.includes(reason))
            return {
              ok: false,
              error: reason,
              ...(command.op === 'upload_commit' ? { actionOutcome: 'not_applied' as const } : {}),
            };
          throw error;
        }
      },
      command.op === 'upload_commit',
    );
  }

  async execute(
    taskId: string,
    sessionId: string,
    action: DriverAction,
    binding?: UserBrowserBinding,
  ): Promise<SessionReply> {
    const entry = this.find(taskId, sessionId);
    if (!entry) return { ok: false, error: 'session_unavailable' };
    if (entry.quarantined)
      return { ok: false, error: 'input_outcome_unknown', actionOutcome: 'unknown' };
    if (entry.pending) return { ok: false, error: 'browser_busy' };
    if (entry.tabClosed) return { ok: false, error: 'tab_closed', actionOutcome: 'not_applied' };
    if (!entry.ready) return { ok: false, error: 'observation_required' };
    if (entry.uploadsStopped && BOUND_KINDS.has(action.kind))
      return { ok: false, error: 'session_unavailable', actionOutcome: 'not_applied' };
    if (entry.v2 && BOUND_KINDS.has(action.kind) && !binding)
      return { ok: false, error: 'target_binding_required', actionOutcome: 'not_applied' };
    if (
      entry.v2 &&
      action.kind === 'goto' &&
      !entry.origins.includes(webOrigin(action.payload?.url))
    )
      return { ok: false, error: 'origin_grant_required', actionOutcome: 'not_applied' };
    if (!SUPPORTED.has(action.kind) && !(entry.v2 && ['scroll', 'select'].includes(action.kind)))
      return { ok: false, error: 'unsupported_action', actionOutcome: 'not_applied' };
    if (action.kind === 'goto' && !isWebNavigation(action.payload?.url))
      return { ok: false, error: 'invalid_url', actionOutcome: 'not_applied' };
    return this.track(
      entry,
      async () => {
        if (!this.current(entry) || !entry.driver)
          return { ok: false, error: 'session_unavailable', actionOutcome: 'not_applied' };
        const native = await this.nativeGate(entry);
        if (native) return native;
        if (
          !this.current(entry) ||
          !entry.driver ||
          (entry.uploadsStopped && BOUND_KINDS.has(action.kind))
        )
          return { ok: false, error: 'session_unavailable', actionOutcome: 'not_applied' };
        const driver = entry.driver;
        const tabId = entry.tabId;
        let result: DriverResult;
        try {
          result =
            entry.v2 && BOUND_KINDS.has(action.kind) && binding && driver.executeBound
              ? await driver.executeBound(
                  action,
                  binding,
                  () =>
                    this.current(entry) &&
                    !entry.uploadsStopped &&
                    !entry.tabClosed &&
                    !entry.quarantined &&
                    entry.driver === driver &&
                    entry.tabId === tabId,
                )
              : await driver.execute(action);
        } catch (error) {
          if (action.kind === 'wait')
            return { ok: false, error: 'wait_failed', actionOutcome: 'not_applied' };
          throw error;
        }
        if (result.status !== 'ok') {
          if (action.kind === 'wait')
            return { ok: false, error: 'wait_failed', actionOutcome: 'not_applied' };
          if (result.error && NOT_APPLIED.has(result.error.code)) {
            // A selector "not found" because the tab went away is a closed tab, not a page change.
            return {
              ok: false,
              error: entry.tabClosed ? 'tab_closed' : result.error.code,
              actionOutcome: 'not_applied',
            };
          }
          entry.quarantined = true;
          return { ok: false, error: 'input_outcome_unknown', actionOutcome: 'unknown' };
        }
        const actionOutcome =
          action.kind === 'wait' ? ('not_applied' as const) : ('applied' as const);
        if (!this.current(entry)) return { ok: false, error: 'session_stopped', actionOutcome };
        let observed = await this.observeEntry(entry);
        if (
          entry.v2 &&
          !observed.ok &&
          observed.error === 'observation_failed' &&
          this.current(entry) &&
          !entry.tabClosed
        ) {
          // Wheel/input delivery can precede its DOM update. Retry only the read, once;
          // the actual action is already settled and must never be replayed.
          observed = await this.observeEntry(entry);
        }
        return { ...observed, actionOutcome };
      },
      true,
    );
  }

  private clearDownload(entry: Entry): boolean {
    const held = entry.download;
    if (!held) return true;
    try {
      held.driver.releaseDownload?.(held.id);
      entry.download = undefined;
      return true;
    } catch {
      entry.quarantined = true;
      entry.ready = false;
      return false;
    }
  }

  private rememberDownloadRelease(entry: Entry, id: string): void {
    if (entry.releasedDownloads.includes(id)) return;
    entry.releasedDownloads.push(id);
    if (entry.releasedDownloads.length > 8) entry.releasedDownloads.shift();
  }

  async download(taskId: string, input: SelectedChromeDownloadCommand): Promise<SessionReply> {
    const parsedCommand = selectedChromeDownloadCommandSchema.safeParse(input);
    const refused = (error: string): SessionReply => ({
      ok: false,
      error,
      ...(input.op === 'download_open' ? { actionOutcome: 'not_applied' as const } : {}),
    });
    if (!parsedCommand.success) return refused('invalid_session_command');
    const command = parsedCommand.data;
    const entry = this.find(taskId, command.sessionId);
    if (!entry) return refused('session_unavailable');
    if (
      !entry.downloadsEnabled ||
      !entry.driver?.captureDownloadBound ||
      !entry.driver.readDownloadChunk ||
      !entry.driver.releaseDownload
    )
      return refused('capability_missing');
    if (entry.pending) return refused('browser_busy');
    if (entry.uploadsStopped) return refused('session_unavailable');
    if (entry.tabClosed) return refused('tab_closed');
    if (entry.quarantined)
      return {
        ok: false,
        error: 'input_outcome_unknown',
        ...(command.op === 'download_open' ? { actionOutcome: 'unknown' as const } : {}),
      };
    if (entry.download && Date.now() >= entry.download.expiresAt) {
      const id = entry.download.id;
      if (!this.clearDownload(entry)) return refused('session_unavailable');
      this.rememberDownloadRelease(entry, id);
    }
    if (command.op === 'download_open' && !entry.ready) return refused('observation_required');
    if (command.op === 'download_open' && entry.download) return refused('browser_busy');
    return this.track(
      entry,
      async () => {
        const driver = entry.driver;
        const tabId = entry.tabId;
        const current = () =>
          this.current(entry) &&
          !entry.uploadsStopped &&
          !entry.tabClosed &&
          !entry.quarantined &&
          entry.driver === driver &&
          entry.tabId === tabId;
        if (!current() || !driver) return refused('session_unavailable');
        if (command.op === 'download_release') {
          if (entry.releasedDownloads.includes(command.downloadId))
            return { ok: true, sessionId: entry.id, downloadReleased: command.downloadId };
          if (entry.download?.id !== command.downloadId) return refused('download_unavailable');
          if (!this.clearDownload(entry)) return refused('download_unavailable');
          this.rememberDownloadRelease(entry, command.downloadId);
          return { ok: true, sessionId: entry.id, downloadReleased: command.downloadId };
        }
        if (command.op === 'download_read') {
          const held = entry.download;
          if (
            !held ||
            held.id !== command.downloadId ||
            held.driver !== driver ||
            held.tabId !== tabId ||
            command.offset > held.sizeBytes
          )
            return refused('download_unavailable');
          const allowed = () => current() && entry.download === held && Date.now() < held.expiresAt;
          const result = await driver.readDownloadChunk!(
            held.id,
            command.offset,
            command.length,
            allowed,
          );
          const bytes = (result.data as { bytes?: unknown } | undefined)?.bytes;
          if (!(bytes instanceof Uint8Array)) return refused('download_unavailable');
          try {
            if (!allowed()) return refused('session_unavailable');
            if (
              result.status !== 'ok' ||
              bytes.length !== Math.min(command.length, held.sizeBytes - command.offset)
            )
              return refused('download_unavailable');
            let binary = '';
            for (let offset = 0; offset < bytes.length; offset += 8192)
              binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
            return {
              ok: true,
              sessionId: entry.id,
              downloadChunk: {
                downloadId: held.id,
                offset: command.offset,
                data: btoa(binary),
                eof: command.offset + bytes.length === held.sizeBytes,
              },
            };
          } finally {
            bytes.fill(0);
          }
        }
        const native = await this.nativeGate(entry);
        if (native) return native;
        if (!current()) return refused('session_unavailable');
        this.invalidateUploadTargets(entry);
        entry.ready = false;
        const abort = new AbortController();
        entry.downloadAbort = abort;
        let result: DriverResult;
        try {
          result = await driver.captureDownloadBound!(
            command.action,
            command.binding,
            current,
            abort.signal,
          );
        } finally {
          if (entry.downloadAbort === abort) entry.downloadAbort = undefined;
        }
        if (result.status !== 'ok') {
          const failure = userBrowserChooserFailureSchema.safeParse(result.data);
          const actionOutcome = failure.success ? failure.data.clickOutcome : 'unknown';
          if (!failure.success || !failure.data.interceptionRestored || actionOutcome === 'unknown')
            entry.quarantined = true;
          return { ok: false, error: result.error?.code ?? 'input_outcome_unknown', actionOutcome };
        }
        const parsed = userBrowserDownloadStateSchema.safeParse(result.data);
        if (
          !parsed.success ||
          (parsed.data.status === 'captured' && !entry.origins.includes(parsed.data.source.origin))
        ) {
          entry.quarantined = true;
          return { ok: false, error: 'input_outcome_unknown', actionOutcome: 'unknown' };
        }
        const state = parsed.data;
        if (!current()) {
          if (state.status === 'captured') driver.releaseDownload!(state.downloadId);
          return { ok: false, error: 'session_stopped', actionOutcome: state.clickOutcome };
        }
        if (state.status === 'captured')
          entry.download = {
            id: state.downloadId,
            driver,
            tabId,
            sizeBytes: state.metadata.sizeBytes,
            expiresAt: Date.now() + 120_000,
          };
        const observed = await this.observeEntry(entry);
        if (!current()) {
          this.clearDownload(entry);
          return { ok: false, error: 'session_stopped', actionOutcome: state.clickOutcome };
        }
        return {
          ...(observed.ok ? observed : { ok: true as const, sessionId: entry.id }),
          downloadState: state,
          actionOutcome: state.clickOutcome,
        };
      },
      command.op === 'download_open',
    );
  }

  async openChooser(taskId: string, command: SelectedChromeChooserCommand): Promise<SessionReply> {
    const entry = this.find(taskId, command.sessionId);
    const refused = (error: string): SessionReply => ({
      ok: false,
      error,
      actionOutcome: 'not_applied',
    });
    if (!entry) return refused('session_unavailable');
    if (!entry.choosersEnabled || !entry.driver?.captureFileChooserBound)
      return refused('capability_missing');
    if (entry.quarantined)
      return { ok: false, error: 'input_outcome_unknown', actionOutcome: 'unknown' };
    if (entry.pending) return refused('browser_busy');
    if (entry.uploadsStopped) return refused('session_unavailable');
    if (entry.tabClosed) return refused('tab_closed');
    if (!entry.ready) return refused('observation_required');
    return this.track(
      entry,
      async () => {
        const driver = entry.driver;
        const tabId = entry.tabId;
        const current = () =>
          this.current(entry) &&
          !entry.uploadsStopped &&
          !entry.tabClosed &&
          !entry.quarantined &&
          entry.driver === driver &&
          entry.tabId === tabId;
        if (!current() || !driver?.captureFileChooserBound) return refused('session_unavailable');
        const native = await this.nativeGate(entry);
        if (native) return native;
        if (!current()) return refused('session_unavailable');
        this.invalidateUploadTargets(entry);
        const abort = new AbortController();
        entry.chooserAbort = abort;
        let result: DriverResult;
        try {
          result = await driver.captureFileChooserBound(
            command.action,
            command.binding,
            current,
            abort.signal,
          );
        } finally {
          if (entry.chooserAbort === abort) entry.chooserAbort = undefined;
        }
        if (result.status !== 'ok') {
          const parsed = userBrowserChooserFailureSchema.safeParse(result.data);
          const actionOutcome = parsed.success ? parsed.data.clickOutcome : 'unknown';
          if (!parsed.success || !parsed.data.interceptionRestored || actionOutcome === 'unknown') {
            entry.quarantined = true;
            entry.ready = false;
          }
          return { ok: false, error: result.error?.code ?? 'input_outcome_unknown', actionOutcome };
        }
        const parsed = userBrowserChooserStateSchema.safeParse(result.data);
        if (!parsed.success) {
          entry.quarantined = true;
          entry.ready = false;
          return { ok: false, error: 'input_outcome_unknown', actionOutcome: 'unknown' };
        }
        if (!current())
          return { ok: false, error: 'session_stopped', actionOutcome: parsed.data.clickOutcome };
        const observed = await this.observeEntry(entry);
        if (!current())
          return { ok: false, error: 'session_stopped', actionOutcome: parsed.data.clickOutcome };
        return {
          ...(observed.ok ? observed : { ok: true as const, sessionId: entry.id }),
          chooserState: parsed.data,
          actionOutcome: parsed.data.clickOutcome,
        };
      },
      true,
    );
  }

  async describe(
    taskId: string,
    sessionId: string,
    action: DriverAction,
    revision: number,
  ): Promise<SessionReply> {
    const entry = this.find(taskId, sessionId);
    if (!entry) return { ok: false, error: 'session_unavailable' };
    if (!entry.v2 || !entry.driver?.describeTarget)
      return { ok: false, error: 'capability_missing' };
    if (entry.pending) return { ok: false, error: 'browser_busy' };
    if (!entry.ready || entry.quarantined) return { ok: false, error: 'observation_required' };
    return this.track(entry, async () => {
      const driver = entry.driver;
      if (!driver?.describeTarget) return { ok: false, error: 'capability_missing' };
      const result = await driver.describeTarget(action, revision);
      return result.status === 'ok'
        ? { ok: true, sessionId: entry.id, target: result.data as UserBrowserTargetDescription }
        : { ok: false, error: result.error?.code || 'target_unreadable' };
    });
  }

  async tabs(
    taskId: string,
    sessionId: string,
    command: { operation: 'list' | 'new' | 'switch'; tabId?: number; url?: string },
  ): Promise<SessionReply> {
    const entry = this.find(taskId, sessionId);
    if (!entry) return { ok: false, error: 'session_unavailable' };
    if (entry.quarantined)
      return { ok: false, error: 'input_outcome_unknown', actionOutcome: 'unknown' };
    if (!entry.v2) return { ok: false, error: 'capability_missing' };
    if (entry.pending) return { ok: false, error: 'browser_busy' };
    return this.track(entry, async () => {
      if (command.operation === 'list')
        return {
          ok: true,
          sessionId: entry.id,
          tabs: [...entry.tabs].map(([tabId, tab]) => ({
            tabId,
            origin: tab.origin,
            ownership: tab.ownership,
          })),
        };
      const native = await this.nativeGate(entry);
      if (native) return native;
      let tabId = command.tabId;
      if (command.operation === 'new') {
        if (!command.url || !entry.origins.includes(webOrigin(command.url)))
          return { ok: false, error: 'origin_grant_required' };
        if (!this.deps.newTab) return { ok: false, error: 'capability_missing' };
        if (entry.tabs.size >= 10) return { ok: false, error: 'task_tab_limit' };
        tabId = await this.deps.newTab(command.url);
        entry.tabs.set(tabId, { driver: null, origin: webOrigin(command.url), ownership: 'task' });
      }
      if (tabId === undefined || !entry.tabs.has(tabId))
        return { ok: false, error: 'task_tab_required' };
      const tab = entry.tabs.get(tabId);
      if (!tab) return { ok: false, error: 'task_tab_required' };
      await entry.driver?.dispose();
      if (entry.download) this.rememberDownloadRelease(entry, entry.download.id);
      entry.download = undefined;
      if (!this.current(entry)) return { ok: false, error: 'session_unavailable' };
      tab.driver = this.deps.makeDriver(tabId, {
        v2: true,
        origins: entry.origins,
        ...(entry.collaborationV2 ? { collaborationV2: true as const } : {}),
      });
      entry.driver = tab.driver;
      entry.tabId = tabId;
      entry.tabClosed = false;
      entry.ready = false;
      const attached = await tab.driver.attachExistingTab();
      if (attached.status !== 'ok')
        return {
          ok: false,
          error:
            attached.error?.code === 'ORIGIN_BLOCKED' ? 'origin_grant_required' : 'attach_failed',
        };
      return this.observeEntry(entry);
    });
  }

  /** Session-scoped close for a future authenticated command endpoint. */
  /** The transport's synchronous close fence stops file staging and final bound
   * native dispatch. Normal close still owns operation drain and detach. */
  stopUploadAdmission(taskId: string): void {
    const entry = this.entry;
    if (!entry || entry.taskId !== taskId) return;
    entry.uploadsStopped = true;
    entry.chooserAbort?.abort();
    entry.downloadAbort?.abort();
    this.clearDownload(entry);
    entry.uploadPrepared = undefined;
    entry.uploadTransfer?.dispose();
  }

  async close(taskId: string, sessionId: string): Promise<{ ok: boolean }> {
    if (!this.find(taskId, sessionId)) return { ok: false };
    await this.stopTask(taskId);
    return { ok: true };
  }

  /** Privileged INTERNAL cancellation, also needed after logout. Never expose
   * directly as a client-supplied command; use close(taskId, sessionId) there.
   * Closing admission is immediate; releasing the driver waits for the actual
   * operation, not a timeout race. Caller may time out but must not infer idle. */
  async stopTask(taskId: string): Promise<void> {
    const entry = this.entry;
    if (!entry || entry.taskId !== taskId) return;
    entry.stopped = true;
    this.stopUploadAdmission(taskId);
    await entry.pending;
    entry.disposal ??= Promise.resolve()
      .then(async () => {
        for (const tab of entry.tabs.values()) await tab.driver?.dispose();
      })
      .catch((error) => {
        // Retain the stopped seat and driver handles until cleanup succeeds.
        // A later lifecycle cancellation may retry detach, never the input.
        entry.disposal = undefined;
        throw error;
      });
    await entry.disposal;
    if (this.entry === entry) this.entry = null;
  }

  private current(entry: Entry): boolean {
    return this.entry === entry && !entry.stopped && entry.owner === this.deps.owner();
  }

  private find(taskId: string, sessionId: string): Entry | null {
    const entry = this.entry;
    return entry && this.current(entry) && entry.taskId === taskId && entry.id === sessionId
      ? entry
      : null;
  }

  private async observeEntry(entry: Entry): Promise<SessionReply> {
    this.invalidateUploadTargets(entry);
    entry.ready = false;
    if (!this.current(entry) || !entry.driver) return { ok: false, error: 'session_unavailable' };
    if (entry.tabClosed) return { ok: false, error: 'tab_closed' };
    let result: DriverResult;
    try {
      result = await entry.driver.observeCurrentPage();
    } catch {
      return { ok: false, error: entry.tabClosed ? 'tab_closed' : 'observation_failed' };
    }
    if (!this.current(entry)) return { ok: false, error: 'session_unavailable' };
    if (result.status === 'ok' && !identifiesTab(result.data, entry.tabId))
      return { ok: false, error: 'target_changed' };
    if (entry.collaborationV2 && result.status === 'ok') {
      const parsed = userBrowserActivitySchema.safeParse(
        (result.data as { activity?: unknown })?.activity,
      );
      if (!parsed.success || parsed.data.tabId !== entry.tabId)
        return { ok: false, error: 'activity_unavailable' };
      entry.activityBaseline = parsed.data.stamp;
    }
    entry.ready = result.status === 'ok' && result.data !== undefined;
    return result.status === 'ok' && result.data !== undefined
      ? {
          ok: true,
          sessionId: entry.id,
          observation: result.data,
          ...(entry.v2
            ? {
                tabs: [...entry.tabs].map(([tabId, tab]) => ({
                  tabId,
                  origin: tab.origin,
                  ownership: tab.ownership,
                })),
              }
            : {}),
          ...(entry.v2
            ? {
                protocol: {
                  ...USER_BROWSER_PROTOCOL,
                  capabilities: [
                    ...USER_BROWSER_PROTOCOL.capabilities,
                    ...(entry.collaborationV2 ? [USER_BROWSER_ACTIVITY_CAPABILITY] : []),
                    ...(entry.uploadsEnabled ? [USER_BROWSER_UPLOAD_CAPABILITY] : []),
                    ...(entry.choosersEnabled ? [USER_BROWSER_CHOOSER_CAPABILITY] : []),
                    ...(entry.downloadsEnabled ? [USER_BROWSER_DOWNLOAD_CAPABILITY] : []),
                  ],
                },
              }
            : {}),
        }
      : {
          ok: false,
          error: entry.tabClosed
            ? 'tab_closed'
            : result.error?.code === 'ORIGIN_BLOCKED'
              ? 'origin_grant_required'
              : 'observation_failed',
        };
  }

  private track(
    entry: Entry,
    run: () => Promise<SessionReply>,
    input = false,
  ): Promise<SessionReply> {
    const pending = Promise.resolve()
      .then(run)
      .catch((): SessionReply => {
        if (input) entry.quarantined = true;
        return {
          ok: false,
          error: input ? 'input_outcome_unknown' : 'observation_failed',
          ...(input ? { actionOutcome: 'unknown' as const } : {}),
        };
      })
      .finally(() => {
        if (entry.pending === pending) entry.pending = null;
      });
    entry.pending = pending;
    return pending;
  }
}

function identifiesTab(data: unknown, tabId: number): boolean {
  return typeof data === 'object' && data !== null && 'tabId' in data && data.tabId === tabId;
}

function isWebNavigation(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  try {
    const url = new URL(raw);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

function webOrigin(raw: unknown): string {
  try {
    return new URL(String(raw)).origin;
  } catch {
    return '';
  }
}
