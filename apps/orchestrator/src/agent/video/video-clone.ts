import path from 'node:path';
import { promises as fs } from 'node:fs';
import { runFfmpeg } from './ffmpeg-exec.js';
import { downloadToBuffer } from './video-http.js';
import type { PipelineLogger } from './video-pipeline.js';
import { SimpleVideoError, type SimpleVideoConfig } from './video-lane-simple.js';
import {
  generateWanAnimateMix,
  type WanAnimateMixMode,
} from './wan-animate-mix-client.js';
import { generatePosterFile } from './video-poster.js';

export interface CloneVideoInput {
  readonly imageUrl: string;
  readonly referenceVideoUrl: string;
}

export interface CloneVideoOptions {
  readonly mode: WanAnimateMixMode;
}

export interface CloneVideoServices {
  storeOutput(input: { filename: string; mimetype: string; buffer: Buffer }): Promise<{
    fileId: string;
    storagePath: string;
  }>;
  workdir: string;
  logger: PipelineLogger;
  overrides?: Partial<CloneVideoFns>;
}

export interface CloneVideoFns {
  generateWanAnimateMix: typeof generateWanAnimateMix;
  downloadToBuffer: typeof downloadToBuffer;
  runFfmpeg: typeof runFfmpeg;
  writeFile: (filePath: string, buffer: Buffer) => Promise<void>;
  readFile: (filePath: string) => Promise<Buffer>;
}

export interface CloneVideoResult {
  readonly fileId: string;
  readonly downloadUrl: string;
  readonly durationSeconds?: number;
}

function realFns(): CloneVideoFns {
  return {
    generateWanAnimateMix,
    downloadToBuffer,
    runFfmpeg,
    writeFile: (filePath, buffer) => fs.writeFile(filePath, buffer),
    readFile: (filePath) => fs.readFile(filePath),
  };
}

/**
 * Replace the main subject in a reference video with the uploaded character.
 * The provider output is stored directly so its original timing and audio are
 * preserved; Wan adds the required AI-generated watermark at generation time.
 */
export async function runCloneVideoCreation(
  input: CloneVideoInput,
  cfg: SimpleVideoConfig,
  opts: CloneVideoOptions,
  services: CloneVideoServices,
): Promise<CloneVideoResult> {
  if (!cfg.dashscopeApiKey) throw new SimpleVideoError('DASHSCOPE_API_KEY not configured', 'config');
  if (!input.imageUrl || !input.referenceVideoUrl) {
    throw new SimpleVideoError('clone video requires a character image and reference video', 'config');
  }
  const fns = { ...realFns(), ...(services.overrides ?? {}) };
  const generated = await fns.generateWanAnimateMix({
    apiKey: cfg.dashscopeApiKey,
    baseUrl: cfg.dashscopeBaseUrl,
    ...(cfg.dashscopeWorkspaceId ? { workspaceId: cfg.dashscopeWorkspaceId } : {}),
    imageUrl: input.imageUrl,
    referenceVideoUrl: input.referenceVideoUrl,
    mode: opts.mode,
  });
  const downloaded = await fns.downloadToBuffer(generated.videoUrl);
  const outputPath = path.join(services.workdir, 'clone-final.mp4');
  await fns.writeFile(outputPath, downloaded.buffer);
  const stored = await services.storeOutput({
    filename: 'video.mp4',
    mimetype: 'video/mp4',
    buffer: downloaded.buffer,
  });

  const ffOpts = cfg.ffmpegBin ? { ffmpegBin: cfg.ffmpegBin } : {};
  await generatePosterFile({
    videoPath: outputPath,
    posterPath: path.join(services.workdir, 'poster.jpg'),
    deps: {
      runFfmpeg: fns.runFfmpeg,
      readFile: fns.readFile,
      storeOutput: services.storeOutput,
      logger: services.logger,
    },
    ffOpts,
  });
  services.logger.info(
    { fileId: stored.fileId, providerTaskId: generated.taskId, mode: opts.mode },
    'video: clone complete',
  );
  return {
    fileId: stored.fileId,
    downloadUrl: `/api/files/${stored.fileId}/download`,
    ...(generated.durationSeconds !== undefined ? { durationSeconds: generated.durationSeconds } : {}),
  };
}
