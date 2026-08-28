import { describe, expect, it, vi } from 'vitest';
import { FileService, MAX_CLIENT_VIDEO_EXPORT_BYTES } from './file-service.js';

function harness(stat: { sizeBytes: number; contentType?: string } | null) {
  let row: Record<string, unknown> | undefined;
  const db = {
    insert: () => ({
      values: async (value: Record<string, unknown>) => {
        row = { ...value, id: 91 };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (row ? [row] : []) }),
      }),
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => ({
        where: async () => {
          row = { ...row, ...value };
        },
      }),
    }),
  };
  const storage = {
    getSignedPutUrl: vi.fn(async () => ({
      url: 'https://upload.example/output',
      storagePath: 'usr/output/file/holaday-edited.mp4',
    })),
    stat: vi.fn(async () => stat),
    delete: vi.fn(async () => undefined),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    service: new FileService(db as never, logger as never, storage as never),
    storage,
    getRow: () => row,
  };
}

describe('FileService client video output', () => {
  it('reserves an output-only MP4 target and activates the verified real size', async () => {
    const fixture = harness({ sizeBytes: 12_345, contentType: 'video/mp4' });
    const pending = await fixture.service.createPendingClientOutput({
      userIdInternal: 7,
      userExternalId: 'usr_owner',
      filename: '../edited.mp4',
      expiresAt: new Date(Date.now() + 15 * 60 * 1_000),
    });

    expect(pending).toMatchObject({
      uploadUrl: 'https://upload.example/output',
      requiredHeaders: { 'Content-Type': 'video/mp4' },
      row: { kind: 'output', taskId: null, status: 'pending', mimetype: 'video/mp4' },
    });
    if (!pending) throw new Error('expected a signed upload target');
    const result = await fixture.service.confirmClientOutput(pending.row.externalId, 7);
    expect(result).toMatchObject({
      status: 'completed',
      row: { status: 'active', sizeBytes: 12_345, mimetype: 'video/mp4' },
    });
    expect(fixture.storage.stat).toHaveBeenCalledWith('usr/output/file/holaday-edited.mp4');
  });

  it('rejects oversized or non-MP4 bytes before activation', async () => {
    for (const stat of [
      { sizeBytes: MAX_CLIENT_VIDEO_EXPORT_BYTES + 1, contentType: 'video/mp4' },
      { sizeBytes: 12_345, contentType: 'text/html' },
    ]) {
      const fixture = harness(stat);
      const pending = await fixture.service.createPendingClientOutput({
        userIdInternal: 7,
        userExternalId: 'usr_owner',
        filename: 'edited.mp4',
        expiresAt: new Date(Date.now() + 15 * 60 * 1_000),
      });
      if (!pending) throw new Error('expected a signed upload target');
      const result = await fixture.service.confirmClientOutput(pending.row.externalId, 7);
      expect(result.status).toBe(
        stat.sizeBytes > MAX_CLIENT_VIDEO_EXPORT_BYTES ? 'too_large' : 'invalid_mime',
      );
      expect(fixture.getRow()?.status).toBe('pending');
    }
  });
});
