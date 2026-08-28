import type {
  CommercialImageUse,
  ImageChangeTarget,
  ImageCreationGoal,
  ImageCreationOptions,
  ImageStyleKey,
} from '@/types/image';
import type { VideoAspect } from '@/types/video';
import {
  COMMERCIAL_IMAGE_USES,
  IMAGE_ASPECT_OPTIONS,
  IMAGE_CHANGE_TARGETS,
  IMAGE_CREATION_GOALS,
  IMAGE_STYLE_OPTIONS,
} from './image-studio-options';

export interface ImageTaskMeta {
  imageOptions?: ImageCreationOptions;
  subjectConsistency?: { checked: number; passed: number; failed: number };
}

const IMAGE_STYLE_KEYS = new Set(IMAGE_STYLE_OPTIONS.map(({ key }) => key));
const IMAGE_ASPECT_RATIOS = new Set(IMAGE_ASPECT_OPTIONS.map(({ value }) => value));
const IMAGE_GOALS = new Set(IMAGE_CREATION_GOALS);
const COMMERCIAL_USES = new Set(COMMERCIAL_IMAGE_USES);
const CHANGE_TARGETS = new Set(IMAGE_CHANGE_TARGETS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asImageGoal(value: unknown): ImageCreationGoal | null {
  return typeof value === 'string' && IMAGE_GOALS.has(value as ImageCreationGoal)
    ? (value as ImageCreationGoal)
    : null;
}

function asCommercialImageUse(value: unknown): CommercialImageUse | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'string' && COMMERCIAL_USES.has(value as CommercialImageUse)
    ? (value as CommercialImageUse)
    : null;
}

function asImageChangeTargets(value: unknown): ImageChangeTarget[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5) return null;
  if (
    value.some(
      (target) =>
        typeof target !== 'string' || !CHANGE_TARGETS.has(target as ImageChangeTarget),
    )
  ) {
    return null;
  }
  return value as ImageChangeTarget[];
}

function parseVisiblePrompt(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 4_000 ? trimmed : null;
}

function parseImageOptions(value: unknown): ImageCreationOptions | undefined {
  if (!isRecord(value)) return undefined;
  const model = value.model;
  const aspectRatio = value.aspectRatio;
  const imageCount = value.imageCount;
  const rawMode = value.mode;
  const mode =
    rawMode === undefined || rawMode === 'free'
      ? 'free'
      : rawMode === 'lock_subject'
        ? 'lock_subject'
        : null;
  const rawStyle = value.style;
  const style =
    rawStyle === undefined
      ? 'random'
      : typeof rawStyle === 'string' && IMAGE_STYLE_KEYS.has(rawStyle as ImageStyleKey)
        ? (rawStyle as ImageStyleKey)
        : null;
  const goal =
    value.goal === undefined
      ? mode === 'lock_subject'
        ? 'lock_subject'
        : 'inspiration'
      : asImageGoal(value.goal);
  const commercialUse = asCommercialImageUse(value.commercialUse);
  const changeTargets = asImageChangeTargets(value.changeTargets);
  const visiblePrompt = parseVisiblePrompt(value.visiblePrompt);
  if (
    (model !== 'nano_banana_2' && model !== 'nano_banana_pro') ||
    mode === null ||
    style === null ||
    goal === null ||
    commercialUse === null ||
    changeTargets === null ||
    visiblePrompt === null ||
    !IMAGE_ASPECT_RATIOS.has(aspectRatio as VideoAspect) ||
    !Number.isInteger(imageCount) ||
    Number(imageCount) < 1 ||
    Number(imageCount) > 4
  ) {
    return undefined;
  }

  return {
    model,
    style,
    aspectRatio: aspectRatio as VideoAspect,
    imageCount: imageCount as 1 | 2 | 3 | 4,
    ...(mode === 'lock_subject' ? { mode } : {}),
    ...(typeof value.subjectFileId === 'string' &&
    value.subjectFileId.length >= 1 &&
    value.subjectFileId.length <= 64
      ? { subjectFileId: value.subjectFileId }
      : {}),
    goal,
    ...(commercialUse ? { commercialUse } : {}),
    changeTargets,
    ...(visiblePrompt ? { visiblePrompt } : {}),
  };
}

function parseSubjectConsistency(
  value: unknown,
): ImageTaskMeta['subjectConsistency'] | undefined {
  if (!isRecord(value)) return undefined;
  const checked = value.checked;
  const passed = value.passed;
  const failed = value.failed;
  const counts = [checked, passed, failed];
  if (
    !counts.every(
      (count) => Number.isInteger(count) && Number(count) >= 0 && Number(count) <= 8,
    ) ||
    Number(passed) + Number(failed) !== Number(checked)
  ) {
    return undefined;
  }
  return {
    checked: Number(checked),
    passed: Number(passed),
    failed: Number(failed),
  };
}

export function parseImageTaskMeta(value: unknown): ImageTaskMeta {
  if (!isRecord(value)) return {};
  const imageOptions = parseImageOptions(value.imageOptions);
  const subjectConsistency = parseSubjectConsistency(value.subjectConsistency);
  return {
    ...(imageOptions ? { imageOptions } : {}),
    ...(subjectConsistency ? { subjectConsistency } : {}),
  };
}
