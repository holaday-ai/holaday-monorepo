import { randomBytes } from 'node:crypto';
import fs, { type Stats } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  type DrainStateIdentity,
  type DrainStateRecord,
  checkedDrainIdentity,
  decodeDrainState,
  encodeDrainState,
} from './drain-state-record.js';
import type { ExecutionDrain } from './execution-drain.js';

const unavailable = () => new Error('DRAIN_STATE_UNAVAILABLE');
const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;

/** Single-writer persistence, not bootstrap authorization. No initialize/steal/reset.
 * A trusted provisioner supplies a proven closed/clean previous state.
 * The private directory owner (and root) remains in the trust boundary. */
export class DrainStateStore {
  private readonly identity: Readonly<DrainStateIdentity>;
  private readonly uid: number;
  private readonly rootIdentity: Stats;
  private state: Readonly<DrainStateRecord>;
  private expectedBytes: string;
  private readonly lockBytes: string;
  private lockFd: number | null = null;
  private rootFd: number | null = null;
  private failed = false;
  private released = false;

  constructor(
    private readonly directory: string,
    identity: DrainStateIdentity,
    private readonly drain: ExecutionDrain,
  ) {
    try {
      this.identity = checkedDrainIdentity(identity);
      if (!process.getuid || !drain.snapshot().idle) throw unavailable();
      this.uid = process.getuid();
      this.rootIdentity = this.checkRoot();
      this.rootFd = fs.openSync(
        directory,
        fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
      );
      if (!sameFile(fs.fstatSync(this.rootFd), this.rootIdentity)) throw unavailable();
      this.lockBytes = `${JSON.stringify(this.identity)}\n`;
      try {
        this.lockFd = fs.openSync(
          join(directory, 'writer.lock'),
          fs.constants.O_WRONLY |
            fs.constants.O_CREAT |
            fs.constants.O_EXCL |
            fs.constants.O_NOFOLLOW,
          0o600,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw new Error('DRAIN_STATE_LOCKED');
        throw error;
      }
      fs.writeFileSync(this.lockFd, this.lockBytes);
      fs.fsyncSync(this.lockFd);
      fs.fsyncSync(this.rootFd);
      this.expectedBytes = this.privateBytes('state.json');
      const previous = decodeDrainState(this.expectedBytes);
      if (previous.mode !== 'closed' || previous.dirty || previous.bootId === identity.bootId)
        throw new Error('DRAIN_STATE_RECOVERY_REQUIRED');
      this.state = previous;
      this.save({
        schemaVersion: 1,
        ...this.identity,
        sequence: previous.sequence + 1,
        mode: 'closed',
        dirty: false,
      });
    } catch (error) {
      this.poison();
      if (
        error instanceof Error &&
        ['DRAIN_STATE_LOCKED', 'DRAIN_STATE_RECOVERY_REQUIRED'].includes(error.message)
      )
        throw error;
      throw unavailable();
    }
  }

  /** Persist intent before the authorized controller synchronously opens memory. */
  prepareOpen(): void {
    this.guard();
    if (!this.drain.snapshot().idle || this.state.mode !== 'closed' || this.state.dirty)
      throw new Error('DRAIN_STATE_BUSY');
    this.save({ ...this.state, sequence: this.state.sequence + 1, mode: 'open', dirty: false });
  }

  /** Must precede root admission/dispatch; this does not itself grant admission. */
  markDirty(): void {
    this.guard();
    this.save({
      ...this.state,
      sequence: this.state.sequence + 1,
      mode: this.drain.snapshot().mode,
      dirty: true,
    });
  }

  checkpoint(): void {
    this.guard();
    const snapshot = this.drain.snapshot();
    this.save({
      ...this.state,
      sequence: this.state.sequence + 1,
      mode: snapshot.mode,
      dirty: snapshot.active > 0 || snapshot.unknown > 0 || snapshot.mode === 'blocked',
    });
  }

  read(): Readonly<DrainStateRecord> {
    this.guard();
    return this.state;
  }

  release(): boolean {
    if (this.released) return false;
    this.guard();
    if (!this.drain.snapshot().idle || this.state.mode !== 'closed' || this.state.dirty)
      throw new Error('DRAIN_STATE_BUSY');
    try {
      // Retire this in-memory gate before another boot can acquire the lock.
      this.drain.block();
      this.assertLock();
      fs.unlinkSync(join(this.directory, 'writer.lock'));
      this.syncRoot();
      this.released = true;
      this.closeDescriptors();
      return true;
    } catch {
      this.poison();
      throw unavailable();
    }
  }

  /** Failure shutdown only: preserve lock and disk evidence for recovery. */
  abandon(): void {
    if (!this.released) this.poison();
  }

  private save(next: DrainStateRecord): void {
    let temporaryFd: number | null = null;
    try {
      this.guard();
      const bytes = encodeDrainState(next);
      const temporary = join(this.directory, `.state-${randomBytes(12).toString('hex')}.tmp`);
      temporaryFd = fs.openSync(
        temporary,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_NOFOLLOW,
        0o600,
      );
      fs.writeFileSync(temporaryFd, bytes);
      fs.fsyncSync(temporaryFd);
      fs.closeSync(temporaryFd);
      temporaryFd = null;
      this.guard();
      fs.renameSync(temporary, join(this.directory, 'state.json'));
      this.syncRoot();
      this.expectedBytes = bytes;
      this.state = Object.freeze({ ...next });
      this.guard();
    } catch {
      // Keep any owned failed temp for recovery; never unlink unknown replacements.
      this.poison();
      throw unavailable();
    } finally {
      if (temporaryFd !== null) {
        try {
          fs.closeSync(temporaryFd);
        } catch {
          /* Failed closed. */
        }
      }
    }
  }

  private guard(): void {
    if (this.failed || this.released) throw unavailable();
    try {
      if (!sameFile(this.checkRoot(), this.rootIdentity)) throw unavailable();
      this.assertLock();
      if (this.privateBytes('state.json') !== this.expectedBytes) throw unavailable();
    } catch {
      this.poison();
      throw unavailable();
    }
  }

  private checkRoot(): Stats {
    if (
      this.directory === '/' ||
      resolve(this.directory) !== this.directory ||
      fs.realpathSync(this.directory) !== this.directory
    )
      throw unavailable();
    const stat = fs.lstatSync(this.directory);
    if (!stat.isDirectory() || stat.uid !== this.uid || (stat.mode & 0o7777) !== 0o700)
      throw unavailable();
    return stat;
  }

  private assertLock(): void {
    if (this.lockFd === null) throw unavailable();
    const owned = fs.fstatSync(this.lockFd);
    const current = fs.lstatSync(join(this.directory, 'writer.lock'));
    if (!sameFile(owned, current) || this.privateBytes('writer.lock') !== this.lockBytes)
      throw unavailable();
  }

  private privateBytes(name: 'state.json' | 'writer.lock'): string {
    const fd = fs.openSync(
      join(this.directory, name),
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    try {
      const stat = fs.fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.uid !== this.uid ||
        (stat.mode & 0o7777) !== 0o600 ||
        stat.nlink !== 1 ||
        stat.size < 1 ||
        stat.size > 2048
      )
        throw unavailable();
      const buffer = Buffer.alloc(2049);
      let size = 0;
      for (;;) {
        const count = fs.readSync(fd, buffer, size, buffer.length - size, size);
        size += count;
        if (count === 0 || size === buffer.length) break;
      }
      if (size !== stat.size || size > 2048 || fs.fstatSync(fd).size !== size) throw unavailable();
      const bytes = buffer.subarray(0, size);
      const text = bytes.toString('utf8');
      if (!Buffer.from(text).equals(bytes)) throw unavailable();
      return text;
    } finally {
      fs.closeSync(fd);
    }
  }

  private syncRoot(): void {
    if (this.rootFd === null || !sameFile(this.checkRoot(), this.rootIdentity)) throw unavailable();
    fs.fsyncSync(this.rootFd);
  }

  private poison(): void {
    this.failed = true;
    this.drain.block();
    this.closeDescriptors();
  }

  private closeDescriptors(): void {
    for (const fd of [this.lockFd, this.rootFd]) {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          /* Remain closed. */
        }
      }
    }
    this.lockFd = null;
    this.rootFd = null;
  }
}
