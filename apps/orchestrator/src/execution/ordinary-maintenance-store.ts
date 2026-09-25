import { randomBytes } from 'node:crypto';
import fs, { type Stats } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  MaintenanceIdentity,
  MaintenanceJournal,
  MaintenanceRecord,
} from './ordinary-maintenance.js';

export interface OrdinaryMaintenanceStore extends MaintenanceJournal {
  close(): void;
}
const unavailable = () => new Error('MAINTENANCE_STATE_UNAVAILABLE');
const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;

function encode(record: MaintenanceRecord): string {
  if (
    !/^[a-f0-9]{40}$/.test(record.identity.candidate) ||
    !/^[a-f0-9]{32}$/.test(record.identity.bootId) ||
    !['serving', 'draining', 'closed', 'blocked'].includes(record.mode) ||
    typeof record.needsReconciliation !== 'boolean' ||
    ((record.mode === 'serving' || record.mode === 'blocked') && !record.needsReconciliation)
  )
    throw unavailable();
  return `${JSON.stringify({
    schemaVersion: 1,
    candidate: record.identity.candidate,
    bootId: record.identity.bootId,
    mode: record.mode,
    needsReconciliation: record.needsReconciliation,
  })}\n`;
}
function decode(bytes: string): MaintenanceRecord {
  const value = JSON.parse(bytes);
  const record: MaintenanceRecord = {
    identity: { candidate: value.candidate, bootId: value.bootId },
    mode: value.mode,
    needsReconciliation: value.needsReconciliation,
  };
  if (encode(record) !== bytes) throw unavailable();
  return record;
}

/** No implicit initialization or stale-lock stealing. Trusted provisioning is separate.
 * The private directory owner is the trust boundary, as with the native state store. */
export function createOrdinaryMaintenanceStore(
  directory: string,
  identity: MaintenanceIdentity,
): OrdinaryMaintenanceStore {
  return new Store(directory, identity);
}
class Store implements OrdinaryMaintenanceStore {
  private readonly identity: MaintenanceIdentity;
  private readonly uid: number;
  private readonly root: Stats;
  private readonly lockBytes: string;
  private rootFd: number | null = null;
  private lockFd: number | null = null;
  private expected = '';
  private record: MaintenanceRecord;
  private retired = false;
  private failed = false;

  constructor(
    private readonly directory: string,
    identity: MaintenanceIdentity,
  ) {
    try {
      this.identity = Object.freeze({ ...identity });
      encode({ identity: this.identity, mode: 'closed', needsReconciliation: false });
      if (!process.getuid) throw unavailable();
      this.uid = process.getuid();
      this.root = this.checkRoot();
      this.rootFd = fs.openSync(
        directory,
        fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
      );
      if (!sameFile(fs.fstatSync(this.rootFd), this.root)) throw unavailable();
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
          throw new Error('MAINTENANCE_STATE_LOCKED');
        throw error;
      }
      fs.writeFileSync(this.lockFd, this.lockBytes);
      fs.fsyncSync(this.lockFd);
      fs.fsyncSync(this.rootFd);
      this.expected = this.privateBytes('state.json');
      const previous = decode(this.expected);
      if (previous.identity.bootId === this.identity.bootId) throw unavailable();
      const dirty = previous.needsReconciliation || previous.mode !== 'closed';
      this.record = previous;
      this.persist({ mode: dirty ? 'blocked' : 'closed', needsReconciliation: dirty });
    } catch (error) {
      this.poison();
      if (error instanceof Error && error.message === 'MAINTENANCE_STATE_LOCKED') throw error;
      throw unavailable();
    }
  }
  read(): MaintenanceRecord {
    this.guard();
    return { ...this.record, identity: { ...this.identity } };
  }
  persist(input: Omit<MaintenanceRecord, 'identity'>): void {
    let fd: number | null = null;
    try {
      this.guard();
      const next = {
        identity: this.identity,
        mode: input.mode,
        needsReconciliation: input.needsReconciliation,
      };
      const bytes = encode(next);
      const temporary = join(this.directory, `.state-${randomBytes(12).toString('hex')}.tmp`);
      fd = fs.openSync(
        temporary,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_NOFOLLOW,
        0o600,
      );
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      this.guard();
      fs.renameSync(temporary, join(this.directory, 'state.json'));
      this.syncRoot();
      this.expected = bytes;
      this.record = next;
      this.guard();
    } catch {
      // Preserve failed temporary files and the writer lock for explicit recovery.
      this.poison();
      throw unavailable();
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {}
      }
    }
  }
  close(): void {
    if (this.retired) return;
    try {
      this.guard();
      // Retire before releasing ownership. Never erase the durable dirty marker.
      this.retired = true;
      fs.unlinkSync(join(this.directory, 'writer.lock'));
      this.syncRoot();
      this.closeDescriptors();
    } catch {
      this.poison();
      throw unavailable();
    }
  }
  private guard(): void {
    if (this.failed || this.retired) throw unavailable();
    try {
      if (!sameFile(this.checkRoot(), this.root) || this.lockFd === null) throw unavailable();
      if (
        !sameFile(fs.fstatSync(this.lockFd), fs.lstatSync(join(this.directory, 'writer.lock'))) ||
        this.privateBytes('writer.lock') !== this.lockBytes ||
        this.privateBytes('state.json') !== this.expected
      )
        throw unavailable();
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
    if (this.rootFd === null || !sameFile(this.checkRoot(), this.root)) throw unavailable();
    fs.fsyncSync(this.rootFd);
  }
  private poison(): void {
    this.failed = true;
    this.closeDescriptors();
  }
  private closeDescriptors(): void {
    for (const fd of [this.rootFd, this.lockFd]) {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {}
      }
    }
    this.rootFd = this.lockFd = null;
  }
}
