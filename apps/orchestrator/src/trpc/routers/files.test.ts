import { describe, expect, it } from 'vitest';
import { __filesRouterInternals } from './files.js';

const { fileMatchesLibraryFilter } = __filesRouterInternals;

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
