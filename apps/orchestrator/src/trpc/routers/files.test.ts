import { describe, expect, it, vi } from 'vitest';
import { __filesRouterInternals } from './files.js';

const { fileIsAvailableInLibrary, fileMatchesLibraryFilter } =
  __filesRouterInternals;

describe('files router library availability', () => {
  const now = new Date('2026-07-23T10:00:00.000Z');

  it('keeps active files with no expiry or a future expiry', () => {
    expect(
      fileIsAvailableInLibrary(
        { status: 'active', expiresAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      fileIsAvailableInLibrary(
        { status: 'active', expiresAt: new Date('2026-07-23T10:00:01.000Z') },
        now,
      ),
    ).toBe(true);
  });

  it('drops pending, expired, and time-expired rows', () => {
    expect(
      fileIsAvailableInLibrary(
        { status: 'pending', expiresAt: null },
        now,
      ),
    ).toBe(false);
    expect(
      fileIsAvailableInLibrary(
        { status: 'expired', expiresAt: null },
        now,
      ),
    ).toBe(false);
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
      __filesRouterInternals.deleteLibraryFile(
        { deleteForUser },
        'file_owned',
        7,
      ),
    ).resolves.toEqual({ ok: true });

    expect(deleteForUser).toHaveBeenCalledWith('file_owned', 7);
  });

  it('keeps unknown and foreign files indistinguishable', async () => {
    const deleteForUser = vi.fn(async () => false);

    await expect(
      __filesRouterInternals.deleteLibraryFile(
        { deleteForUser },
        'file_foreign',
        7,
      ),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'file not found',
    });
  });
});
