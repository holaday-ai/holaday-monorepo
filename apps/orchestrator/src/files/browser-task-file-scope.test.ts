import { rm } from 'node:fs/promises';
import { expect, it } from 'vitest';
import {
  BrowserTaskFiles,
  type ValidatedBrowserTaskFile,
} from '../agent/browser-tools/browser-task-files.js';
import { createBrowserTaskFileScope } from './browser-task-file-scope.js';
import { browserOutputFixture } from './testing/browser-output-fixture.js';

it.each(['owner', 'task-owner', 'origin', 'status'])(
  'binds file access to live account/task SQL metadata (%s)',
  async (reason) => {
    const f = await browserOutputFixture();
    try {
      const row = await f.service.storeUpload({
        userIdInternal: 7,
        userExternalId: 'usr_alice',
        filename: 'report.csv',
        mimetype: 'text/csv',
        buffer: Buffer.from('a,b\n1,2\n'),
      });
      const inputs = BrowserTaskFiles.validatedReferences(
        await f.service.loadMany([row.externalId], 7),
        7,
      );
      const scope = createBrowserTaskFileScope({
        db: f.db,
        files: f.service,
        userId: 7,
        taskId: 'tsk_alice',
        origin: 'user',
        inputs,
      });
      expect((await scope.resolve('tsk_alice', [row.externalId]))[0]!.buffer.toString()).toBe(
        'a,b\n1,2\n',
      );
      if (reason === 'owner') f.faults.ownerStatus = 'closing';
      if (reason === 'task-owner') f.taskRecords[0]!.userId = 8;
      if (reason === 'origin') f.taskRecords[0]!.origin = 'system';
      if (reason === 'status') f.taskRecords[0]!.status = 'completed';
      expect(await scope.isActive()).toBe(false);
      await expect(scope.resolve('tsk_alice', [row.externalId])).rejects.toThrow('不可用');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);
it('does not treat deserialized file metadata as a server-validated admission', async () => {
  const f = await browserOutputFixture();
  try {
    const row = await f.service.storeUpload({
      userIdInternal: 7,
      userExternalId: 'usr_alice',
      filename: 'report.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from('a,b\n1,2\n'),
    });
    const inputs = BrowserTaskFiles.validatedReferences(
      await f.service.loadMany([row.externalId], 7),
      7,
    );
    const scope = createBrowserTaskFileScope({
      db: f.db,
      files: f.service,
      userId: 7,
      taskId: 'tsk_alice',
      origin: 'user',
      inputs: [],
    });
    const clientCopy = JSON.parse(JSON.stringify(inputs)) as ValidatedBrowserTaskFile[];
    expect(() => scope.admitReferences(clientCopy)).toThrow();
    expect(scope.references()).toEqual([]);
    scope.admitReferences(inputs);
    expect(scope.references()[0]?.fileId).toBe(row.externalId);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
