import { mkdtemp, readFile, readdir, rm, stat, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as auditModule from './video-quality-audit.js';
import { retainRejectedVideoFrames } from './video-quality-audit.js';

describe('private rejected video evidence', () => {
  it('survives workdir cleanup, excludes reference/private URLs and enforces private permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qa-audit-test-'));
    const workdir = await mkdtemp(join(tmpdir(), 'qa-video-test-'));
    try {
      await writeFile(join(workdir, 'quality-frame-01.jpg'), Buffer.from('rejected frame'));
      await writeFile(join(workdir, 'quality-reference-1-1.jpg'), Buffer.from('private input'));
      const id = await retainRejectedVideoFrames({
        root,
        workdir,
        taskId: 'tsk_audit',
        verdict: {
          status: 'fail',
          failedChecks: ['unauthorized_text_or_brand'],
          reason: 'unexpected lettering',
        },
      });
      await rm(workdir, { recursive: true, force: true });
      const audit = join(root, id);
      expect((await stat(audit)).mode & 0o777).toBe(0o700);
      expect((await stat(join(audit, 'quality-frame-01.jpg'))).mode & 0o777).toBe(0o600);
      expect(await readFile(join(audit, 'quality-frame-01.jpg'), 'utf8')).toBe('rejected frame');
      expect(await readdir(audit)).toEqual(['manifest.json', 'quality-frame-01.jpg']);
      expect(JSON.parse(await readFile(join(audit, 'manifest.json'), 'utf8'))).toMatchObject({
        taskId: 'tsk_audit',
        frames: ['quality-frame-01.jpg'],
        status: 'fail',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(workdir, { recursive: true, force: true });
    }
  });
  it('rejects a task id containing traversal before creating any evidence', async () => {
    await expect(
      retainRejectedVideoFrames({
        root: '/tmp',
        workdir: '/tmp',
        taskId: '../escape',
        verdict: { status: 'fail', failedChecks: [], reason: '' },
      }),
    ).rejects.toThrow('task id');
  });
});

describe('scheduled rejected frame expiry', () => {
  it('expires only completed rejected evidence, preserves delivered output and symlinks, and obeys retention', async () => {
    expect(typeof auditModule.cleanupRejectedVideoFrames).toBe('function');
    const root = await mkdtemp(join(tmpdir(), 'qa-reaper-'));
    const workdir = await mkdtemp(join(tmpdir(), 'qa-workdir-'));
    try {
      await writeFile(join(workdir, 'quality-frame-01.jpg'), 'frame');
      const id = await retainRejectedVideoFrames({
        root,
        workdir,
        taskId: 'tsk_expired',
        verdict: { status: 'fail', failedChecks: [], reason: 'rejected' },
      });
      const manifest = join(root, id, 'manifest.json');
      const m = JSON.parse(await readFile(manifest, 'utf8'));
      const protectedId = await retainRejectedVideoFrames({
        root,
        workdir,
        taskId: 'tsk_output',
        verdict: { status: 'fail', failedChecks: [], reason: 'rejected' },
      });
      await writeFile(join(root, protectedId, 'video.mp4'), 'delivered');
      m.recordedAt = new Date(Date.now() - 8 * 86400000).toISOString();
      await writeFile(manifest, JSON.stringify(m));
      const protectedManifest = join(root, protectedId, 'manifest.json');
      const pm = JSON.parse(await readFile(protectedManifest, 'utf8'));
      pm.recordedAt = m.recordedAt;
      await writeFile(protectedManifest, JSON.stringify(pm));
      await symlink(workdir, join(root, 'tsk_link-abcdef'));
      expect(await auditModule.cleanupRejectedVideoFrames({ root, retentionDays: 10 })).toBe(0);
      expect(await auditModule.cleanupRejectedVideoFrames({ root })).toBe(1);
      await expect(stat(join(root, id))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(join(root, protectedId, 'video.mp4'), 'utf8')).toBe('delivered');
      expect(await readFile(join(workdir, 'quality-frame-01.jpg'), 'utf8')).toBe('frame');
      expect(await auditModule.cleanupRejectedVideoFrames({ root })).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(workdir, { recursive: true, force: true });
    }
  });
});
