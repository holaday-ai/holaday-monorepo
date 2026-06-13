import { describe, expect, it } from 'vitest';
import {
  InvalidR2KeySegmentError,
  isPlaybookKey,
  isTaskEvidenceKey,
  playbookArtifactKey,
  sanitizeArtifactFilename,
  taskEvidenceKey,
} from './r2-keys.js';

describe('playbookArtifactKey', () => {
  it('builds playbook/{site}/{run}/{artifact}/{filename}', () => {
    const key = playbookArtifactKey({
      siteExternalId: 'site_abc',
      runExternalId: 'exr_def',
      artifactExternalId: 'art_ghi',
      filename: 'home.png',
    });
    expect(key).toBe('playbook/site_abc/exr_def/art_ghi/home.png');
    expect(isPlaybookKey(key)).toBe(true);
    expect(isTaskEvidenceKey(key)).toBe(false);
  });

  it('sanitizes the filename segment', () => {
    const key = playbookArtifactKey({
      siteExternalId: 'site_abc',
      runExternalId: 'exr_def',
      artifactExternalId: 'art_ghi',
      filename: '../../etc/passwd',
    });
    // directory parts stripped, only the basename survives
    expect(key).toBe('playbook/site_abc/exr_def/art_ghi/passwd');
  });

  it('rejects a slash-bearing external id (cannot escape the prefix)', () => {
    expect(() =>
      playbookArtifactKey({
        siteExternalId: 'site/../evil',
        runExternalId: 'exr_def',
        artifactExternalId: 'art_ghi',
        filename: 'x.png',
      }),
    ).toThrow(InvalidR2KeySegmentError);
  });

  it('rejects empty external id segments', () => {
    expect(() =>
      playbookArtifactKey({
        siteExternalId: '',
        runExternalId: 'exr_def',
        artifactExternalId: 'art_ghi',
        filename: 'x.png',
      }),
    ).toThrow(InvalidR2KeySegmentError);
  });
});

describe('taskEvidenceKey', () => {
  it('builds tasks/{task}/evidence/{artifact}/{filename}', () => {
    const key = taskEvidenceKey({
      taskExternalId: 'tsk_123',
      artifactExternalId: 'art_456',
      filename: 'final.png',
    });
    expect(key).toBe('tasks/tsk_123/evidence/art_456/final.png');
    expect(isTaskEvidenceKey(key)).toBe(true);
    expect(isPlaybookKey(key)).toBe(false);
  });
});

describe('sanitizeArtifactFilename', () => {
  it('keeps ascii names and dots/dashes/underscores', () => {
    expect(sanitizeArtifactFilename('report-2026_06.html')).toBe('report-2026_06.html');
  });

  it('keeps CJK characters', () => {
    expect(sanitizeArtifactFilename('携程首页.png')).toBe('携程首页.png');
  });

  it('strips directory components', () => {
    expect(sanitizeArtifactFilename('a/b/c/file.png')).toBe('file.png');
    expect(sanitizeArtifactFilename('a\\b\\file.png')).toBe('file.png');
  });

  it('collapses whitespace and odd chars to underscore', () => {
    expect(sanitizeArtifactFilename('my file (1).png')).toBe('my_file__1_.png');
  });

  it('falls back to artifact.bin when nothing usable remains', () => {
    expect(sanitizeArtifactFilename('')).toBe('artifact.bin');
    expect(sanitizeArtifactFilename('...')).toBe('artifact.bin');
    expect(sanitizeArtifactFilename('/')).toBe('artifact.bin');
  });

  it('drops leading dots so a sanitized name is never a dot segment', () => {
    expect(sanitizeArtifactFilename('.htaccess')).toBe('htaccess');
  });
});
