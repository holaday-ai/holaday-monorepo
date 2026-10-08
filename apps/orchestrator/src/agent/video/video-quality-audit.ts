import { constants } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { VideoQualityResult } from './video-quality-verifier.js';

/** Internal evidence only: never registered with FileService or exposed as an attachment. */
export async function retainRejectedVideoFrames(input: {
  taskId: string;
  workdir: string;
  verdict: VideoQualityResult;
  root?: string;
}): Promise<string> {
  if (!/^tsk_[a-zA-Z0-9_-]{1,100}$/.test(input.taskId)) throw new Error('invalid task id');
  if (input.verdict.status !== 'fail') throw new Error('only rejected video evidence is retained');
  const root = input.root ?? join(tmpdir(), 'hd-video-quality-audit');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  // Bound retention to seven days / 100 recent rejects. Do not remove an in-flight audit.
  const entries = (await readdir(root, { withFileTypes: true })).filter(
    (e) => e.isDirectory() && /^tsk_[\w-]+-/.test(e.name),
  );
  const dated = [];
  for (const entry of entries) {
    const info = await stat(join(root, entry.name));
    dated.push({ name: entry.name, time: info.mtimeMs });
  }
  dated.sort((a, b) => b.time - a.time);
  for (const [index, entry] of dated.entries()) {
    const age = Date.now() - entry.time;
    if (age > 7 * 86_400_000 || (index >= 99 && age > 3_600_000))
      await rm(join(root, entry.name), { recursive: true, force: true });
  }
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
