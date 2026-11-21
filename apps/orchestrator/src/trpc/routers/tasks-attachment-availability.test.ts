import { describe, expect, it } from 'vitest';
import { annotateTaskResultAttachmentAvailability } from './task-result-attachment-availability.js';

describe('task result attachment availability', () => {
  const now = new Date('2026-07-23T10:00:00.000Z');

  const saved = {
    externalId: 'file_saved',
    filename: 'original.json',
    mimetype: 'application/json',
    sizeBytes: 7560,
    expiresAt: new Date('2026-07-24T10:00:00.000Z'),
  };
  it('preserves an existing screenshot role for the same saved image', () => {
    const image = { ...saved, filename: 'evidence.jpg', mimetype: 'image/jpeg' };
    const result = {
      metadata: { attachments: [{ fileId: saved.externalId, kind: 'screenshot' }] },
    };
    expect(
      annotateTaskResultAttachmentAvailability(result, new Set([saved.externalId]), now, [image]),
    ).toMatchObject({
      metadata: { attachments: [{ kind: 'screenshot', mimetype: 'image/jpeg' }] },
    });
  });
  it('recovers a saved output when terminal metadata was never committed', () => {
    const result = { executionMode: 'browser' };
    const restored = annotateTaskResultAttachmentAvailability(
      result,
      new Set([saved.externalId]),
      now,
      [saved],
    );
    expect(restored).toMatchObject({
      executionMode: 'browser',
      metadata: {
        attachments: [
          {
            fileId: saved.externalId,
            filename: saved.filename,
            mimetype: saved.mimetype,
            sizeBytes: 7560,
            downloadUrl: '/api/files/file_saved/download',
            kind: 'json',
            expiresAt: saved.expiresAt.toISOString(),
          },
        ],
      },
    });
    expect(restored).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('metadata');
  });
  it('uses scoped inventory fields over stale metadata and keeps different file IDs', () => {
    const result = {
      summary: 'unfinished',
      metadata: {
        attachments: [
          {
            fileId: saved.externalId,
            filename: 'wrong.csv',
            downloadUrl: 'https://foreign.example/file',
            availability: 'unavailable',
          },
          { fileId: saved.externalId, filename: 'duplicate.csv' },
        ],
      },
    };
    const second = { ...saved, externalId: 'file_second' };
    const restored = annotateTaskResultAttachmentAvailability(
      result,
      new Set([saved.externalId, second.externalId]),
      now,
      [saved, second],
    ) as typeof result;
    expect(restored.summary).toBe('unfinished');
    expect(restored.metadata.attachments).toHaveLength(2);
    expect(restored.metadata.attachments[0]).toMatchObject({
      filename: saved.filename,
      downloadUrl: '/api/files/file_saved/download',
    });
    expect(restored.metadata.attachments[0]?.availability).not.toBe('unavailable');
    expect(restored.metadata.attachments[1]).toMatchObject({ fileId: second.externalId });
  });
  it('does not resurrect an expired or unscoped inventory row', () => {
    const result = { executionMode: 'browser' };
    expect(annotateTaskResultAttachmentAvailability(result, new Set(), now, [saved])).toEqual(
      result,
    );
    expect(
      annotateTaskResultAttachmentAvailability(result, new Set([saved.externalId]), now, [
        { ...saved, expiresAt: new Date('2026-07-23T09:59:59.000Z') },
      ]),
    ).toEqual(result);
  });
  it.each([null, undefined])(
    'recovers an existing non-expiring file with an absent result (%s)',
    (result) => {
      const restored = annotateTaskResultAttachmentAvailability(
        result,
        new Set([saved.externalId]),
        now,
        [{ ...saved, expiresAt: null }],
      );
      expect(restored).toMatchObject({
        metadata: {
          attachments: [
            {
              fileId: saved.externalId,
              expiresAt: '',
              downloadUrl: '/api/files/file_saved/download',
            },
          ],
        },
      });
      expect(restored).not.toHaveProperty('status');
    },
  );

  it('marks a missing live attachment unavailable without mutating the result', () => {
    const result = {
      summary: 'done',
      metadata: {
        attachments: [
          {
            fileId: 'file_active',
            expiresAt: '2026-07-23T11:00:00.000Z',
          },
          {
            fileId: 'file_missing',
            expiresAt: '2026-07-23T11:00:00.000Z',
          },
        ],
      },
    };

    const annotated = annotateTaskResultAttachmentAvailability(
      result,
      new Set(['file_active']),
      now,
    ) as typeof result;

    expect(annotated.metadata.attachments).toEqual([
      {
        fileId: 'file_active',
        expiresAt: '2026-07-23T11:00:00.000Z',
      },
      {
        fileId: 'file_missing',
        expiresAt: '2026-07-23T11:00:00.000Z',
        availability: 'unavailable',
      },
    ]);
    expect(result.metadata.attachments[1]).not.toHaveProperty('availability');
  });

  it('leaves known-expired and malformed attachment metadata unchanged', () => {
    const expired = {
      fileId: 'file_expired',
      expiresAt: '2026-07-23T09:59:59.000Z',
    };
    const malformed = { filename: 'missing-id.pdf' };
    const result = {
      metadata: {
        attachments: [expired, malformed],
      },
    };

    expect(annotateTaskResultAttachmentAvailability(result, new Set(), now)).toEqual(result);
  });

  it('marks a missing local poster unavailable without touching external posters', () => {
    const result = {
      metadata: {
        attachments: [
          {
            fileId: 'file_video',
            posterUrl: '/api/files/file_poster_missing/download?preview=1',
          },
          {
            fileId: 'file_video_legacy',
            posterUrl: '/files/file_poster_active/download',
          },
          {
            fileId: 'file_video_external',
            posterUrl: 'https://media.example/poster.jpg',
          },
        ],
      },
    };

    expect(
      annotateTaskResultAttachmentAvailability(
        result,
        new Set(['file_video', 'file_video_legacy', 'file_video_external', 'file_poster_active']),
        now,
      ),
    ).toEqual({
      metadata: {
        attachments: [
          {
            fileId: 'file_video',
            posterUrl: '/api/files/file_poster_missing/download?preview=1',
            posterAvailability: 'unavailable',
          },
          {
            fileId: 'file_video_legacy',
            posterUrl: '/files/file_poster_active/download',
          },
          {
            fileId: 'file_video_external',
            posterUrl: 'https://media.example/poster.jpg',
          },
        ],
      },
    });
    expect(result.metadata.attachments[0]).not.toHaveProperty('posterAvailability');
  });
});
