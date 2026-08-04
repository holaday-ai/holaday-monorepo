import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fileAvailabilityKey,
  isFileUnavailable,
  markFileUnavailable,
  markFileUnavailableFromStatus,
  resetUnavailableFilesForTests,
  subscribeUnavailableFiles,
} from './unavailable-file-registry.js';

describe('unavailable file registry', () => {
  beforeEach(() => {
    resetUnavailableFilesForTests();
  });

  it('uses one identity for a file id and current or legacy download URLs', () => {
    expect(fileAvailabilityKey('file_123')).toBe('file:file_123');
    expect(fileAvailabilityKey('/api/files/file_123/download?download=1#ready')).toBe(
      'file:file_123',
    );
    expect(fileAvailabilityKey('/files/file_123/download')).toBe('file:file_123');
    expect(
      fileAvailabilityKey({
        fileId: 'file_123',
        url: '/api/files/file_123/download',
      }),
    ).toBe('file:file_123');
  });

  it('rejects external and non-download URLs instead of poisoning the registry', () => {
    expect(fileAvailabilityKey('https://media.example/poster.jpg')).toBeNull();
    expect(fileAvailabilityKey('/api/files/file_123/preview')).toBeNull();
    expect(
      fileAvailabilityKey({
        fileId: 'file_123',
        url: 'https://media.example/poster.jpg',
      }),
    ).toBeNull();

    expect(markFileUnavailable('https://media.example/poster.jpg')).toBe(false);
    expect(isFileUnavailable('file_123')).toBe(false);
  });

  it('shares a definitive unavailable result across remount-compatible references', () => {
    expect(
      markFileUnavailableFromStatus('/api/files/file_123/download', 404),
    ).toBe(true);
    expect(isFileUnavailable('file_123')).toBe(true);
    expect(isFileUnavailable('/files/file_123/download?legacy=1')).toBe(true);
  });

  it('does not remember auth, server, or network failures as file loss', () => {
    expect(markFileUnavailableFromStatus('file_123', 401)).toBe(false);
    expect(markFileUnavailableFromStatus('file_123', 500)).toBe(false);
    expect(markFileUnavailableFromStatus('file_123', null)).toBe(false);
    expect(isFileUnavailable('file_123')).toBe(false);
  });

  it('notifies subscribers once when the same file is marked repeatedly', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUnavailableFiles(listener);

    expect(markFileUnavailable('file_123')).toBe(true);
    expect(markFileUnavailable('/api/files/file_123/download')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(markFileUnavailable('file_456')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
