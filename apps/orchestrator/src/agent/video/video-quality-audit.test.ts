import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
