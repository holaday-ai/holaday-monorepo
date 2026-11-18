import { rm } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { browserOutputFixture } from './testing/browser-output-fixture.js';

it('keeps a live Home file after more than fifty later task downloads and temp files', async () => {
  const f = await browserOutputFixture();
  try {
    const home = await f.service.storeBrowserOutput({
      userIdInternal: 7,
      userExternalId: 'usr_alice',
      filename: 'home.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from('item,count\na,1\n'),
      source: {
        version: 1,
        kind: 'personal_home',
        sessionId: 'bhs_usr_alice',
        instanceId: '9f76fe69-c29e-400e-ac94-5c223646c48a',
        origin: 'https://fixture.test',
        taskId: null,
      },
    });
    for (let index = 2; index < 70; index++)
      f.records.push({
        ...home,
        id: index,
        externalId: `file_other_${index}`,
        ...(index % 2
          ? { kind: 'temp' }
          : {
              browserSource: {
                version: 1,
                kind: 'task_download',
                taskId: 'tsk_alice',
                origin: 'https://fixture.test',
                originBasis: 'download_url',
                sha256: 'a'.repeat(64),
              },
            }),
      });
    const listed = await f.service.listBrowserOutputsForUser(7);
    expect(listed.map((row) => row.fileId)).toEqual([home.externalId]);
    expect(listed[0]?.available).toBe(true);
    expect(await f.service.listBrowserOutputsForUser(8)).toEqual([]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
