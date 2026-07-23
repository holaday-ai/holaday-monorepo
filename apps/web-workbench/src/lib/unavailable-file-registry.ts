import * as React from 'react';

export type FileAvailabilityReference =
  | string
  | {
      fileId?: string | null;
      url?: string | null;
    }
  | null
  | undefined;

const FALLBACK_ORIGIN = 'https://holaday.local';
const listeners = new Set<() => void>();
let unavailableFiles: ReadonlySet<string> = new Set();

function runtimeOrigin(): string {
  if (
    typeof window !== 'undefined' &&
    typeof window.location?.origin === 'string' &&
    window.location.origin !== 'null'
  ) {
    return window.location.origin;
  }
  return FALLBACK_ORIGIN;
}

function fileIdKey(value: string | null | undefined): string | null {
  const fileId = value?.trim();
  if (
    !fileId ||
    fileId.includes('/') ||
    fileId.includes('?') ||
    fileId.includes('#') ||
    fileId.includes(':')
  ) {
    return null;
  }
  return `file:${fileId}`;
}

function downloadUrlKey(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  const origin = runtimeOrigin();
  try {
    const parsed = new URL(raw, origin);
    if (parsed.origin !== origin) return null;
    const match = /^\/(?:api\/)?files\/([^/]+)\/download\/?$/.exec(parsed.pathname);
    if (!match?.[1]) return null;
    return fileIdKey(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

/**
 * Canonical identity shared by task attachments, Files, and creative-history
 * posters. Only Holaday's authenticated file download route is accepted when
 * a URL is supplied; arbitrary media URLs never enter this registry.
 */
export function fileAvailabilityKey(
  reference: FileAvailabilityReference,
): string | null {
  if (!reference) return null;
  if (typeof reference === 'string') {
    const value = reference.trim();
    if (!value) return null;
    const looksLikeUrl =
      value.startsWith('/') ||
      value.startsWith('//') ||
      /^[a-z][a-z\d+.-]*:/i.test(value);
    return looksLikeUrl ? downloadUrlKey(value) : fileIdKey(value);
  }

  const rawUrl = reference.url?.trim();
  const keyFromId = fileIdKey(reference.fileId);
  if (!rawUrl) return keyFromId;

  const keyFromUrl = downloadUrlKey(rawUrl);
  if (!keyFromUrl) return null;
  if (keyFromId && keyFromId !== keyFromUrl) return null;
  return keyFromUrl;
}

export function subscribeUnavailableFiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUnavailableFilesSnapshot(): ReadonlySet<string> {
  return unavailableFiles;
}

export function isFileUnavailable(
  reference: FileAvailabilityReference,
  snapshot: ReadonlySet<string> = unavailableFiles,
): boolean {
  const key = fileAvailabilityKey(reference);
  return key !== null && snapshot.has(key);
}

export function markFileUnavailable(
  reference: FileAvailabilityReference,
): boolean {
  const key = fileAvailabilityKey(reference);
  if (!key || unavailableFiles.has(key)) return false;

  unavailableFiles = new Set([...unavailableFiles, key]);
  listeners.forEach((listener) => listener());
  return true;
}

export function markFileUnavailableFromStatus(
  reference: FileAvailabilityReference,
  status: number | null,
): boolean {
  if (status !== 404 && status !== 410) return false;
  return markFileUnavailable(reference);
}

export function useUnavailableFiles(): ReadonlySet<string> {
  return React.useSyncExternalStore(
    subscribeUnavailableFiles,
    getUnavailableFilesSnapshot,
    getUnavailableFilesSnapshot,
  );
}

export function useFileUnavailable(
  reference: FileAvailabilityReference,
): boolean {
  return isFileUnavailable(reference, useUnavailableFiles());
}

export function resetUnavailableFilesForTests(): void {
  unavailableFiles = new Set();
  listeners.clear();
}
