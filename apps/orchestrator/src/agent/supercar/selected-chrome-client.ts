import {
  USER_BROWSER_PROTOCOL,
  userBrowserProtocolSchema,
  userBrowserTargetDescriptionSchema,
  type UserBrowserTargetDescription,
  type SelectedChromeSessionCommand,
} from '@holaday/shared-types';
import { z } from 'zod';
import type { ExtensionToolCallOptions, ExtensionToolCallOutcome } from '../../ws/server.js';
import type { BrowserControl } from './browser-control.js';

type Action = Extract<SelectedChromeSessionCommand, { op: 'act' }>['action'];
type Target = Extract<SelectedChromeSessionCommand, { op: 'open' }>['target'];
type Options = {
  userId: string;
  taskId: string;
  extensionClientId: string;
  control: BrowserControl;
  routingV2?: boolean;
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
    }
  | { ok: false; error: string; actionOutcome?: 'applied' | 'not_applied' | 'unknown' };

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
  } | null = null;
  private taskTabs = new Set<number>();
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
                  capabilities: [...USER_BROWSER_PROTOCOL.capabilities],
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
        op: 'describe',
        sessionId: this.sessionId ?? '',
        action,
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
        !this.origins.includes(target.origin) ||
        this.closing ||
        !this.options.control.canAgentAct()
      )
        return fail('stale_observation');
      this.prepared = { target, action: JSON.stringify(action), revision: expectedRevision };
      return { ok: true, target };
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

  async checkpoint(): Promise<{ resumed: boolean; waitedMs: number }> {
    await this.pending;
    return this.options.control.checkpoint(async () => {
      const result = await this.refresh();
      if (!result.ok) throw new Error('observation_failed');
    });
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
      if (!protocol.success || !reply.observation.observationRevision) {
        this.ready = false;
        return fail('capability_missing');
      }
      if (!this.origins.includes(reply.observation.origin)) {
        this.ready = false;
        return fail('origin_grant_required');
      }
      this.extensionRevision = reply.observation.observationRevision;
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
