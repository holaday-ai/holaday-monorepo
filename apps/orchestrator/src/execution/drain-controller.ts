import { performance } from 'node:perf_hooks';
import { type DrainCommand, decodeDrainCommand } from './drain-control-protocol.js';
import type { DrainStateIdentity, DrainStateRecord } from './drain-state-record.js';
import { DrainStateStore } from './drain-state-store.js';
import { type DrainSnapshot, ExecutionDrain } from './execution-drain.js';
import {
  type OperationLifetime,
  type OwnedOperation,
  startOwnedOperation,
} from './owned-operation.js';

type ControlCode =
  | 'INVALID_COMMAND'
  | 'IDENTITY_MISMATCH'
  | 'STALE_COMMAND'
  | 'EXPIRED'
  | 'SESSION_INVALID'
  | 'BUSY'
  | 'OPEN_DENIED'
  | 'OPEN_CONSUMED'
  | 'STATE_UNAVAILABLE';
class ControlError extends Error {
  constructor(readonly code: ControlCode) {
    super(code);
  }
}
export type DrainReply =
  | { protocol: 1; ok: false; code: ControlCode }
  | {
      protocol: 1;
      ok: true;
      serial: number;
      state: Readonly<DrainStateRecord>;
      counts: DrainSnapshot;
    };
export interface DrainClock {
  wall(): number;
  mono(): number;
}
export type DrainOpenVerifier = (command: Readonly<DrainCommand>) => Promise<void>;

/** Local mechanism only. The maintenance integration must supply the real verifier.
 * No network request can assert bootstrap proof or create another opening permit. */
export class DrainController {
  readonly drain = new ExecutionDrain(1024, () => this.verifyDispatch());
  readonly state: DrainStateStore;
  private session: object | null = null;
  private commandOwner: object | null = null;
  private cancelAuthorization: (() => void) | null = null;
  private consumed = false;
  private stopped = false;
  private released = false;
  private storageFailed = false;
  private serial = 0;
  private lastWall: number;
  private lastMono: number;
  private activity = 0;
  private deadline: { wall: number; mono: number } | null = null;

  constructor(
    directory: string,
    identity: DrainStateIdentity,
    private readonly authorizeOpen?: DrainOpenVerifier,
    private readonly clock: DrainClock = { wall: () => Date.now(), mono: () => performance.now() },
  ) {
    this.lastWall = clock.wall();
    this.lastMono = clock.mono();
    if (
      !Number.isSafeInteger(this.lastWall) ||
      this.lastWall < 1 ||
      !Number.isFinite(this.lastMono) ||
      this.lastMono < 0
    )
      throw new Error('CONTROL_CLOCK_INVALID');
    this.state = new DrainStateStore(directory, identity, this.drain);
  }

  connect(): object {
    this.tick();
    if (this.stopped) throw new Error('CONTROL_CLOSED');
    if (this.session) throw new Error('CONTROL_BUSY');
    this.session = Object.freeze({});
    this.activity = this.lastMono;
    return this.session;
  }

  owns(session: object): boolean {
    return this.session === session && !this.stopped;
  }

  /** Synchronous write-ahead root admission. No watchdog or caller-supplied proof. */
  runRoot<T>(action: (lifetime: OperationLifetime) => Promise<T>): OwnedOperation<T> {
    if (typeof action !== 'function') throw new Error('CONTROL_ACTION_INVALID');
    this.tick();
    this.assertAdmission();
    try {
      this.state.markDirty();
    } catch {
      this.storageFailed = true;
      this.stopped = true;
      this.invalidateSession();
      this.state.abandon();
      throw new Error('CONTROL_STATE_UNAVAILABLE');
    }
    // No await between the last persistence check and root reservation.
    this.checkTime();
    this.assertAdmission();
    return startOwnedOperation(
      this.drain,
      'request',
      async (owner) => {
        // The shared dispatch guard reads disk again. If that read crossed the
        // lease boundary this root has not entered application code and must stop.
        this.assertAdmission();
        return action(Object.freeze({ drain: this.drain, owner }));
      },
      { errorOutcome: 'unknown', dispatch: 'immediate' },
    );
  }

  private assertAdmission(): void {
    if (
      this.stopped ||
      this.storageFailed ||
      !this.session ||
      !this.deadline ||
      this.drain.snapshot().mode !== 'open'
    )
      throw new Error('CONTROL_ADMISSION_CLOSED');
  }

  private verifyDispatch(): void {
    try {
      if (!this.state.read().dirty) throw new Error('CONTROL_DIRTY_REQUIRED');
    } catch {
      this.storageFailed = true;
      this.stopped = true;
      this.invalidateSession();
      this.state.abandon();
      throw new Error('CONTROL_STATE_UNAVAILABLE');
    }
    this.checkTime();
    // A normal close/expiry does not cancel already admitted children. State
    // failure, however, cannot be ignored merely because an owner exists.
    if (this.storageFailed) throw new Error('CONTROL_STATE_UNAVAILABLE');
  }

  async execute(session: object, bytes: Buffer): Promise<DrainReply> {
    if (!this.owns(session)) return { protocol: 1, ok: false, code: 'SESSION_INVALID' };
    if (this.commandOwner) return { protocol: 1, ok: false, code: 'BUSY' };
    const commandOwner = Object.freeze({});
    this.commandOwner = commandOwner;
    try {
      let command: Readonly<DrainCommand>;
      try {
        command = decodeDrainCommand(bytes);
      } catch {
        throw new ControlError('INVALID_COMMAND');
      }
      this.tick();
      if (this.storageFailed) throw new ControlError('STATE_UNAVAILABLE');
      if (!this.owns(session)) throw new ControlError('SESSION_INVALID');
      const state = this.state.read();
      if (
        command.epoch !== state.epoch ||
        command.bootId !== state.bootId ||
        command.candidate !== state.candidate
      )
        throw new ControlError('IDENTITY_MISMATCH');
      if (command.version !== state.sequence || command.serial !== this.serial + 1)
        throw new ControlError('STALE_COMMAND');
      if (command.expiresAt <= this.lastWall || command.expiresAt - this.lastWall > 900_000)
        throw new ControlError('EXPIRED');
      this.serial = command.serial;
      this.activity = this.lastMono;
      if (command.op === 'open') {
        if (this.consumed) throw new ControlError('OPEN_CONSUMED');
        this.consumed = true;
        if (!this.drain.snapshot().idle) throw new ControlError('BUSY');
        this.deadline = {
          wall: command.expiresAt,
          mono: this.lastMono + command.expiresAt - this.lastWall,
        };
        await this.waitForAuthorization(command);
        this.tick();
        if (!this.owns(session)) throw new ControlError('SESSION_INVALID');
        if (this.state.read().sequence !== command.version) throw new ControlError('STALE_COMMAND');
        if (!this.drain.snapshot().idle) throw new ControlError('BUSY');
        this.state.prepareOpen();
        this.tick();
        if (!this.owns(session)) throw new ControlError('SESSION_INVALID');
        this.drain.open();
      } else {
        if (command.op === 'close') this.drain.close();
        this.state.checkpoint();
      }
      const receipt = this.state.read();
      // No filesystem work follows this last deadline/ownership check.
      this.checkTime();
      if (!this.owns(session)) throw new ControlError('SESSION_INVALID');
      return {
        protocol: 1,
        ok: true,
        serial: this.serial,
        state: receipt,
        counts: this.drain.snapshot(),
      };
    } catch (error) {
      this.disconnect(session);
      return {
        protocol: 1,
        ok: false,
        code: error instanceof ControlError ? error.code : 'STATE_UNAVAILABLE',
      };
    } finally {
      if (this.commandOwner === commandOwner) this.commandOwner = null;
    }
  }

  disconnect(session: object): void {
    if (this.session !== session) return;
    this.invalidateSession();
    this.closeGate();
  }

  /** Transport watchdog calls this even when no command arrives. */
  tick(): void {
    if (this.stopped) return;
    try {
      this.state.read();
    } catch {
      this.storageFailed = true;
      this.stopped = true;
      this.invalidateSession();
      this.state.abandon();
      return;
    }
    this.checkTime();
  }

  private checkTime(): void {
    const wall = this.clock.wall();
    const mono = this.clock.mono();
    if (
      !Number.isSafeInteger(wall) ||
      !Number.isFinite(mono) ||
      wall < this.lastWall ||
      mono < this.lastMono
    ) {
      this.stopped = true;
      this.invalidateSession();
      this.closeGate();
      return;
    }
    this.lastWall = wall;
    this.lastMono = mono;
    if (
      this.session &&
      (mono - this.activity >= 10_000 ||
        (this.deadline && (wall >= this.deadline.wall || mono >= this.deadline.mono)))
    )
      this.disconnect(this.session);
  }

  /** Stop admission now; release the writer only after genuine quiescence. */
  /** Close admission without releasing the state owner before services stop. */
  quiesce(): boolean {
    if (this.released) return true;
    this.stopped = true;
    this.invalidateSession();
    return this.closeGate();
  }

  shutdown(): boolean {
    if (this.released) return true;
    if (!this.quiesce() || !this.drain.snapshot().idle) return false;
    try {
      this.state.release();
      this.released = true;
      return true;
    } catch {
      return false;
    }
  }

  private closeGate(): boolean {
    this.drain.close();
    try {
      this.state.checkpoint();
      return true;
    } catch {
      this.storageFailed = true;
      this.stopped = true;
      this.invalidateSession();
      this.state.abandon();
      return false;
    }
  }

  private invalidateSession(): void {
    this.session = null;
    this.deadline = null;
    this.cancelAuthorization?.();
  }

  private async waitForAuthorization(command: Readonly<DrainCommand>): Promise<void> {
    if (!this.authorizeOpen) throw new ControlError('OPEN_DENIED');
    let cancel!: () => void;
    const cancelled = new Promise<'cancelled'>((resolve) => {
      cancel = () => resolve('cancelled');
    });
    this.cancelAuthorization = cancel;
    try {
      // Stop waiting on loss of control, but observe both late outcomes of the
      // original read-only verifier. This does not cancel that underlying work.
      const original = this.authorizeOpen(command);
      if (!original || typeof original.then !== 'function') throw new ControlError('OPEN_DENIED');
      const observed = Promise.resolve(original).then(
        (value) => (value === undefined ? ('authorized' as const) : ('denied' as const)),
        () => 'denied' as const,
      );
      const outcome = await Promise.race([observed, cancelled]);
      if (outcome !== 'authorized')
        throw new ControlError(outcome === 'cancelled' ? 'SESSION_INVALID' : 'OPEN_DENIED');
    } catch (error) {
      if (error instanceof ControlError) throw error;
      throw new ControlError('OPEN_DENIED');
    } finally {
      if (this.cancelAuthorization === cancel) this.cancelAuthorization = null;
    }
  }
}
