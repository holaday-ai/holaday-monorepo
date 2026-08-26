import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { evidenceArtifacts } from '../../db/schema/evidence-artifacts.js';
import { taskFiles } from '../../db/schema/task-files.js';
import { tasks } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import type { StorageProvider } from '../../files/storage-provider.js';
import type {
  AccountClosureHandler,
  ClosureCheckpoint,
  ClosureHandlerContext,
  ClosureHandlerResult,
} from '../handler-contract.js';
import { createMediaAssetsClosureHandler } from './media-assets.js';
import { taskExecutionClosureHandler } from './task-execution.js';

describe.sequential('media assets closure handler', () => {
  let cleanup: () => Promise<void> = async () => {};
  let db: typeof import('../../db/client.js').db;
  const logger = pino({ enabled: false });

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL ?? '';
    if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
    const { applyMigrations } = await import('../../test/db-helper.js');
    await applyMigrations(databaseUrl);
    const client = await import('../../db/client.js');
    db = client.db;
    cleanup = () => client.pool.end();
  });

  afterAll(async () => {
    await cleanup();
  });

  it('deletes media object-first, restricts minimized authorization evidence, and lets task cleanup converge', async () => {
    const target = await createUser('target', {
      avatarUrl: 'https://profiles.example/avatar.png',
      qwenVoiceId: 'voice_target',
      baseVideoFileId: 'file_target_base',
      videoSelfUseAuthorizedAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    const other = await createUser('other', {
      avatarUrl: 'https://profiles.example/other.png',
      qwenVoiceId: 'voice_other',
      baseVideoFileId: 'file_other_base',
      videoSelfUseAuthorizedAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    const targetTaskId = await createTask(target.id, 'target');
    const otherTaskId = await createTask(other.id, 'other');
    await insertFile(target.id, targetTaskId, 'file_target_base', 'input', 'video/mp4');
    await insertFile(target.id, targetTaskId, 'file_target_image', 'output', 'image/png');
    await insertFile(target.id, targetTaskId, 'file_target_video', 'output', 'video/mp4');
    await insertFile(target.id, targetTaskId, 'file_target_audio', 'output', 'audio/wav');
    await insertFile(target.id, targetTaskId, 'file_target_document', 'output', 'application/pdf');
    await insertFile(other.id, otherTaskId, 'file_other_base', 'input', 'video/mp4');
    await insertEvidence({
      externalId: 'evidence_target_media',
      ownerUserId: target.id,
      taskId: targetTaskId,
      contentType: 'image/png',
      purpose: 'task_evidence',
      retentionPolicy: 'task_30d',
      r2Key: 'evidence/target/media',
    });
    await insertEvidence({
      externalId: 'evidence_target_authorization',
      ownerUserId: target.id,
      taskId: targetTaskId,
      contentType: 'application/pdf',
      purpose: 'authorization',
      retentionPolicy: 'manual_hold',
      r2Key: 'evidence/target/authorization',
    });
    await insertEvidence({
      externalId: 'evidence_other_authorization',
      ownerUserId: other.id,
      taskId: otherTaskId,
      contentType: 'image/png',
      purpose: 'authorization',
      retentionPolicy: 'manual_hold',
      r2Key: 'evidence/other/authorization',
    });

    const deletedPaths: string[] = [];
    const storage = fakeStorage(deletedPaths);
    const deleteVoiceClone = vi.fn(async () => undefined);
    const handler = createMediaAssetsClosureHandler({ deleteVoiceClone });
    const final = await runToCompletion(handler, context(target, storage, null));

    expect(final.retention).toBe('restricted');
    expect(deleteVoiceClone).toHaveBeenCalledOnce();
    expect(deleteVoiceClone).toHaveBeenCalledWith('voice_target');
    expect(deletedPaths).toEqual(
      expect.arrayContaining([
        'objects/file_target_base',
        'objects/file_target_image',
        'objects/file_target_video',
        'objects/file_target_audio',
        'evidence/target/media',
      ]),
    );
    expect(deletedPaths).not.toContain('objects/file_target_document');
    expect(deletedPaths).not.toContain('evidence/target/authorization');
    expect(deletedPaths).not.toContain('objects/file_other_base');
    expect(storage.get).not.toHaveBeenCalled();

    const [closedProfile] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
    expect(closedProfile).toMatchObject({
      avatarUrl: null,
      qwenVoiceId: null,
      baseVideoFileId: null,
      videoSelfUseAuthorizedAt: null,
    });
    const [otherProfile] = await db.select().from(users).where(eq(users.id, other.id)).limit(1);
    expect(otherProfile).toMatchObject({
      avatarUrl: 'https://profiles.example/other.png',
      qwenVoiceId: 'voice_other',
      baseVideoFileId: 'file_other_base',
    });

    expect(await fileExists('file_target_base')).toBe(false);
    expect(await fileExists('file_target_image')).toBe(false);
    expect(await fileExists('file_target_video')).toBe(false);
    expect(await fileExists('file_target_audio')).toBe(false);
    expect(await fileExists('file_target_document')).toBe(true);
    expect(await fileExists('file_other_base')).toBe(true);
    expect(await evidenceExists('evidence_target_media')).toBe(false);

    const [retained] = await db
      .select()
      .from(evidenceArtifacts)
      .where(eq(evidenceArtifacts.externalId, 'evidence_target_authorization'))
      .limit(1);
    expect(retained).toMatchObject({
      ownerUserId: null,
      taskId: null,
      siteId: null,
      explorationRunId: null,
      sourceUrl: null,
      finalUrl: null,
      rawExcerpt: null,
      viewportJson: null,
      domHash: null,
      screenshotHash: null,
      retentionPolicy: 'manual_hold',
      r2Key: 'evidence/target/authorization',
      metadataJson: {
        scrubbed: true,
        scrubbedReason: 'account_closure',
        retentionClass: 'restricted',
      },
    });

    const taskResult = await runToCompletion(
      taskExecutionClosureHandler,
      context(target, storage, null),
    );
    expect(taskResult.retention).toBe('deleted');
    expect(await fileExists('file_target_document')).toBe(false);
    expect(await taskExists(targetTaskId)).toBe(false);
    expect(await taskExists(otherTaskId)).toBe(true);
    expect(deletedPaths.filter((path) => path === 'objects/file_target_document')).toHaveLength(1);

    await expect(handler.run(context(target, storage, null))).resolves.toEqual({
      kind: 'complete',
      processed: 0,
      retention: 'not_present',
    });
  });

  it('keeps profile identifiers when remote voice deletion fails, then clears them after retry', async () => {
    const target = await createUser('retry', {
      avatarUrl: 'https://profiles.example/retry.png',
      qwenVoiceId: 'voice_retry',
      videoSelfUseAuthorizedAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    const storage = fakeStorage([]);
    const providerError = new Error('provider timeout');
    const failing = createMediaAssetsClosureHandler({
      deleteVoiceClone: vi.fn().mockRejectedValue(providerError),
    });

    await expect(failing.run(context(target, storage, null))).rejects.toBe(providerError);
    const [unchanged] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
    expect(unchanged).toMatchObject({
      avatarUrl: 'https://profiles.example/retry.png',
      qwenVoiceId: 'voice_retry',
      videoSelfUseAuthorizedAt: new Date('2026-08-20T00:00:00.000Z'),
    });

    const retry = createMediaAssetsClosureHandler({
      deleteVoiceClone: vi.fn(async () => undefined),
    });
    await expect(retry.run(context(target, storage, null))).resolves.toMatchObject({
      kind: 'complete',
      retention: 'deleted',
    });
    const [cleared] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
    expect(cleared).toMatchObject({
      avatarUrl: null,
      qwenVoiceId: null,
      videoSelfUseAuthorizedAt: null,
    });
  });

  it('keeps evidence metadata and profile fields when object deletion fails', async () => {
    const target = await createUser('evidence-retry', {
      avatarUrl: 'https://profiles.example/evidence-retry.png',
    });
    const taskId = await createTask(target.id, 'evidence-retry');
    await insertEvidence({
      externalId: 'evidence_target_retry_media',
      ownerUserId: target.id,
      taskId,
      contentType: 'image/png',
      purpose: 'task_evidence',
      retentionPolicy: 'task_30d',
      r2Key: 'evidence/target/retry-media',
    });
    const storage = fakeStorage([]);
    const objectError = new Error('object timeout');
    vi.mocked(storage.delete).mockRejectedValueOnce(objectError);
    const handler = createMediaAssetsClosureHandler({ deleteVoiceClone: null });

    await expect(handler.run(context(target, storage, null))).rejects.toBe(objectError);
    expect(await evidenceExists('evidence_target_retry_media')).toBe(true);
    const [unchanged] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
    expect(unchanged?.avatarUrl).toBe('https://profiles.example/evidence-retry.png');

    const completed = await runToCompletion(handler, context(target, storage, null));
    expect(completed.retention).toBe('deleted');
    expect(await evidenceExists('evidence_target_retry_media')).toBe(false);
    const [cleared] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
    expect(cleared?.avatarUrl).toBeNull();
  });

  it('fails closed when a voice identifier exists without a verified provider deletion capability', async () => {
    const target = await createUser('deferred', { qwenVoiceId: 'voice_deferred' });
    const handler = createMediaAssetsClosureHandler({ deleteVoiceClone: null });

    await expect(handler.run(context(target, fakeStorage([]), null))).rejects.toMatchObject({
      code: 'HANDLER_DEFERRED',
    });
    const [unchanged] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
    expect(unchanged?.qwenVoiceId).toBe('voice_deferred');
  });

  function context(
    user: { id: number; externalId: string },
    storage: StorageProvider,
    checkpoint: ClosureCheckpoint,
  ): ClosureHandlerContext {
    return {
      db,
      logger,
      storage,
      request: {
        id: 701,
        externalId: 'acl_media_test',
        userId: user.id,
        userExternalId: user.externalId,
      },
      checkpoint,
      pageSize: 100,
    };
  }

  async function runToCompletion(
    handler: AccountClosureHandler,
    initial: ClosureHandlerContext,
  ): Promise<Extract<ClosureHandlerResult, { kind: 'complete' }>> {
    let checkpoint = initial.checkpoint;
    for (let invocation = 0; invocation < 10; invocation += 1) {
      const result = await handler.run({ ...initial, checkpoint });
      if (result.kind === 'complete') return result;
      expect(Object.values(result.checkpoint).every(Number.isSafeInteger)).toBe(true);
      checkpoint = result.checkpoint;
    }
    throw new Error('handler did not converge');
  }

  async function createUser(
    label: string,
    media: {
      avatarUrl?: string;
      qwenVoiceId?: string;
      baseVideoFileId?: string;
      videoSelfUseAuthorizedAt?: Date;
    } = {},
  ) {
    const suffix = randomBytes(5).toString('hex');
    const externalId = `usr_t7_${label}_${suffix}`;
    const [result] = await db.insert(users).values({
      externalId,
      email: `t7-${label}-${suffix}@example.test`,
      passwordHash: 'not-a-real-password',
      status: 'closure_processing',
      avatarUrl: media.avatarUrl ?? null,
      qwenVoiceId: media.qwenVoiceId ?? null,
      baseVideoFileId: media.baseVideoFileId ?? null,
      videoSelfUseAuthorizedAt: media.videoSelfUseAuthorizedAt ?? null,
    });
    return { id: Number(result.insertId), externalId };
  }

  async function createTask(userId: number, label: string): Promise<number> {
    const [result] = await db.insert(tasks).values({
      externalId: `tsk_t7_${label}_${randomBytes(4).toString('hex')}`,
      userId,
      status: 'cancelled',
      intent: 'synthetic task 7 fixture',
    });
    return Number(result.insertId);
  }

  async function insertFile(
    userId: number,
    taskId: number,
    externalId: string,
    kind: 'input' | 'output',
    mimetype: string,
  ) {
    await db.insert(taskFiles).values({
      externalId,
      userId,
      taskId,
      kind,
      filename: `${externalId}.bin`,
      mimetype,
      sizeBytes: 10,
      storagePath: `objects/${externalId}`,
    });
  }

  async function insertEvidence(input: {
    externalId: string;
    ownerUserId: number;
    taskId: number;
    contentType: string;
    purpose: string;
    retentionPolicy: string;
    r2Key: string;
  }) {
    await db.insert(evidenceArtifacts).values({
      ...input,
      artifactKind: 'synthetic_task7_fixture',
      sourceUrl: 'https://private.example/source',
      finalUrl: 'https://private.example/final',
      r2Bucket: 'test-only-bucket',
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
      capturedAt: new Date('2026-08-20T00:00:00.000Z'),
      collectorLane: 'task7-test',
      viewportJson: { private: true },
      domHash: 'b'.repeat(64),
      screenshotHash: 'c'.repeat(64),
      rawExcerpt: 'synthetic private excerpt',
      metadataJson: { private: true },
    });
  }

  async function fileExists(externalId: string): Promise<boolean> {
    const rows = await db
      .select({ id: taskFiles.id })
      .from(taskFiles)
      .where(eq(taskFiles.externalId, externalId));
    return rows.length === 1;
  }

  async function evidenceExists(externalId: string): Promise<boolean> {
    const rows = await db
      .select({ id: evidenceArtifacts.id })
      .from(evidenceArtifacts)
      .where(eq(evidenceArtifacts.externalId, externalId));
    return rows.length === 1;
  }

  async function taskExists(id: number): Promise<boolean> {
    const rows = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, id));
    return rows.length === 1;
  }
});

function fakeStorage(deletedPaths: string[]): StorageProvider {
  return {
    pathFor: vi.fn(),
    put: vi.fn(),
    putFile: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(async (path: string) => {
      deletedPaths.push(path);
    }),
    getSignedUrl: vi.fn(),
    getSignedPutUrl: vi.fn(),
    stat: vi.fn(),
  };
}
