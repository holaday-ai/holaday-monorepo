import { createHash } from 'node:crypto';
import {
  BROWSER_UPLOAD_CHUNK_BYTES,
  type BrowserUploadTransferReceipt,
  type SelectedChromeSessionCommand,
  type SelectedChromeUploadAction,
  type SelectedChromeUploadCommand,
  USER_BROWSER_ACTIVITY_CAPABILITY,
  USER_BROWSER_CHOOSER_CAPABILITY,
  USER_BROWSER_DOWNLOAD_CAPABILITY,
  USER_BROWSER_PROTOCOL,
  USER_BROWSER_UPLOAD_CAPABILITY,
  type UserBrowserActivity,
  type UserBrowserChooserState,
  type UserBrowserDownloadState,
  type UserBrowserTargetDescription,
  selectedChromeUploadActionSchema,
  userBrowserActivitySchema,
  userBrowserChooserStateSchema,
  userBrowserDownloadChunkSchema,
  userBrowserDownloadStateSchema,
  userBrowserProtocolSchema,
  userBrowserTargetDescriptionSchema,
  userBrowserUploadStateSchema,
} from '@holaday/shared-types';
import { z } from 'zod';
import type { ExtensionToolCallOptions, ExtensionToolCallOutcome } from '../../ws/server.js';
import type { BrowserUploadFile } from '../browser-tools/browser-upload-target.js';
import type { BrowserCheckpoint, BrowserControl } from './browser-control.js';

type Action = Extract<SelectedChromeSessionCommand, { op: 'act' }>['action'];
type Target = Extract<SelectedChromeSessionCommand, { op: 'open' }>['target'];
type Options = {
  userId: string;
  taskId: string;
  extensionClientId: string;
  control: BrowserControl;
  routingV2?: boolean;
  collaborationV2?: boolean;
  taskFilesV1?: boolean;
  send: (userId: string, options: ExtensionToolCallOptions) => Promise<ExtensionToolCallOutcome>;
};

const observationSchema = z.object({
  tabId: z.number().int().nonnegative(),
  origin: z
    .string()
    .url()
    .max(2048)
    .regex(/^https?:\/\//),
  title: z.string().max(512),
  bodyText: z.string().max(8000),
  ariaSnapshot: z.string().max(16000),
  truncated: z.boolean(),
  activity: userBrowserActivitySchema.optional(),
  observationRevision: z.number().int().positive().optional(),
  sourceURL: z.string().url().max(2048).optional(),
  capturedAt: z.number().int().positive().optional(),
  frameId: z.string().max(128).optional(),
  frames: z
    .array(
      z.object({
        frameId: z.string().max(128),
        origin: z.string().url(),
        bodyText: z.string().max(2000),
        ariaSnapshot: z.string().max(4000),
      }),
    )
    .max(5)
    .optional(),
});
const failureSchema = z.object({
  ok: z.literal(false),
  error: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_]+$/),
  actionOutcome: z.enum(['applied', 'not_applied', 'unknown']).optional(),
});
const successSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string().uuid(),
  observation: observationSchema,
  actionOutcome: z.enum(['applied', 'not_applied']).optional(),
});
export type SelectedChromeClientReply =
  | {
      ok: true;
      observation?: z.infer<typeof observationSchema>;
      revision?: number;
      actionOutcome?: 'applied' | 'not_applied';
      closed?: true;
      target?: UserBrowserTargetDescription;
      tabs?: Array<{ tabId: number; origin: string; ownership: 'selected' | 'task' }>;
      uploadReceipt?: BrowserUploadTransferReceipt;
      chooserState?: UserBrowserChooserState;
      downloadState?: UserBrowserDownloadState;
    }
  | { ok: false; error: string; actionOutcome?: 'applied' | 'not_applied' | 'unknown' };

type CapturedDownload = Extract<UserBrowserDownloadState, { status: 'captured' }>;
export interface SelectedChromeDownloadFile {
  metadata: CapturedDownload['metadata'];
  source: CapturedDownload['source'];
  buffer: Buffer;
}

/** A browser port, not a fake Playwright Page. Runner checkpoints before
 * planning and carries revision into execute to invalidate pre-handback plans. */
export class SelectedChromeClient {
  private sessionId: string | null = null;
  private extensionRevision = 0;
  private origins: readonly string[] = [];
  private prepared: {
    target: UserBrowserTargetDescription;
    action: string;
    revision: number;
    inputRevision: number;
  } | null = null;
  private nativeBaseline: string | null = null;
  private nativeSeen: string | null = null;
  private readonly nativeSource = {};
  private get nativeActivityEnabled(): boolean {
    return this.routingV2 && this.options.collaborationV2 === true;
  }
  private taskTabs = new Set<number>();
  private uploadNegotiated = false;
  private chooserNegotiated = false;
  private downloadNegotiated = false;
  private download: {
    state: CapturedDownload;
    sessionId: string;
    tabId: number;
    inputRevision: number;
  } | null = null;
  get fileDownloadsEnabled(): boolean {
    return this.routingV2 && this.options.taskFilesV1 === true && this.downloadNegotiated;
  }
  get fileUploadsEnabled(): boolean {
    return this.routingV2 && this.options.taskFilesV1 === true && this.uploadNegotiated;
  }
  get fileChoosersEnabled(): boolean {
    return this.fileUploadsEnabled && this.chooserNegotiated;
  }
  get routingV2(): boolean {
    return this.options.routingV2 === true;
  }
  get grantedOrigins(): readonly string[] {
    return this.origins;
  }
  private tabId: number | null = null;
  private pending: Promise<SelectedChromeClientReply> | null = null;
  private closeAttempt: Promise<SelectedChromeClientReply> | null = null;
  private closing = false;
  private closedReceipt = false;
  private openSent = false;
  private ready = false;
  private revisionValue = 0;
  constructor(private readonly options: Options) {}
  get revision(): number {
    return this.revisionValue;
  }
  get taskId(): string {
    return this.options.taskId;
  }

  async open(target: Target): Promise<SelectedChromeClientReply> {
    if (this.sessionId || this.openSent || this.pending || this.closing)
      return fail('session_unavailable');
    this.tabId = target.tabId;
    this.origins = [new URL(target.expectedUrl).origin];
    this.taskTabs.add(target.tabId);
    return this.track(async () => {
      if (this.closing || !this.options.control.canAgentAct()) return fail('replan_required');
      this.openSent = true;
      return this.accept(
        await this.send({
          op: 'open',
          target,
          ...(this.routingV2
            ? {
                protocol: {
                  ...USER_BROWSER_PROTOCOL,
                  capabilities: [
                    ...USER_BROWSER_PROTOCOL.capabilities,
                    ...(this.nativeActivityEnabled ? [USER_BROWSER_ACTIVITY_CAPABILITY] : []),
                    ...(this.options.taskFilesV1
                      ? [
                          USER_BROWSER_UPLOAD_CAPABILITY,
                          USER_BROWSER_CHOOSER_CAPABILITY,
                          USER_BROWSER_DOWNLOAD_CAPABILITY,
                        ]
                      : []),
                  ],
                },
                grantedOrigins: [...this.origins],
              }
            : {}),
        }),
        'open',
      );
    });
  }

  async execute(action: Action, expectedRevision: number): Promise<SelectedChromeClientReply> {
    if (!this.sessionId || this.closing) return fail('session_unavailable');
    if (this.pending) return fail('browser_busy');
    if (!this.options.control.canAgentAct()) return fail('replan_required');
    if (!this.ready) return fail('observation_required');
    if (expectedRevision !== this.revisionValue) return fail('replan_required');
    return this.track(async () => {
      if (
        !this.sessionId ||
        this.closing ||
        !this.options.control.canAgentAct() ||
        expectedRevision !== this.revisionValue
      )
        return fail('replan_required');
      const prepared = this.prepared;
      this.prepared = null;
      if (
        this.routingV2 &&
        ['click', 'type', 'key', 'select'].includes(action.kind) &&
        (!prepared ||
          prepared.revision !== expectedRevision ||
          prepared.action !== JSON.stringify(action))
      )
        return { ok: false, error: 'target_binding_required', actionOutcome: 'not_applied' };
      return this.accept(
        await this.send({
          op: 'act',
          sessionId: this.sessionId,
          action,
          ...(prepared
            ? {
                binding: {
                  token: prepared.target.token,
                  observationRevision: prepared.target.observationRevision,
                },
              }
            : {}),
        }),
        'act',
        action.kind === 'wait',
      );
    });
  }

  async describe(action: Action, expectedRevision: number): Promise<SelectedChromeClientReply> {
    return this.describeTarget({ op: 'describe', action }, expectedRevision);
  }

  /** One prepared file-button click. A missing receipt is never retransmitted. */
  async openFileChooser(
    action: Action,
    expectedRevision: number,
  ): Promise<SelectedChromeClientReply> {
    const notApplied = (error: string): SelectedChromeClientReply => ({
      ok: false,
      error,
      actionOutcome: 'not_applied',
    });
    if (!this.fileChoosersEnabled) return notApplied('capability_missing');
    if (action.kind !== 'click') return notApplied('unsupported_action');
    if (!this.sessionId || this.closing) return notApplied('session_unavailable');
    if (this.pending) return notApplied('browser_busy');
    if (
      !this.ready ||
      !this.options.control.canAgentAct() ||
      expectedRevision !== this.revisionValue
    )
      return notApplied('replan_required');
    const click = action;
    const sessionId = this.sessionId;
    const inputRevision = this.options.control.inputRevision;
    return this.track(async () => {
      const current = () =>
        !this.closing &&
        this.sessionId === sessionId &&
        this.options.control.canAgentAct() &&
        this.revisionValue === expectedRevision &&
        this.options.control.inputRevision === inputRevision;
      const prepared = this.prepared;
      this.prepared = null;
      if (!current()) return notApplied('replan_required');
      if (
        !prepared ||
        prepared.action !== JSON.stringify(click) ||
        prepared.revision !== expectedRevision
      )
        return notApplied('target_binding_required');
      if (prepared.inputRevision !== inputRevision) {
        this.ready = false;
        return notApplied('replan_required');
      }
      this.ready = false;
      const outcome = await this.send({
        op: 'chooser_open',
        sessionId,
        action: click,
        binding: {
          token: prepared.target.token,
          observationRevision: prepared.target.observationRevision,
        },
      });
      const rejected = failureSchema.safeParse(outcome.result);
      if (
        !outcome.ok &&
        rejected.success &&
        rejected.data.error === 'chooser_restore_unconfirmed'
      ) {
        this.options.control.close('input_outcome_unknown');
        return { ...rejected.data, actionOutcome: rejected.data.actionOutcome ?? 'unknown' };
      }
      if (
        !outcome.ok &&
        outcome.result === undefined &&
        !['target_required', 'invalid_session_command', 'target_extension_unavailable'].includes(
          outcome.error?.code ?? '',
        )
      )
        return this.uncertain('input_outcome_unknown', 'act');
      if (!outcome.ok) return this.accept(outcome, 'act');
      const parsed = z
        .object({
          ok: z.literal(true),
          sessionId: z.literal(sessionId),
          chooserState: userBrowserChooserStateSchema,
          actionOutcome: z.enum(['applied', 'not_applied']),
          observation: observationSchema.optional(),
        })
        .safeParse(outcome.result);
      if (!parsed.success || parsed.data.actionOutcome !== parsed.data.chooserState.clickOutcome)
        return this.uncertain('invalid_receipt', 'act');
      const state = parsed.data.chooserState;
      if (!current())
        return { ok: false, error: 'replan_required', actionOutcome: state.clickOutcome };
      if (!parsed.data.observation)
        return { ok: true, chooserState: state, actionOutcome: state.clickOutcome };
      const fresh = this.accept(outcome, 'observe');
      if (!fresh.ok) return { ...fresh, actionOutcome: fresh.actionOutcome ?? state.clickOutcome };
      // accept() advances the client revision on a valid new observation.
      if (
        this.closing ||
        !this.options.control.canAgentAct() ||
        this.options.control.inputRevision !== inputRevision
      ) {
        this.ready = false;
        return { ok: false, error: 'replan_required', actionOutcome: state.clickOutcome };
      }
      if (!this.fileChoosersEnabled) {
        this.ready = false;
        return { ok: false, error: 'capability_missing', actionOutcome: state.clickOutcome };
      }
      return { ...fresh, chooserState: state, actionOutcome: state.clickOutcome };
    });
  }

  /** One prepared file-button click. A missing receipt is never retransmitted. */
  async openFileDownload(
    action: Action,
    expectedRevision: number,
  ): Promise<SelectedChromeClientReply> {
    const notApplied = (error: string): SelectedChromeClientReply => ({
      ok: false,
      error,
      actionOutcome: 'not_applied',
    });
    if (!this.fileDownloadsEnabled) return notApplied('capability_missing');
    if (action.kind !== 'click') return notApplied('unsupported_action');
    if (!this.sessionId || this.closing) return notApplied('session_unavailable');
    if (this.pending) return notApplied('browser_busy');
    if (
      !this.ready ||
      !this.options.control.canAgentAct() ||
      expectedRevision !== this.revisionValue
    )
      return notApplied('replan_required');
    if (this.download) return notApplied('browser_busy');
    const click = action;
    const sessionId = this.sessionId;
    const inputRevision = this.options.control.inputRevision;
    return this.track(async () => {
      const current = () =>
        !this.closing &&
        this.sessionId === sessionId &&
        this.options.control.canAgentAct() &&
        this.revisionValue === expectedRevision &&
        this.options.control.inputRevision === inputRevision;
      const prepared = this.prepared;
      this.prepared = null;
      if (!current()) return notApplied('replan_required');
      if (
        !prepared ||
        prepared.action !== JSON.stringify(click) ||
        prepared.revision !== expectedRevision
      )
        return notApplied('target_binding_required');
      if (prepared.inputRevision !== inputRevision) {
        this.ready = false;
        return notApplied('replan_required');
      }
      this.ready = false;
      const outcome = await this.send({
        op: 'download_open',
        sessionId,
        action: click,
        binding: {
          token: prepared.target.token,
          observationRevision: prepared.target.observationRevision,
        },
      });
      const rejected = failureSchema.safeParse(outcome.result);
      if (
        !outcome.ok &&
        rejected.success &&
        rejected.data.error === 'download_restore_unconfirmed'
      ) {
        this.options.control.close('input_outcome_unknown');
        return { ...rejected.data, actionOutcome: rejected.data.actionOutcome ?? 'unknown' };
      }
      if (
        !outcome.ok &&
        outcome.result === undefined &&
        !['target_required', 'invalid_session_command', 'target_extension_unavailable'].includes(
          outcome.error?.code ?? '',
        )
      )
        return this.uncertain('input_outcome_unknown', 'act');
      if (!outcome.ok) return this.accept(outcome, 'act');
      const parsed = z
        .object({
          ok: z.literal(true),
          sessionId: z.literal(sessionId),
          downloadState: userBrowserDownloadStateSchema,
          actionOutcome: z.enum(['applied', 'not_applied']),
          observation: observationSchema.optional(),
        })
        .safeParse(outcome.result);
      if (!parsed.success || parsed.data.actionOutcome !== parsed.data.downloadState.clickOutcome)
        return this.uncertain('invalid_receipt', 'act');
      const state = parsed.data.downloadState;
      if (state.status === 'captured' && !this.origins.includes(state.source.origin))
        return this.uncertain('invalid_receipt', 'act');
      const retain = () => {
        if (state.status === 'captured' && this.tabId !== null)
          this.download = {
            state: structuredClone(state),
            sessionId,
            tabId: this.tabId,
            inputRevision,
          };
      };
      if (!current())
        return { ok: false, error: 'replan_required', actionOutcome: state.clickOutcome };
      if (!parsed.data.observation) {
        retain();
        return { ok: true, downloadState: state, actionOutcome: state.clickOutcome };
      }
      const fresh = this.accept(outcome, 'observe');
      if (!fresh.ok) return { ...fresh, actionOutcome: fresh.actionOutcome ?? state.clickOutcome };
      // accept() advances the client revision on a valid new observation.
      if (
        this.closing ||
        !this.options.control.canAgentAct() ||
        this.options.control.inputRevision !== inputRevision
      ) {
        this.ready = false;
        return { ok: false, error: 'replan_required', actionOutcome: state.clickOutcome };
      }
      if (!this.fileDownloadsEnabled) {
        this.ready = false;
        return { ok: false, error: 'capability_missing', actionOutcome: state.clickOutcome };
      }
      retain();
      return { ...fresh, downloadState: state, actionOutcome: state.clickOutcome };
    });
  }

  /** No raw bytes enter a model/tool reply. The task's trusted receiver owns this
   * buffer, validates its storage receipt, and then releases this native source. */
  async readDownload(
    id: string,
  ): Promise<{ ok: true; file: SelectedChromeDownloadFile } | { ok: false; error: string }> {
    const held = this.download;
    if (!held || held.state.downloadId !== id || !this.fileDownloadsEnabled)
      return { ok: false, error: 'download_unavailable' };
    if (this.pending) return { ok: false, error: 'browser_busy' };
    const current = () =>
      !this.closing &&
      this.download === held &&
      this.sessionId === held.sessionId &&
      this.tabId === held.tabId &&
      this.options.control.canAgentAct() &&
      this.options.control.inputRevision === held.inputRevision;
    if (!current()) return { ok: false, error: 'replan_required' };
    let file: SelectedChromeDownloadFile | undefined;
    const result = await this.track(async () => {
      const buffer = Buffer.alloc(held.state.metadata.sizeBytes);
      try {
        let offset = 0;
        do {
          if (!current()) return fail('replan_required');
          const command = {
            op: 'download_read' as const,
            sessionId: held.sessionId,
            downloadId: id,
            offset,
            length: BROWSER_UPLOAD_CHUNK_BYTES,
          };
          let outcome = await this.send(command);
          if (!outcome.ok && outcome.result === undefined && current())
            outcome = await this.send(command);
          if (!current()) return fail('replan_required');
          const parsed = z
            .object({
              ok: z.literal(true),
              sessionId: z.literal(held.sessionId),
              downloadChunk: userBrowserDownloadChunkSchema,
            })
            .safeParse(outcome.result);
          if (!outcome.ok || !parsed.success) return fail('download_unavailable');
          const chunk = parsed.data.downloadChunk;
          if (chunk.downloadId !== id || chunk.offset !== offset)
            return fail('download_invalid_chunk');
          const bytes = Buffer.from(chunk.data, 'base64');
          try {
            if (
              bytes.toString('base64') !== chunk.data ||
              bytes.length !== Math.min(BROWSER_UPLOAD_CHUNK_BYTES, buffer.length - offset) ||
              chunk.eof !== (offset + bytes.length === buffer.length)
            )
              return fail('download_invalid_chunk');
            bytes.copy(buffer, offset);
            offset += bytes.length;
          } finally {
            bytes.fill(0);
          }
        } while (offset < buffer.length);
        if (createHash('sha256').update(buffer).digest('hex') !== held.state.metadata.sha256)
          return fail('download_digest_mismatch');
        if (!current()) return fail('replan_required');
        file = { metadata: { ...held.state.metadata }, source: { ...held.state.source }, buffer };
        return { ok: true };
      } finally {
        if (!file) buffer.fill(0);
      }
    });
    if (!result.ok || !file)
      return { ok: false, error: result.ok ? 'download_unavailable' : result.error };
    if (!current()) {
      file.buffer.fill(0);
      return { ok: false, error: 'replan_required' };
    }
    return { ok: true, file };
  }

  async releaseDownload(id: string): Promise<SelectedChromeClientReply> {
    const held = this.download;
    if (!held || held.state.downloadId !== id || this.closing || !this.sessionId)
      return fail('download_unavailable');
    if (this.pending) return fail('browser_busy');
    return this.track(async () => {
      const command = {
        op: 'download_release' as const,
        sessionId: held.sessionId,
        downloadId: id,
      };
      let outcome = await this.send(command);
      if (!outcome.ok && outcome.result === undefined && !this.closing)
        outcome = await this.send(command);
      const parsed = z
        .object({
          ok: z.literal(true),
          sessionId: z.literal(held.sessionId),
          downloadReleased: z.literal(id),
        })
        .safeParse(outcome.result);
      if (!outcome.ok || !parsed.success) return fail('download_release_unconfirmed');
      if (this.download === held) this.download = null;
      return { ok: true };
    });
  }

  async describeUpload(
    action: SelectedChromeUploadAction,
    expectedRevision: number,
  ): Promise<SelectedChromeClientReply> {
    if (!this.fileUploadsEnabled) return fail('capability_missing');
    const parsed = selectedChromeUploadActionSchema.safeParse(action);
    if (!parsed.success) return fail('file_manifest_invalid');
    if (parsed.data.payload.chooserId && !this.fileChoosersEnabled)
      return fail('capability_missing');
    return this.describeTarget({ op: 'upload_describe', action: parsed.data }, expectedRevision);
  }

  private async describeTarget(
    command:
      | { op: 'describe'; action: Action }
      | { op: 'upload_describe'; action: SelectedChromeUploadAction },
    expectedRevision: number,
  ): Promise<SelectedChromeClientReply> {
    if (!this.routingV2) return fail('capability_missing');
    if (!this.sessionId || this.closing) return fail('session_unavailable');
    if (this.pending) return fail('browser_busy');
    if (
      !this.ready ||
      !this.options.control.canAgentAct() ||
      expectedRevision !== this.revisionValue
    )
      return fail('replan_required');
    return this.track(async () => {
      this.prepared = null;
      const outcome = await this.send({
        ...command,
        sessionId: this.sessionId ?? '',
        observationRevision: this.extensionRevision,
      });
      const parsed = z
        .object({
          ok: z.literal(true),
          sessionId: z.string().uuid(),
          target: userBrowserTargetDescriptionSchema,
        })
        .safeParse(outcome.result);
      if (!outcome.ok || !parsed.success) {
        const failed = failureSchema.safeParse(outcome.result);
        return fail(failed.success ? failed.data.error : 'target_unreadable');
      }
      const target = parsed.data.target;
      if (
        parsed.data.sessionId !== this.sessionId ||
        target.tabId !== this.tabId ||
        target.observationRevision !== this.extensionRevision ||
        (command.op === 'upload_describe' && !target.fileInput) ||
        !this.origins.includes(target.origin) ||
        this.closing ||
        !this.options.control.canAgentAct()
      )
        return fail('stale_observation');
      this.prepared = {
        target,
        action: JSON.stringify(command.action),
        revision: expectedRevision,
        inputRevision: this.options.control.inputRevision,
      };
      return { ok: true, target };
    });
  }

  /** Host-only byte source. The runner must resolve these from its original
   * BrowserTaskFiles after the common disclosure gate; no model paths/bytes. */
  async upload(
    input: SelectedChromeUploadAction,
    expectedRevision: number,
    source: {
      resolve: () => Promise<readonly BrowserUploadFile[]>;
      current: () => Promise<boolean>;
    },
  ): Promise<SelectedChromeClientReply> {
    if (!this.fileUploadsEnabled) return fail('capability_missing');
    if (!this.sessionId || this.closing) return fail('session_unavailable');
    if (this.pending) return fail('browser_busy');
    if (
      !this.ready ||
      !this.options.control.canAgentAct() ||
      expectedRevision !== this.revisionValue
    )
      return fail('replan_required');
    const parsed = selectedChromeUploadActionSchema.safeParse(input);
    if (!parsed.success) return fail('file_manifest_invalid');
    const action = parsed.data;
    if (action.payload.chooserId && !this.fileChoosersEnabled) return fail('capability_missing');
    const prepared = this.prepared;
    if (
      !prepared ||
      prepared.revision !== expectedRevision ||
      prepared.action !== JSON.stringify(action)
    )
      return fail('target_binding_required');
    const sessionId = this.sessionId;
    this.prepared = null;
    this.ready = false;
    return this.track(async () => {
      const current = async () => {
        try {
          const admitted = () =>
            !this.closing &&
            this.sessionId === sessionId &&
            this.options.control.canAgentAct() &&
            expectedRevision === this.revisionValue;
          return admitted() && (await source.current()) && admitted();
        } catch {
          return false;
        }
      };
      let transferId: string | undefined;
      let commitSent = false;
      const abort = async () => {
        if (transferId) await this.send({ op: 'upload_abort', sessionId, transferId });
      };
      const notApplied = (error: string): SelectedChromeClientReply => ({
        ok: false,
        error,
        actionOutcome: 'not_applied',
      });
      const transmit = async (command: SelectedChromeUploadCommand) => {
        let result = await this.send(command);
        // Only a lost transport receipt is retried, using the exact same stage,
        // offset and bytes or commit ID. A new target/selection is never inferred.
        if (
          !result.ok &&
          result.result === undefined &&
          !['target_required', 'invalid_session_command', 'target_extension_unavailable'].includes(
            result.error?.code ?? '',
          ) &&
          (await current())
        )
          result = await this.send(command);
        return result;
      };
      const readState = (result: ExtensionToolCallOutcome) => {
        const parsed = z
          .object({
            ok: z.literal(true),
            sessionId: z.literal(sessionId),
            uploadState: userBrowserUploadStateSchema,
          })
          .safeParse(result.result);
        return result.ok && parsed.success ? parsed.data.uploadState : null;
      };
      const matches = (files: readonly BrowserUploadFile[]) =>
        files.length === action.payload.files.length &&
        files.every((file, index) => {
          const expected = action.payload.files[index]!;
          return (
            Buffer.isBuffer(file.buffer) &&
            file.fileId === expected.fileId &&
            file.name === expected.name &&
            file.mimeType === expected.mimeType &&
            file.buffer.length === expected.sizeBytes &&
            createHash('sha256').update(file.buffer).digest('hex') === expected.sha256
          );
        });
      try {
        if (!(await current())) return notApplied('scope_unavailable');
        const files = await source.resolve();
        if (!(await current())) return notApplied('scope_unavailable');
        if (!matches(files)) return notApplied('file_payload_invalid');
        if (!(await current())) return notApplied('scope_unavailable');
        const begun = readState(
          await transmit({
            op: 'upload_begin',
            sessionId,
            action,
            binding: {
              token: prepared.target.token,
              observationRevision: prepared.target.observationRevision,
            },
          }),
        );
        if (begun?.phase !== 'begun') return notApplied('upload_staging_unconfirmed');
        transferId = begun.transferId;
        for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
          const file = files[fileIndex]!;
          for (let offset = 0; offset < file.buffer.length; offset += BROWSER_UPLOAD_CHUNK_BYTES) {
            if (!(await current())) {
              await abort();
              return notApplied('scope_unavailable');
            }
            const bytes = file.buffer.subarray(offset, offset + BROWSER_UPLOAD_CHUNK_BYTES);
            const progress = readState(
              await transmit({
                op: 'upload_chunk',
                sessionId,
                transferId,
                fileIndex,
                offset,
                data: bytes.toString('base64'),
              }),
            );
            if (
              progress?.phase !== 'progress' ||
              progress.transferId !== transferId ||
              progress.fileIndex !== fileIndex ||
              progress.nextOffset !== offset + bytes.length
            ) {
              await abort();
              return notApplied('upload_staging_unconfirmed');
            }
          }
        }
        if (!(await current())) {
          await abort();
          return notApplied('scope_unavailable');
        }
        if (!matches(await source.resolve())) {
          await abort();
          return notApplied('file_payload_invalid');
        }
        if (!(await current())) {
          await abort();
          return notApplied('scope_unavailable');
        }
        commitSent = true;
        const result = await transmit({ op: 'upload_commit', sessionId, transferId });
        const state = readState(result);
        if (
          state?.phase !== 'finished' ||
          state.receipt.transferId !== transferId ||
          JSON.stringify(state.receipt.files) !== JSON.stringify(action.payload.files)
        ) {
          const rejected = failureSchema.safeParse(result.result);
          if (!result.ok && rejected.success && rejected.data.actionOutcome === 'not_applied')
            return notApplied(rejected.data.error);
          return this.uncertain('input_outcome_unknown', 'act');
        }
        if (!(await current())) return this.uncertain('input_outcome_unknown', 'act');
        const receipt = state.receipt;
        if (receipt.status === 'unknown') {
          this.uncertain('input_outcome_unknown', 'act');
          return { ok: true, uploadReceipt: receipt };
        }
        // Native delivery and subsequent observation are separate evidence.
        // A missing observation requires re-read, never another upload.
        const observed = successSchema.safeParse(result.result);
        const fresh = observed.success ? this.accept(result, 'observe') : null;
        return { ...(fresh?.ok ? fresh : { ok: true as const }), uploadReceipt: receipt };
      } catch {
        if (commitSent) return this.uncertain('input_outcome_unknown', 'act');
        await abort();
        return notApplied('file_unavailable');
      }
    });
  }
  async tabs(
    command: Omit<Extract<SelectedChromeSessionCommand, { op: 'tabs' }>, 'op' | 'sessionId'>,
  ): Promise<SelectedChromeClientReply> {
    if (!this.routingV2) return fail('capability_missing');
    if (!this.sessionId || this.closing) return fail('session_unavailable');
    if (this.pending || !this.options.control.canAgentAct()) return fail('replan_required');
    if (command.operation === 'switch' && !this.taskTabs.has(command.tabId ?? -1))
      return fail('task_tab_required');
    if (
      command.operation === 'new' &&
      (!command.url || !this.origins.includes(new URL(command.url).origin))
    )
      return fail('origin_grant_required');
    return this.track(async () => {
      this.prepared = null;
      const outcome = await this.send({ op: 'tabs', sessionId: this.sessionId ?? '', ...command });
      const parsed = z
        .object({
          ok: z.literal(true),
          sessionId: z.string().uuid(),
          tabs: z
            .array(
              z.object({
                tabId: z.number().int().nonnegative(),
                origin: z.string().url(),
                ownership: z.enum(['selected', 'task']),
              }),
            )
            .max(10),
          observation: observationSchema.optional(),
        })
        .safeParse(outcome.result);
      if (!outcome.ok || !parsed.success || parsed.data.sessionId !== this.sessionId) {
        const f = failureSchema.safeParse(outcome.result);
        return fail(f.success ? f.data.error : 'invalid_receipt');
      }
      if (command.operation === 'list') return { ok: true, tabs: parsed.data.tabs };
      const obs = parsed.data.observation;
      if (
        !obs ||
        !this.origins.includes(obs.origin) ||
        !parsed.data.tabs.some(
          (t) => t.tabId === obs.tabId && (command.operation !== 'new' || t.ownership === 'task'),
        )
      )
        return this.uncertain('invalid_receipt', 'act');
      if (command.operation === 'switch' && obs.tabId !== command.tabId)
        return this.uncertain('invalid_receipt', 'act');
      this.taskTabs.add(obs.tabId);
      this.tabId = obs.tabId;
      return this.accept(outcome, 'observe');
    });
  }

  async observe(): Promise<SelectedChromeClientReply> {
    if (!this.sessionId || this.closing) return fail('session_unavailable');
    if (this.pending) return fail('browser_busy');
    if (!this.options.control.canAgentAct()) return fail('replan_required');
    return this.track(() => this.refresh());
  }

  async checkpoint(options: { maxWaitMs?: number } = {}): Promise<BrowserCheckpoint> {
    await this.pending;
    if (this.nativeActivityEnabled) return this.nativeCheckpoint(options.maxWaitMs ?? 120_000);
    return this.options.control.checkpoint(async () => {
      const result = await this.refresh();
      if (!result.ok) throw new Error('observation_failed');
    });
  }

  private async nativeActivity(): Promise<UserBrowserActivity | null> {
    if (!this.sessionId || this.closing || !this.options.control.canAgentAct()) return null;
    const outcome = await this.send({ op: 'activity', sessionId: this.sessionId });
    const parsed = z
      .object({
        ok: z.literal(true),
        sessionId: z.string().uuid(),
        activity: userBrowserActivitySchema,
      })
      .strict()
      .safeParse(outcome.result);
    if (
      !outcome.ok ||
      !parsed.success ||
      parsed.data.sessionId !== this.sessionId ||
      parsed.data.activity.tabId !== this.tabId ||
      this.closing
    )
      return null;
    const activity = parsed.data.activity;
    if (activity.stamp !== this.nativeBaseline && activity.stamp !== this.nativeSeen)
      this.options.control.noteHumanInput('pending');
    this.nativeSeen = activity.stamp;
    this.options.control.setHeldInput(this.nativeSource, activity);
    return activity;
  }

  private async nativeCheckpoint(maxWaitMs: number): Promise<BrowserCheckpoint> {
    const started = Date.now();
    const deadline = started + Math.max(0, maxWaitMs);
    const control = this.options.control;
    let refreshed = false;
    const blocked = (): BrowserCheckpoint => {
      this.ready = false;
      this.prepared = null;
      return { resumed: false, blocked: true, waitedMs: Date.now() - started };
    };
    while (!this.closing && control.canAgentAct()) {
      const activity = await this.nativeActivity();
      if (!activity || activity.interrupted) return blocked();
      if (control.humanBusy()) {
        if (Date.now() >= deadline) return blocked();
        await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())));
        continue;
      }
      if (activity.stamp !== this.nativeBaseline || control.hasUnobservedHumanInput()) {
        if (Date.now() >= deadline) return blocked();
        const fresh = await this.refresh();
        const after = await this.nativeActivity();
        if (!after || after.interrupted) return blocked();
        if (!fresh.ok) {
          // Native input can invalidate the strict DOM capture. Keep yielding and reread;
          // an unchanged, unreadable page is a real observation failure.
          if (after.stamp !== activity.stamp || control.humanBusy()) continue;
          return blocked();
        }
        refreshed = true;
        if (after.stamp !== this.nativeBaseline || control.humanBusy()) continue;
      }
      const receipt = await control.checkpoint(async () => {});
      return { ...receipt, resumed: receipt.resumed || refreshed, waitedMs: Date.now() - started };
    }
    return { resumed: false, waitedMs: Date.now() - started };
  }

  async close(): Promise<SelectedChromeClientReply> {
    this.closing = true;
    this.options.control.close();
    if (this.closedReceipt) return { ok: true, closed: true };
    if (this.closeAttempt) return this.closeAttempt;
    this.closeAttempt = (async (): Promise<SelectedChromeClientReply> => {
      await this.pending;
      await this.options.control.settled();
      if (!this.sessionId) {
        // A timed-out open may own a remote seat. The owning task must send
        // trusted cancellation: lack of a session ID is not a stop receipt.
        if (this.openSent) return fail('session_outcome_unknown');
        this.closedReceipt = true;
        return { ok: true, closed: true };
      }
      const outcome = await this.send({ op: 'close', sessionId: this.sessionId });
      if (
        !outcome.ok ||
        !z.object({ ok: z.literal(true), closed: z.literal(true) }).safeParse(outcome.result)
          .success
      )
        return fail('close_unconfirmed');
      this.sessionId = null;
      this.closedReceipt = true;
      return { ok: true, closed: true };
    })().finally(() => {
      this.closeAttempt = null;
    });
    return this.closeAttempt;
  }

  private async refresh(): Promise<SelectedChromeClientReply> {
    if (!this.sessionId || this.closing) return fail('session_unavailable');
    this.ready = false;
    this.prepared = null;
    return this.accept(await this.send({ op: 'observe', sessionId: this.sessionId }), 'observe');
  }

  private async send(command: SelectedChromeSessionCommand): Promise<ExtensionToolCallOutcome> {
    try {
      return await this.options.send(this.options.userId, {
        taskId: this.options.taskId,
        extensionClientId: this.options.extensionClientId,
        kind: 'session',
        args: { session: command },
        ...(command.op === 'download_open' ? { timeoutMs: 60_000 } : {}),
      });
    } catch {
      return { ok: false, error: { code: 'transport_failed', message: 'Chrome transport failed' } };
    }
  }

  private accept(
    outcome: ExtensionToolCallOutcome,
    op: 'open' | 'observe' | 'act',
    readOnlyAction = false,
  ): SelectedChromeClientReply {
    if (!outcome.ok && outcome.result === undefined && (op === 'observe' || readOnlyAction)) {
      this.ready = false;
      return {
        ok: false,
        error: 'observation_failed',
        ...(readOnlyAction ? { actionOutcome: 'not_applied' as const } : {}),
      };
    }
    // These server checks precede socket submission. Transport timeout/close
    // and drain failures are deliberately excluded: those may follow input.
    const code = outcome.error?.code;
    if (
      !outcome.ok &&
      code &&
      ['target_required', 'invalid_session_command', 'target_extension_unavailable'].includes(code)
    ) {
      if (op === 'open') this.openSent = false;
      return {
        ok: false,
        error: code,
        ...(op === 'act' ? { actionOutcome: 'not_applied' as const } : {}),
      };
    }
    const rejected = failureSchema.safeParse(outcome.result);
    if (!outcome.ok && rejected.success) {
      const reply = rejected.data;
      // The transport keeps its exclusive seat when attachment cleanup fails.
      // Without its session ID only trusted task cancellation can release it.
      if (op === 'open') this.openSent = reply.error === 'session_cleanup_failed';
      if (reply.actionOutcome === 'unknown' || (op === 'act' && !reply.actionOutcome))
        return this.uncertain('input_outcome_unknown', op);
      if (
        reply.error === 'observation_failed' ||
        reply.error === 'observation_required' ||
        reply.actionOutcome === 'applied'
      )
        this.ready = false;
      return reply;
    }
    const parsed = successSchema.safeParse(outcome.result);
    // Retain the remote identity for cleanup even if its observation is invalid.
    if (
      op === 'open' &&
      typeof outcome.result === 'object' &&
      outcome.result !== null &&
      'sessionId' in outcome.result
    ) {
      const id = z.string().uuid().safeParse(outcome.result.sessionId);
      if (id.success) this.sessionId = id.data;
    }
    if (!outcome.ok || !parsed.success) return this.uncertain('invalid_receipt', op);
    const reply = parsed.data;
    if (
      reply.sessionId !== this.sessionId ||
      reply.observation.tabId !== this.tabId ||
      (op === 'act' && !reply.actionOutcome)
    )
      return this.uncertain('invalid_receipt', op);
    if (this.routingV2) {
      const protocol = userBrowserProtocolSchema.safeParse(
        (outcome.result as Record<string, unknown>).protocol,
      );
      this.uploadNegotiated =
        protocol.success && protocol.data.capabilities.includes(USER_BROWSER_UPLOAD_CAPABILITY);
      this.chooserNegotiated =
        protocol.success && protocol.data.capabilities.includes(USER_BROWSER_CHOOSER_CAPABILITY);
      this.downloadNegotiated =
        protocol.success && protocol.data.capabilities.includes(USER_BROWSER_DOWNLOAD_CAPABILITY);
      if (
        !protocol.success ||
        !reply.observation.observationRevision ||
        (this.nativeActivityEnabled &&
          (!protocol.data.capabilities.includes(USER_BROWSER_ACTIVITY_CAPABILITY) ||
            !reply.observation.activity))
      ) {
        this.ready = false;
        return fail('capability_missing');
      }
      if (!this.origins.includes(reply.observation.origin)) {
        this.ready = false;
        return fail('origin_grant_required');
      }
      this.extensionRevision = reply.observation.observationRevision;
      if (this.nativeActivityEnabled && reply.observation.activity) {
        if (reply.observation.activity.tabId !== this.tabId)
          return this.uncertain('invalid_receipt', op);
        this.nativeBaseline = reply.observation.activity.stamp;
        this.nativeSeen = this.nativeBaseline;
        this.options.control.setHeldInput(this.nativeSource, reply.observation.activity);
      }
    }
    this.ready = true;
    this.prepared = null;
    this.revisionValue++;
    return {
      ok: true,
      observation: reply.observation,
      revision: this.revisionValue,
      ...(reply.actionOutcome ? { actionOutcome: reply.actionOutcome } : {}),
    };
  }

  private uncertain(error: string, op: 'open' | 'observe' | 'act'): SelectedChromeClientReply {
    this.ready = false;
    this.options.control.close('input_outcome_unknown');
    return { ok: false, error, ...(op === 'act' ? { actionOutcome: 'unknown' as const } : {}) };
  }

  private track(
    work: () => Promise<SelectedChromeClientReply>,
  ): Promise<SelectedChromeClientReply> {
    const pending = Promise.resolve()
      .then(work)
      .finally(() => {
        if (this.pending === pending) this.pending = null;
      });
    this.pending = pending;
    return pending;
  }
}

function fail(error: string): SelectedChromeClientReply {
  return { ok: false, error };
}
