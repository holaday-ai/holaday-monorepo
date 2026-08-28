import { describe, expect, it, vi } from 'vitest';
import { __filesRouterInternals } from './files.js';

const {
  fileAvailabilityItems,
  fileIsAvailableInLibrary,
  fileMatchesLibraryFilter,
  libraryFilenameSearchTerms,
  normalizeLibraryFilename,
  saveLibraryOutput,
} = __filesRouterInternals;

describe('files router legacy filename compatibility', () => {
  it('recovers UTF-8 filenames that legacy uploads stored as Latin-1', () => {
    expect(normalizeLibraryFilename('å¨æ¥æ¨¡æ¿.xlsx')).toBe('周报模板.xlsx');
  });

  it('recovers legacy mojibake after an NBSP byte was normalized to a space', () => {
    expect(normalizeLibraryFilename('åä¹±ç´ æ.txt')).toBe('凌乱素材.txt');
  });

  it('preserves correct Unicode and genuine Latin-1 filenames', () => {
    expect(normalizeLibraryFilename('正常文件.pdf')).toBe('正常文件.pdf');
    expect(normalizeLibraryFilename('café.docx')).toBe('café.docx');
  });

  it('searches both the user-facing name and its legacy stored form', () => {
    expect(libraryFilenameSearchTerms(' 周报模板 ')).toEqual([
      '周报模板',
      Buffer.from('周报模板', 'utf8').toString('latin1'),
    ]);
  });

  it('searches the lossy space-normalized legacy form', () => {
    expect(libraryFilenameSearchTerms('凌乱素材')).toEqual([
      '凌乱素材',
      Buffer.from('凌乱素材', 'utf8').toString('latin1'),
      'åä¹±ç´ æ',
    ]);
  });

  it('does not duplicate ASCII search terms', () => {
    expect(libraryFilenameSearchTerms(' report ')).toEqual(['report']);
    expect(libraryFilenameSearchTerms('   ')).toEqual([]);
  });
});

describe('files router library availability', () => {
  const now = new Date('2026-07-23T10:00:00.000Z');

  it('keeps active files with no expiry or a future expiry', () => {
    expect(fileIsAvailableInLibrary({ status: 'active', expiresAt: null }, now)).toBe(true);
    expect(
      fileIsAvailableInLibrary(
        { status: 'active', expiresAt: new Date('2026-07-23T10:00:01.000Z') },
        now,
      ),
    ).toBe(true);
  });

  it('drops pending, expired, and time-expired rows', () => {
    expect(fileIsAvailableInLibrary({ status: 'pending', expiresAt: null }, now)).toBe(false);
    expect(fileIsAvailableInLibrary({ status: 'expired', expiresAt: null }, now)).toBe(false);
    expect(
      fileIsAvailableInLibrary(
        { status: 'active', expiresAt: new Date('2026-07-23T09:59:59.000Z') },
        now,
      ),
    ).toBe(false);
  });
});

describe('files router library filters', () => {
  it('treats videos as a first-class filter', () => {
    expect(fileMatchesLibraryFilter('video/mp4', 'videos')).toBe(true);
    expect(fileMatchesLibraryFilter('video/quicktime', 'videos')).toBe(true);
    expect(fileMatchesLibraryFilter('image/png', 'videos')).toBe(false);
    expect(fileMatchesLibraryFilter('application/pdf', 'videos')).toBe(false);
  });

  it('keeps documents from swallowing image and video media', () => {
    expect(fileMatchesLibraryFilter('application/pdf', 'documents')).toBe(true);
    expect(fileMatchesLibraryFilter('text/markdown', 'documents')).toBe(true);
    expect(fileMatchesLibraryFilter('image/jpeg', 'documents')).toBe(false);
    expect(fileMatchesLibraryFilter('video/webm', 'documents')).toBe(false);
  });

  it('keeps all/images filters stable', () => {
    expect(fileMatchesLibraryFilter('video/mp4', 'all')).toBe(true);
    expect(fileMatchesLibraryFilter('image/png', 'all')).toBe(true);
    expect(fileMatchesLibraryFilter('image/png', 'images')).toBe(true);
    expect(fileMatchesLibraryFilter('video/mp4', 'images')).toBe(false);
  });
});

describe('files router library deletion', () => {
  it('delegates deletion to FileService so backing storage is removed', async () => {
    const deleteForUser = vi.fn(async () => true);

    await expect(
      __filesRouterInternals.deleteLibraryFile({ deleteForUser }, 'file_owned', 7),
    ).resolves.toEqual({ ok: true });

    expect(deleteForUser).toHaveBeenCalledWith('file_owned', 7);
  });

  it('keeps unknown and foreign files indistinguishable', async () => {
    const deleteForUser = vi.fn(async () => false);

    await expect(
      __filesRouterInternals.deleteLibraryFile({ deleteForUser }, 'file_foreign', 7),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'file not found',
    });
  });
});

describe('files router image result lifecycle', () => {
  it('returns only caller-scoped boolean availability in input order', async () => {
    const isReadableForUser = vi.fn(
      async (fileId: string, userId: number) => fileId === 'file_active' && userId === 7,
    );

    await expect(
      fileAvailabilityItems(
        { isReadableForUser },
        ['file_active', 'file_expired', 'file_foreign'],
        7,
      ),
    ).resolves.toEqual([
      { fileId: 'file_active', available: true },
      { fileId: 'file_expired', available: false },
      { fileId: 'file_foreign', available: false },
    ]);
    expect(isReadableForUser).toHaveBeenCalledTimes(3);
  });

  it('saves an owned output and keeps missing and foreign files indistinguishable', async () => {
    const saveOutputToLibraryForUser = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(
      saveLibraryOutput({ saveOutputToLibraryForUser }, 'file_owned', 7),
    ).resolves.toEqual({ ok: true });
    await expect(
      saveLibraryOutput({ saveOutputToLibraryForUser }, 'file_foreign', 7),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'file not found' });
  });
});
