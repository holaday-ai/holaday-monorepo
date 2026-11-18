import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { expect, it, vi } from 'vitest';
import { taskFiles } from '../db/schema/task-files.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import { openIsolatedMysqlProbe } from '../testing/isolated-mysql-probe.js';
import { FileService } from './file-service.js';
import { LocalStorageProvider } from './storage-provider.js';

it.runIf(process.env.HOLADAY_SQL_OUTPUT_PUBLICATION === '1')(
  'refuses a cancelled late output and preserves Home history in actual isolated SQL',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'pr360-output-sql-'));
    const probe = await openIsolatedMysqlProbe({
      allTableStructures: true,
      artifactPath: '/private/tmp/pr360-review-fixes/sql-ownership.json',
    });
    try {
      const db = probe.db;
      await db.insert(users).values({
        id: 7,
        externalId: 'usr_fixture',
        email: 'pr360@example.test',
        passwordHash: 'synthetic',
      });
      await db.insert(tasks).values({
        id: 9,
        externalId: 'tsk_fixture',
        userId: 7,
        intent: 'Synthetic output',
        status: 'executing',
      });
      const logger = pino({ level: 'silent' });
      const storage = new LocalStorageProvider(root, logger);
      const service = new FileService(db, logger, storage);
      const put = storage.put.bind(storage);
      let path = '';
      let release!: () => void;
      let entered!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pausedPut = vi.spyOn(storage, 'put').mockImplementationOnce(async (input) => {
        const output = await put(input);
        path = output.storagePath;
        entered();
        await blocked;
        return output;
      });
      const writing = service.storeOutput({
        userIdInternal: 7,
        userExternalId: 'usr_fixture',
        taskIdInternal: 9,
        filename: 'late.jpg',
        mimetype: 'image/jpeg',
        buffer: Buffer.from([255, 216, 255, 217]),
        requireLiveTask: true,
      });
      const refused = expect(writing).rejects.toThrow('task_output_refused');
      await started;
      try {
        await db.update(tasks).set({ status: 'cancelled' }).where(eq(tasks.id, 9));
      } finally {
        release();
      }
      await refused;
      pausedPut.mockRestore();
      expect(await db.select().from(taskFiles)).toEqual([]);
      expect(await storage.get(path)).toBeNull();
      expect((await db.select().from(tasks))[0]?.status).toBe('cancelled');
      await db.update(tasks).set({ status: 'executing' }).where(eq(tasks.id, 9));
      let canPublish = true;
      vi.spyOn(storage, 'put').mockImplementationOnce(async (input) => {
        const output = await put(input);
        canPublish = false;
        return output;
      });
      await expect(
        service.storeOutput({
          userIdInternal: 7,
          userExternalId: 'usr_fixture',
          taskIdInternal: 9,
          filename: 'cancel-requested.jpg',
          mimetype: 'image/jpeg',
          buffer: Buffer.from([255, 216, 255, 217]),
          requireLiveTask: true,
          canPublish: () => canPublish,
        }),
      ).rejects.toThrow('task_output_refused');
      expect(await db.select().from(taskFiles)).toEqual([]);
      const home = await service.storeBrowserOutput({
        userIdInternal: 7,
        userExternalId: 'usr_fixture',
        filename: 'home.csv',
        buffer: Buffer.from('item,count\na,1\n'),
        mimetype: 'text/csv',
        source: {
          version: 1,
          kind: 'personal_home',
          sessionId: 'bhs_usr_fixture',
          instanceId: '9f76fe69-c29e-400e-ac94-5c223646c48a',
          origin: 'https://fixture.test',
          taskId: null,
        },
      });
      const { id: _id, createdAt: _created, ...copy } = home;
      await db.insert(taskFiles).values(
        Array.from({ length: 65 }, (_, index) => ({
          ...copy,
          externalId: `file_task_${index}`,
          taskId: 9,
          browserSource: {
            version: 1 as const,
            kind: 'task_download' as const,
            taskId: 'tsk_fixture',
            origin: 'https://fixture.test',
            originBasis: 'download_url' as const,
            sha256: 'a'.repeat(64),
          },
        })),
      );
      const listed = await service.listBrowserOutputsForUser(7);
      expect(listed.map((item) => item.fileId)).toEqual([home.externalId]);
      expect(listed[0]?.available).toBe(true);
    } finally {
      vi.restoreAllMocks();
      await probe.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
