import { describe, expect, it } from 'vitest';
import { annotateTaskResultAttachmentAvailability } from './task-result-attachment-availability.js';

describe('task result attachment availability', () => {
  const now = new Date('2026-07-23T10:00:00.000Z');

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

    expect(
      annotateTaskResultAttachmentAvailability(result, new Set(), now),
    ).toEqual(result);
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
        new Set([
          'file_video',
          'file_video_legacy',
          'file_video_external',
          'file_poster_active',
        ]),
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
    expect(result.metadata.attachments[0]).not.toHaveProperty(
      'posterAvailability',
    );
  });
});
