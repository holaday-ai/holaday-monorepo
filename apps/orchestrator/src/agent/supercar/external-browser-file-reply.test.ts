import { rm } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { createBrowserTaskFileScope } from '../../files/browser-task-file-scope.js';
import { browserOutputFixture } from '../../files/testing/browser-output-fixture.js';
import {
  BrowserTaskFiles,
  type ValidatedBrowserTaskFile,
} from '../browser-tools/browser-task-files.js';
import { createExternalBrowserPark, validateExternalBrowserReply } from './agent-loop.js';
import { supercarReply } from './qwen-only-agent-loop.js';

it('preflights reply file authority without admitting before the wait is actually accepted', async () => {
  const f = await browserOutputFixture();
  const row = await f.service.storeUpload({
    userIdInternal: 7,
    userExternalId: 'usr_alice',
    filename: 'report.csv',
    mimetype: 'text/csv',
    buffer: Buffer.from('sku,qty\nA-731,31\n'),
  });
  const references = BrowserTaskFiles.validatedReferences(
    await f.service.loadMany([row.externalId], 7),
    7,
  );
  const scope = createBrowserTaskFileScope({
    db: f.db,
    files: f.service,
    taskId: 'tsk_alice',
    userId: 7,
    origin: 'user',
    inputs: [],
  });
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const handle = createExternalBrowserPark({
    taskId: 'tsk_alice',
    intent: '处理网页',
    browserTaskFiles: scope,
    aborted: () => false,
    onAwaitingUser: async () => started(),
    timeoutMs: 2000,
  });
  const pending = handle.park('提供文件', 'clarification');
  try {
    await entered;
    const forged = JSON.parse(JSON.stringify(references)) as ValidatedBrowserTaskFile[];
    expect(() => validateExternalBrowserReply('tsk_alice', [], false, forged)).toThrow();
    expect(supercarReply('tsk_alice', '材料', [], forged)).toBe(false);
    expect(scope.references()).toEqual([]);
    validateExternalBrowserReply('tsk_alice', [], false, references);
    expect(scope.references()).toEqual([]);
    expect(supercarReply('tsk_alice', '材料已提供', [], references)).toBe(true);
    expect(await pending).toBe('材料已提供');
    expect(scope.references()).toMatchObject([{ fileId: row.externalId }]);
  } finally {
    handle.close();
    await pending;
    await rm(f.root, { recursive: true, force: true });
  }
});
