import { describe, expect, it } from 'vitest';
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
