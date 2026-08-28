import { z } from 'zod';
import type { VideoEditDocument, VideoEditOperation, VideoEditSourceKind } from './types.js';

export type VideoEditPlanValidationReason =
  | 'invalid_shape'
  | 'unknown_scene'
  | 'invalid_trim'
  | 'invalid_reorder'
  | 'regeneration_unavailable'
  | 'locked_subject_required';

export class VideoEditPlanValidationError extends Error {
  constructor(
    public readonly reason: VideoEditPlanValidationReason,
    message: string,
  ) {
    super(message);
    this.name = 'VideoEditPlanValidationError';
  }
}

export interface VideoEditPlan {
  summary: string;
  affectedSceneIds: string[];
  operations: VideoEditOperation[];
  requiresQuote: boolean;
}

const trimOperationSchema = z
  .object({
    kind: z.literal('trim'),
    sceneId: z.string().trim().min(1).max(80),
    startMs: z.number().int().min(0),
    endMs: z.number().int().positive(),
  })
  .strict();

const reorderOperationSchema = z
  .object({
    kind: z.literal('reorder'),
    sceneIds: z.array(z.string().trim().min(1).max(80)).min(1).max(24),
  })
  .strict();

const captionOperationSchema = z
  .object({
    kind: z.literal('caption'),
    sceneId: z.string().trim().min(1).max(80),
    text: z.string().max(500),
  })
  .strict();

const aspectRatioOperationSchema = z
  .object({
    kind: z.literal('aspect_ratio'),
    value: z.enum(['16:9', '9:16', '1:1']),
  })
  .strict();

const removeSilenceOperationSchema = z
  .object({
    kind: z.literal('remove_silence'),
    sceneId: z.string().trim().min(1).max(80),
    ranges: z
      .array(
        z
          .object({
            startMs: z.number().int().min(0),
            endMs: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict();

const regenerateSceneOperationSchema = z
  .object({
    kind: z.literal('regenerate_scene'),
    sceneId: z.string().trim().min(1).max(80),
    prompt: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const videoEditOperationSchema = z.discriminatedUnion('kind', [
  trimOperationSchema,
  reorderOperationSchema,
  captionOperationSchema,
  aspectRatioOperationSchema,
  removeSilenceOperationSchema,
  regenerateSceneOperationSchema,
]);

const rawPlanSchema = z
  .object({
    summary: z.string().trim().min(1).max(300),
    operations: z.array(videoEditOperationSchema).max(20),
  })
  .strict();

function sceneFor(document: VideoEditDocument, sceneId: string) {
  return document.scenes.find((scene) => scene.id === sceneId) ?? null;
}

function assertKnownScene(document: VideoEditDocument, sceneId: string): void {
  if (!sceneFor(document, sceneId)) {
    throw new VideoEditPlanValidationError('unknown_scene', '剪辑计划引用了不存在的场景');
  }
}

function assertRangeWithinScene(
  document: VideoEditDocument,
  sceneId: string,
  startMs: number,
  endMs: number,
): void {
  const scene = sceneFor(document, sceneId);
  if (!scene) {
    throw new VideoEditPlanValidationError('unknown_scene', '剪辑计划引用了不存在的场景');
  }
  const durationMs = scene.sourceEndMs - scene.sourceStartMs;
  if (endMs <= startMs || endMs > durationMs) {
    throw new VideoEditPlanValidationError('invalid_trim', '裁剪范围超出当前场景');
  }
}

function validateOperation(
  operation: VideoEditOperation,
  document: VideoEditDocument,
  sourceKind: VideoEditSourceKind,
): void {
  if (operation.kind === 'aspect_ratio') return;
  if (operation.kind === 'reorder') {
    const expected = document.scenes.map((scene) => scene.id);
    if (
      operation.sceneIds.length !== expected.length ||
      new Set(operation.sceneIds).size !== expected.length ||
      expected.some((sceneId) => !operation.sceneIds.includes(sceneId))
    ) {
      throw new VideoEditPlanValidationError(
        'invalid_reorder',
        '排序必须完整包含每个场景且不能重复',
      );
    }
    return;
  }
  assertKnownScene(document, operation.sceneId);
  if (operation.kind === 'trim') {
    assertRangeWithinScene(document, operation.sceneId, operation.startMs, operation.endMs);
    return;
  }
  if (operation.kind === 'remove_silence') {
    const sorted = [...operation.ranges].sort((left, right) => left.startMs - right.startMs);
    for (let index = 0; index < sorted.length; index += 1) {
      const range = sorted[index];
      if (!range) continue;
      assertRangeWithinScene(document, operation.sceneId, range.startMs, range.endMs);
      const previous = sorted[index - 1];
      if (previous && range.startMs < previous.endMs) {
        throw new VideoEditPlanValidationError('invalid_trim', '静音范围不能重叠');
      }
    }
    return;
  }
  if (operation.kind === 'regenerate_scene') {
    const scene = sceneFor(document, operation.sceneId);
    if (sourceKind === 'upload' || !scene?.generationContext) {
      throw new VideoEditPlanValidationError(
        'regeneration_unavailable',
        '当前场景没有可安全复用的生成来源',
      );
    }
    if (sourceKind === 'ip_person' && !scene.generationContext.lockedSubjectFileId) {
      throw new VideoEditPlanValidationError(
        'locked_subject_required',
        'IP 人物场景必须保留锁定主体',
      );
    }
  }
}

function affectedSceneIds(document: VideoEditDocument, operations: VideoEditOperation[]): string[] {
  const affected = new Set<string>();
  for (const operation of operations) {
    if (operation.kind === 'aspect_ratio' || operation.kind === 'reorder') {
      for (const scene of document.scenes) affected.add(scene.id);
    } else {
      affected.add(operation.sceneId);
    }
  }
  return document.scenes.map((scene) => scene.id).filter((sceneId) => affected.has(sceneId));
}

export function validateVideoEditPlan(
  raw: unknown,
  context: { document: VideoEditDocument; sourceKind: VideoEditSourceKind },
): VideoEditPlan {
  const parsed = rawPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new VideoEditPlanValidationError('invalid_shape', '剪辑计划格式不正确');
  }
  for (const operation of parsed.data.operations) {
    validateOperation(operation, context.document, context.sourceKind);
  }
  return {
    summary: parsed.data.summary,
    affectedSceneIds: affectedSceneIds(context.document, parsed.data.operations),
    operations: parsed.data.operations,
    requiresQuote: parsed.data.operations.some(
      (operation) => operation.kind === 'regenerate_scene',
    ),
  };
}
