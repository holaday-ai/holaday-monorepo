const workKinds = [
  'request',
  'execution',
  'suggestions',
  'database',
  'model',
  'scheduler',
] as const;
export type DrainWorkKind = (typeof workKinds)[number];
export type DrainMode = 'closed' | 'open' | 'blocked';

declare const ownerBrand: unique symbol;
declare const uncertaintyBrand: unique symbol;
export type DrainOwner = Readonly<{ [ownerBrand]: true }>;
export type DrainUncertainty = Readonly<{ [uncertaintyBrand]: true }>;

export interface DrainSnapshot {
  readonly mode: DrainMode;
  readonly active: number;
  readonly roots: number;
  readonly children: number;
  readonly unknown: number;
  readonly idle: boolean;
  readonly byKind: Readonly<Record<DrainWorkKind, number>>;
}

interface Operation {
  readonly kind: DrainWorkKind;
  readonly root: boolean;
  active: boolean;
  pinned: boolean;
  unknown: DrainUncertainty | null;
}

/**
 * Synchronous process-local ownership. Defaults closed, with no singleton or
 * side effects. This is NOT a cross-boot or whole-process release receipt:
 * admission coverage, persistence and reconciliation belong to its consumers.
 */
export class ExecutionDrain {
  private mode: DrainMode = 'closed';
  // A physically finished unknown operation keeps its slot until reconciled.
  private readonly operations = new Map<DrainOwner, Operation>();
  private readonly uncertainties = new Map<
    DrainUncertainty,
    { owner: DrainOwner; operation: Operation }
  >();

  constructor(private readonly capacity = 1024) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 65_536)
      throw new Error('EXECUTION_DRAIN_CAPACITY');
  }

  /** Called only after the external controller has validated durable state. */
  open(): void {
    this.assertNotBlocked();
    if (this.operations.size !== 0) throw new Error('EXECUTION_DRAIN_BUSY');
    this.mode = 'open';
  }

  close(): void {
    if (this.mode !== 'blocked') this.mode = 'closed';
  }

  /** Safety failures cannot be cleared by a later close/open request. */
  block(): void {
    this.mode = 'blocked';
  }

  admit(kind: DrainWorkKind): DrainOwner {
    this.assertNotBlocked();
    if (this.mode !== 'open') throw new Error('EXECUTION_DRAIN_CLOSED');
    return this.allocate(kind, true);
  }

  /** Reserve BEFORE scheduling the child, while the parent is still active. */
  fork(parent: DrainOwner, kind: DrainWorkKind): DrainOwner {
    this.assertNotBlocked();
    this.requireActive(parent);
    return this.allocate(kind, false);
  }

  /** Re-check at actual dispatch, not only when the adapter was prepared. */
  assertDispatch(owner: DrainOwner): void {
    this.assertNotBlocked();
    this.requireActive(owner);
  }

  finish(owner: DrainOwner): boolean {
    if (this.operations.get(owner)?.pinned) return false;
    return this.release(owner);
  }

  /** Only the raw-operation wrapper retains this one-shot release capability. */
  pin(owner: DrainOwner): () => boolean {
    this.assertNotBlocked();
    const operation = this.requireActive(owner);
    if (operation.pinned) throw new Error('EXECUTION_DRAIN_PINNED');
    operation.pinned = true;
    let released = false;
    return () => {
      if (released) return false;
      released = true;
      return this.release(owner);
    };
  }

  private release(owner: DrainOwner): boolean {
    const operation = this.operations.get(owner);
    if (!operation?.active) return false;
    operation.active = false;
    if (!operation.unknown) this.operations.delete(owner);
    return true;
  }

  /** Record ambiguity before releasing the raw owner; a caller timeout cannot release it. */
  markUnknown(owner: DrainOwner): DrainUncertainty {
    const operation = this.requireActive(owner);
    if (operation.unknown) return operation.unknown;
    const ticket = Object.freeze({}) as DrainUncertainty;
    operation.unknown = ticket;
    this.uncertainties.set(ticket, { owner, operation });
    return ticket;
  }

  /**
   * Internal capability, never exposed to the control socket. The consumer
   * must first reconcile against authoritative transaction/version evidence.
   * Removing ambiguity does not finish a still-active physical operation.
   */
  reconcile(ticket: DrainUncertainty): boolean {
    const uncertainty = this.uncertainties.get(ticket);
    if (!uncertainty) return false;
    const { owner, operation } = uncertainty;
    operation.unknown = null;
    this.uncertainties.delete(ticket);
    if (!operation.active) this.operations.delete(owner);
    return true;
  }

  snapshot(): DrainSnapshot {
    const byKind: Record<DrainWorkKind, number> = {
      request: 0,
      execution: 0,
      suggestions: 0,
      database: 0,
      model: 0,
      scheduler: 0,
    };
    let roots = 0;
    let children = 0;
    for (const operation of this.operations.values()) {
      if (!operation.active) continue;
      byKind[operation.kind] += 1;
      if (operation.root) roots += 1;
      else children += 1;
    }
    return Object.freeze({
      mode: this.mode,
      active: roots + children,
      roots,
      children,
      unknown: this.uncertainties.size,
      idle: this.mode === 'closed' && this.operations.size === 0,
      byKind: Object.freeze(byKind),
    });
  }

  private allocate(kind: DrainWorkKind, root: boolean): DrainOwner {
    if (!workKinds.includes(kind)) throw new Error('EXECUTION_DRAIN_KIND');
    if (this.operations.size >= this.capacity) throw new Error('EXECUTION_DRAIN_CAPACITY');
    const owner = Object.freeze({}) as DrainOwner;
    this.operations.set(owner, { kind, root, active: true, pinned: false, unknown: null });
    return owner;
  }

  private requireActive(owner: DrainOwner): Operation {
    const operation = this.operations.get(owner);
    if (!operation?.active) throw new Error('EXECUTION_DRAIN_OWNER');
    return operation;
  }

  private assertNotBlocked(): void {
    if (this.mode === 'blocked') throw new Error('EXECUTION_DRAIN_BLOCKED');
  }
}
