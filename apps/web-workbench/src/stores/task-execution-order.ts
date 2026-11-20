/** Client ordering only. Server identity never grants write or execution permission. */
export interface ExecutionIdentity {
  executionId: string;
  executionRevision: number;
}
type Snapshot = { identity: ExecutionIdentity | null; version: number; terminal: boolean };
export type OrderDecision = 'new' | 'same' | 'ignore' | 'reconcile';

export function readExecutionIdentity(value: {
  executionId?: unknown;
  executionRevision?: unknown;
}): ExecutionIdentity | null | 'invalid' {
  const { executionId: id, executionRevision: revision } = value;
  if ((id === undefined && revision === undefined) || (id === null && revision === 0)) return null;
  return typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 64 &&
    typeof revision === 'number' &&
    Number.isSafeInteger(revision) &&
    revision > 0
    ? { executionId: id, executionRevision: revision }
    : 'invalid';
}

export class TaskExecutionOrder {
  private readonly snapshots = new Map<string, Snapshot>();
  /** FIX-34: a core round handed to the browser lane; its identity no longer orders events. */
  private readonly handedOver = new Map<string, ExecutionIdentity>();
  version(taskId: string): number {
    return this.snapshots.get(taskId)?.version ?? 0;
  }
  clear(): void {
    this.snapshots.clear();
    this.handedOver.clear();
  }
  /**
   * The core round `identity` handed this task to the browser lane, whose events carry no
   * identity. The task row keeps that identity, so it reads as no identity until a newer
   * core round (a reply) takes over. `bump` (the live event) invalidates reads in flight; a
   * row or detail showing the handover (after a reload) retires it quietly.
   */
  handOver(
    taskId: string,
    value: { executionId?: unknown; executionRevision?: unknown },
    bump = true,
  ): void {
    const read = readExecutionIdentity(value);
    const identity = read ?? this.snapshots.get(taskId)?.identity;
    if (!identity || identity === 'invalid') return;
    const retired = this.handedOver.get(taskId);
    if (retired && retired.executionRevision >= identity.executionRevision) return;
    const known = this.snapshots.get(taskId)?.identity;
    if (known && known.executionRevision > identity.executionRevision) return;
    this.handedOver.set(taskId, identity);
    if (bump || known)
      this.snapshots.set(taskId, {
        identity: null,
        terminal: false,
        version: this.version(taskId) + (bump ? 1 : 0),
      });
  }
  private read(
    taskId: string,
    value: { executionId?: unknown; executionRevision?: unknown },
  ): ExecutionIdentity | null | 'invalid' {
    const identity = readExecutionIdentity(value);
    const retired = this.handedOver.get(taskId);
    if (!retired || !identity || identity === 'invalid') return identity;
    if (identity.executionRevision > retired.executionRevision) {
      this.handedOver.delete(taskId);
      return identity;
    }
    return identity.executionRevision === retired.executionRevision &&
      identity.executionId === retired.executionId
      ? null
      : identity;
  }
  seed(
    taskId: string,
    value: { executionId?: unknown; executionRevision?: unknown },
    terminal: boolean,
  ): void {
    const identity = this.read(taskId, value);
    if (!identity || identity === 'invalid') return;
    const previous = this.snapshots.get(taskId);
    if (
      !previous?.identity ||
      identity.executionRevision > previous.identity.executionRevision ||
      (identity.executionId === previous.identity.executionId &&
        identity.executionRevision === previous.identity.executionRevision &&
        terminal &&
        !previous.terminal)
    ) {
      this.snapshots.set(taskId, { identity, terminal, version: this.version(taskId) + 1 });
    }
  }
  accept(
    taskId: string,
    value: { executionId?: unknown; executionRevision?: unknown },
    options: {
      source: 'event' | 'ack' | 'detail';
      since?: number;
      terminal?: boolean;
      afterTerminal?: boolean;
    },
  ): OrderDecision {
    const identity = this.read(taskId, value);
    if (identity === 'invalid') return 'reconcile';
    const previous = this.snapshots.get(taskId);
    const known = previous?.identity;
    let authoritativeConflict = false;
    if (known && !identity) return 'ignore';
    if (known && identity) {
      if (identity.executionRevision < known.executionRevision) return 'ignore';
      if (
        identity.executionRevision === known.executionRevision &&
        identity.executionId !== known.executionId
      ) {
        if (options.source !== 'detail' || options.since !== this.version(taskId))
          return 'reconcile';
        authoritativeConflict = true;
      }
    }
    const newer =
      authoritativeConflict ||
      (identity !== null && (!known || identity.executionRevision > known.executionRevision));
    const legacyResume =
      options.source === 'ack' && identity === null && options.since === this.version(taskId);
    if (!newer) {
      if (options.source !== 'event' && options.since !== this.version(taskId)) return 'ignore';
      if (previous?.terminal && !options.terminal && !options.afterTerminal && !legacyResume)
        return 'ignore';
    }
    this.snapshots.set(taskId, {
      identity,
      version: this.version(taskId) + 1,
      terminal: Boolean(options.terminal || (!newer && !legacyResume && previous?.terminal)),
    });
    return newer ? 'new' : 'same';
  }
}
