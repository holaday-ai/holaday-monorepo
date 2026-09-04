import type { RunImageTaskOpts, RunImageTaskResult } from './image-runner.js';

export type { ImageAttachment, RunImageTaskResult } from './image-runner.js';

/**
 * Production-safe boundary for the not-yet-migrated image lane.
 *
 * The legacy Gemini runner remains available to isolated tests and future
 * migration work, but the production task graph only imports this module.
 */
export async function runImageTask(_opts: RunImageTaskOpts): Promise<RunImageTaskResult> {
  return {
    status: 'failed',
    summary: '',
    reason: '图片能力正在迁移到千问，暂时不可用。',
    attachments: [],
  };
}
