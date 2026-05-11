import { describe, expect, it, vi } from 'vitest';

import { buildDownloadUrl, DownloadManager, MAX_DOWNLOAD_BYTES } from './download-manager.js';
import type { FileService } from './file-service.js';
import type { TaskFile } from '../db/schema/task-files.js';

function fakeFileService(storedFilename = 'shot.png'): {
  service: FileService;
  calls: Array<{ buffer: Buffer; filename: string; mimetype: string }>;
} {
  const calls: Array<{ buffer: Buffer; filename: string; mimetype: string }> = [];
  const service = {
    storeOutput: vi.fn(async (opts: {
      buffer: Buffer;
      filename: string;
      mimetype: string;
      userIdInternal: number;
      userExternalId: string;
      taskIdInternal: number;
    }): Promise<TaskFile> => {
      calls.push({
        buffer: opts.buffer,
        filename: opts.filename,
        mimetype: opts.mimetype,
      });
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      return {
        id: 42,
        externalId: 'file_test_abc',
        userId: opts.userIdInternal,
        taskId: opts.taskIdInternal,
        kind: 'output',
        filename: storedFilename,
        mimetype: opts.mimetype,
        sizeBytes: opts.buffer.length,
        storagePath: `/tmp/${opts.userExternalId}/output/file_test_abc/${storedFilename}`,
        status: 'active',
        createdAt: new Date(),
        expiresAt,
      } as TaskFile;
    }),
  } as unknown as FileService;
  return { service, calls };
}

describe('DownloadManager.save', () => {
  it('persists a Buffer and returns shaped DownloadResult', async () => {
    const { service, calls } = fakeFileService();
    const dm = new DownloadManager(service, 'https://holaday.ai');
    const r = await dm.save({
      userIdInternal: 1,
      userExternalId: 'usr_x',
      taskIdInternal: 100,
      content: Buffer.from('PNG-bytes-here'),
      filename: 'shot.png',
      mimetype: 'image/png',
    });
    expect(r.fileId).toBe('file_test_abc');
    expect(r.downloadUrl).toBe('https://holaday.ai/files/file_test_abc/download');
    expect(r.filename).toBe('shot.png');
    expect(r.mimetype).toBe('image/png');
    expect(r.sizeBytes).toBe(14);
    expect(r.expiresAt).toBeInstanceOf(Date);
    expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.buffer.toString()).toBe('PNG-bytes-here');
  });

  it('decodes a base64 string content', async () => {
    const { service, calls } = fakeFileService();
    const dm = new DownloadManager(service, 'https://holaday.ai');
    const original = 'hello-world';
    const b64 = Buffer.from(original).toString('base64');
    await dm.save({
      userIdInternal: 1,
      userExternalId: 'usr_x',
      taskIdInternal: 100,
      content: b64,
      filename: 'note.txt',
      mimetype: 'text/plain',
    });
    expect(calls[0]!.buffer.toString()).toBe(original);
  });

  it('builds a root-relative URL when publicBaseUrl is empty', async () => {
    const { service } = fakeFileService();
    const dm = new DownloadManager(service); // default ''
    const r = await dm.save({
      userIdInternal: 1,
      userExternalId: 'usr_x',
      taskIdInternal: 100,
      content: Buffer.from('x'),
      filename: 'x.txt',
      mimetype: 'text/plain',
    });
    expect(r.downloadUrl).toBe('/files/file_test_abc/download');
  });

  it('trims trailing slashes off publicBaseUrl', async () => {
    const { service } = fakeFileService();
    const dm = new DownloadManager(service, 'https://holaday.ai///');
    const r = await dm.save({
      userIdInternal: 1,
      userExternalId: 'usr_x',
      taskIdInternal: 100,
      content: Buffer.from('x'),
      filename: 'x.txt',
      mimetype: 'text/plain',
    });
    expect(r.downloadUrl).toBe('https://holaday.ai/files/file_test_abc/download');
  });

  it('refuses empty content', async () => {
    const { service } = fakeFileService();
    const dm = new DownloadManager(service);
    await expect(
      dm.save({
        userIdInternal: 1,
        userExternalId: 'usr_x',
        taskIdInternal: 100,
        content: Buffer.alloc(0),
        filename: 'empty.txt',
        mimetype: 'text/plain',
      }),
    ).rejects.toThrow(/empty/);
  });

  it('refuses content larger than MAX_DOWNLOAD_BYTES (50 MB)', async () => {
    const { service, calls } = fakeFileService();
    const dm = new DownloadManager(service);
    // Just past the limit — a 50MB+1 byte buffer
    const tooBig = Buffer.alloc(MAX_DOWNLOAD_BYTES + 1);
    await expect(
      dm.save({
        userIdInternal: 1,
        userExternalId: 'usr_x',
        taskIdInternal: 100,
        content: tooBig,
        filename: 'huge.bin',
        mimetype: 'application/octet-stream',
      }),
    ).rejects.toThrow(/too large/);
    // storeOutput was NOT called — guard fired before persistence
    expect(calls).toHaveLength(0);
  });

  it('allows exactly MAX_DOWNLOAD_BYTES (boundary)', async () => {
    const { service, calls } = fakeFileService();
    const dm = new DownloadManager(service);
    const atLimit = Buffer.alloc(MAX_DOWNLOAD_BYTES);
    await dm.save({
      userIdInternal: 1,
      userExternalId: 'usr_x',
      taskIdInternal: 100,
      content: atLimit,
      filename: 'exact.bin',
      mimetype: 'application/octet-stream',
    });
    expect(calls).toHaveLength(1);
  });
});

describe('buildDownloadUrl', () => {
  it('joins base + file id', () => {
    expect(buildDownloadUrl('https://x.com', 'file_abc')).toBe(
      'https://x.com/files/file_abc/download',
    );
  });

  it('strips trailing slashes', () => {
    expect(buildDownloadUrl('https://x.com//', 'file_abc')).toBe(
      'https://x.com/files/file_abc/download',
    );
  });

  it('handles empty base (root-relative)', () => {
    expect(buildDownloadUrl('', 'file_abc')).toBe('/files/file_abc/download');
  });
});
