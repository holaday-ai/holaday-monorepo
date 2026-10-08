import { constants } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, readdir, rm, lstat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { VideoQualityResult } from './video-quality-verifier.js';

/** Internal evidence only: never registered with FileService or exposed as an attachment. */
export async function retainRejectedVideoFrames(input: {
  taskId: string;
  workdir: string;
  verdict: VideoQualityResult;
  root?: string;
  retentionDays?: number;
}): Promise<string> {
  if (!/^tsk_[a-zA-Z0-9_-]{1,100}$/.test(input.taskId)) throw new Error('invalid task id');
  if (input.verdict.status !== 'fail') throw new Error('only rejected video evidence is retained');
  const root = input.root ?? join(tmpdir(), 'hd-video-quality-audit');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  await cleanupRejectedVideoFrames({ root, retentionDays: input.retentionDays });
  const directory = await mkdtemp(join(root, `${input.taskId}-`));
  await chmod(directory, 0o700);
  const frames: string[] = [];
  try {
    for (let index = 1; index <= 9; index++) {
      const name = `quality-frame-${String(index).padStart(2, '0')}.jpg`;
      let file: Awaited<ReturnType<typeof open>>;
      try {
        file = await open(join(input.workdir, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > 2_000_000)
          throw new Error('quality frame exceeds evidence budget');
        await writeFile(join(directory, name), await file.readFile(), { mode: 0o600, flag: 'wx' });
        frames.push(name);
      } finally {
        await file.close();
      }
    }
    if (!frames.length) throw new Error('rejected video has no sampled frames');
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        taskId: input.taskId,
        recordedAt: new Date().toISOString(),
        status: input.verdict.status,
        failedChecks: input.verdict.failedChecks,
        reason: input.verdict.reason.slice(0, 2000),
        frames,
      }),
      { mode: 0o600, flag: 'wx' },
    );
    return basename(directory);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Only complete, expired rejection audits in the dedicated private root. */
export async function cleanupRejectedVideoFrames(
  options: {
    root?: string;
    retentionDays?: number;
    now?: number;
  } = {},
): Promise<number> {
  const root = options.root ?? join(tmpdir(), 'hd-video-quality-audit');
  const days = options.retentionDays ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('invalid audit retention');
  try {
    if (!(await lstat(root)).isDirectory()) return 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  const now = options.now ?? Date.now();
  let deleted = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^tsk_[a-zA-Z0-9_-]{1,100}-[a-zA-Z0-9]{6}$/.test(entry.name))
      continue;
    const directory = join(root, entry.name);
    let manifestFile: Awaited<ReturnType<typeof open>> | undefined;
    try {
      manifestFile = await open(
        join(directory, 'manifest.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const info = await manifestFile.stat();
      if (!info.isFile() || info.size > 16_384) continue;
      const manifest = JSON.parse(await manifestFile.readFile('utf8'));
      if (
        manifest.status !== 'fail' ||
        !/^tsk_[a-zA-Z0-9_-]{1,100}$/.test(manifest.taskId) ||
        !entry.name.startsWith(manifest.taskId + '-') ||
        !Array.isArray(manifest.frames) ||
        !manifest.frames.length ||
        manifest.frames.length > 9 ||
        !manifest.frames.every(
          (f: unknown) => typeof f === 'string' && /^quality-frame-0[1-9]\.jpg$/.test(f),
        )
      )
        continue;
      const time = Date.parse(manifest.recordedAt);
      if (!Number.isFinite(time) || now - time <= days * 86_400_000) continue;
      const allowed = new Set<string>(['manifest.json', ...manifest.frames]);
      const contents = await readdir(directory, { withFileTypes: true });
      // Any delivered file, unknown content or symlink makes this directory
      // ineligible. Never traverse or recursively delete user artifacts.
      if (contents.some((f) => !f.isFile() || !allowed.has(f.name))) continue;
      await rm(directory, { recursive: true, force: true });
      deleted++;
    } catch (error) {
      // Missing, partial or invalid manifests are not cleanup authority.
      if (
        error instanceof SyntaxError ||
        ['ENOENT', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')
      )
        continue;
      throw error;
    } finally {
      await manifestFile?.close();
    }
  }
  return deleted;
}
