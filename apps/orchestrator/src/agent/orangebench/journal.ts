import { randomUUID } from 'node:crypto';
/** Private per-task metadata, never credentials, script text or provider data. */
import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import lockfile from 'proper-lockfile';
import { z } from 'zod';
import { ClientError, digest } from './contracts.js';

const Target = z
  .object({ projectId: z.string(), characterId: z.string().optional(), capability: z.string() })
  .strict();
const StoredQuote = z
  .object({
    target: Target,
    quote: z
      .object({
        id: z.string(),
        project_id: z.string(),
        project_revision: z.number().int(),
        capability: z.string(),
        region: z.enum(['cn', 'global']),
        credits_micro_usd: z.number().int().safe(),
        expires_at: z.string(),
        execution_available: z.boolean(),
        effects: z.array(z.string()).max(12).default([]),
      })
      .strict(),
  })
  .strict();
const Intent = z
  .object({
    binding: z.string(),
    idempotencyKey: z.string(),
    maximum: z.number().int().safe(),
    phase: z.literal('submitting'),
    taskId: z.string().optional(),
  })
  .strict();
const Schema = z
  .object({
    version: z.literal(1),
    taskId: z.string(),
    accountId: z.string(),
    keyId: z.string(),
    quotes: z.record(StoredQuote),
    intents: z.record(Intent),
  })
  .strict();
export type State = z.infer<typeof Schema>;
export class TaskJournal {
  private active?: AbortController;
  private checkLease() {
    if (!this.active || this.active.signal.aborted) throw new ClientError('journal_compromised');
  }
  private constructor(
    readonly directory: string,
    readonly path: string,
    private readonly initial: State,
  ) {}
  static async open(
    directory: string,
    binding: { taskId: string; accountId: string; keyId: string },
  ): Promise<TaskJournal> {
    if (!directory.startsWith('/')) throw new ClientError('private_journal_required');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(directory);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.uid !== process.getuid?.()
    )
      throw new ClientError('private_journal_required');
    const initial: State = { version: 1, ...binding, quotes: {}, intents: {} };
    return new TaskJournal(
      resolve(directory),
      join(resolve(directory), `${digest(binding)}.json`),
      initial,
    );
  }
  private async load(): Promise<State> {
    let file: FileHandle;
    try {
      file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(this.initial);
      throw new ClientError('journal_unavailable');
    }
    try {
      const stat = await file.stat();
      if (
        !stat.isFile() ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o077) !== 0 ||
        stat.size > 256 * 1024
      )
        throw new ClientError('journal_unavailable');
      const state = Schema.parse(JSON.parse(await file.readFile('utf8')));
      if (
        state.taskId !== this.initial.taskId ||
        state.accountId !== this.initial.accountId ||
        state.keyId !== this.initial.keyId
      )
        throw new ClientError('journal_unavailable');
      return state;
    } finally {
      await file.close();
    }
  }
  async save(state: State): Promise<void> {
    this.checkLease();
    const text = JSON.stringify(Schema.parse(state));
    if (
      Buffer.byteLength(text) > 256 * 1024 ||
      Object.keys(state.quotes).length > 100 ||
      Object.keys(state.intents).length > 100
    )
      throw new ClientError('journal_limit');
    const temp = `${this.path}.${randomUUID()}.tmp`;
    const file = await open(temp, 'wx', 0o600);
    try {
      await file.writeFile(text);
      await file.sync();
      await file.close();
      this.checkLease();
      await rename(temp, this.path);
      const directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY);
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      this.checkLease();
    } finally {
      await file.close().catch(() => {});
      await unlink(temp).catch(() => {});
    }
  }
  async exclusive<T>(action: (state: State, signal: AbortSignal) => Promise<T>): Promise<T> {
    const directory = await lstat(this.directory);
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      directory.uid !== process.getuid?.() ||
      (directory.mode & 0o077) !== 0
    )
      throw new ClientError('journal_unavailable');
    const controller = new AbortController();
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(this.path, {
        realpath: false,
        retries: 0,
        stale: 10000,
        update: 2000,
        onCompromised: () => controller.abort(),
      });
    } catch {
      throw new ClientError('client_busy');
    }
    this.active = controller;
    let outcome: { ok: true; result: T } | { ok: false; error: unknown } = {
      ok: false,
      error: new ClientError('journal_unavailable'),
    };
    try {
      this.checkLease();
      const result = await action(await this.load(), controller.signal);
      this.checkLease();
      outcome = { ok: true, result };
    } catch (error) {
      outcome = {
        ok: false,
        error: controller.signal.aborted ? new ClientError('journal_compromised') : error,
      };
    } finally {
      this.active = undefined;
      try {
        await release();
      } catch {
        if (!controller.signal.aborted)
          outcome = { ok: false, error: new ClientError('journal_compromised') };
      }
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.result;
  }
}
