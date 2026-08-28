import type { DraftAttachment } from '@/components/AttachmentChip';
import type { ImageHistoryRow } from '@/lib/image-history-row';
import type {
  CommercialImageUse,
  ImageChangeTarget,
  ImageCreationGoal,
  ImageModel,
  ImageStyleKey,
} from '@/types/image';
import type { VideoAspect } from '@/types/video';
import { imageGoalPreset } from './image-studio-options';

export type ImageStudioSettingKey = 'model' | 'style' | 'aspectRatio' | 'imageCount';
export type ImageContinuationAction = 'continue_edit' | 'keep_subject' | 'reuse_settings';

export interface ImageStudioDraft {
  goal: ImageCreationGoal;
  commercialUse?: CommercialImageUse;
  prompt: string;
  changeTargets: ImageChangeTarget[];
  model: ImageModel;
  style: ImageStyleKey;
  aspectRatio: VideoAspect;
  imageCount: 1 | 2 | 3 | 4;
  attachments: DraftAttachment[];
  subjectAttachmentClientId: string | null;
  userOverriddenSettings: ReadonlySet<ImageStudioSettingKey>;
}

type ImageStudioSettingValue = Pick<
  ImageStudioDraft,
  'model' | 'style' | 'aspectRatio' | 'imageCount'
>;

export function createImageStudioDraft(
  goal: ImageCreationGoal = 'inspiration',
  commercialUse: CommercialImageUse = 'product',
): ImageStudioDraft {
  const preset = imageGoalPreset(goal, commercialUse);
  return {
    goal,
    ...(goal === 'commercial' ? { commercialUse } : {}),
    prompt: '',
    changeTargets: [],
    ...preset,
    attachments: [],
    subjectAttachmentClientId: null,
    userOverriddenSettings: new Set(),
  };
}

export function setImageStudioSetting<K extends ImageStudioSettingKey>(
  draft: ImageStudioDraft,
  key: K,
  value: ImageStudioSettingValue[K],
): ImageStudioDraft {
  return {
    ...draft,
    [key]: value,
    userOverriddenSettings: new Set([...draft.userOverriddenSettings, key]),
  };
}

function validSubjectClientId(draft: ImageStudioDraft): string | null {
  if (!draft.subjectAttachmentClientId) return null;
  const subject = draft.attachments.find(
    (attachment) =>
      attachment.clientId === draft.subjectAttachmentClientId &&
      attachment.status === 'ready' &&
      Boolean(attachment.fileId) &&
      attachment.mimetype.startsWith('image/'),
  );
  return subject?.clientId ?? null;
}

export function switchImageCreationGoal(
  draft: ImageStudioDraft,
  goal: ImageCreationGoal,
  commercialUse: CommercialImageUse = draft.commercialUse ?? 'product',
): ImageStudioDraft {
  const preset = imageGoalPreset(goal, commercialUse);
  const preservedSettings = Object.fromEntries(
    (['model', 'style', 'aspectRatio', 'imageCount'] as const).map((key) => [
      key,
      draft.userOverriddenSettings.has(key) ? draft[key] : preset[key],
    ]),
  ) as ImageStudioSettingValue;

  return {
    ...draft,
    ...preservedSettings,
    goal,
    ...(goal === 'commercial' ? { commercialUse } : { commercialUse: undefined }),
    subjectAttachmentClientId: validSubjectClientId(draft),
  };
}

export function continuationDraftFromImageTask(
  row: ImageHistoryRow,
  action: ImageContinuationAction,
  selectedFileId?: string,
): ImageStudioDraft {
  const options = row.imageOptions;
  const goal =
    action === 'keep_subject'
      ? 'lock_subject'
      : (options.goal ?? (options.mode === 'lock_subject' ? 'lock_subject' : 'inspiration'));
  const base = createImageStudioDraft(goal, options.commercialUse ?? 'product');
  const subject = options.subjectFileId
    ? continuedAttachment(options.subjectFileId, '主角参考图')
    : null;
  const selected =
    row.downloads.find(({ fileId }) => fileId === selectedFileId) ?? row.downloads[0];
  const result = selected ? continuedAttachment(selected.fileId, selected.filename) : null;
  const attachments =
    action === 'reuse_settings'
      ? []
      : action === 'keep_subject'
        ? subject
          ? [subject]
          : []
        : [result, subject]
            .filter((attachment): attachment is NonNullable<typeof attachment> =>
              Boolean(attachment),
            )
            .filter(
              (attachment, index, list) =>
                list.findIndex(({ fileId }) => fileId === attachment.fileId) === index,
            );

  return {
    ...base,
    goal,
    ...(goal === 'commercial' && options.commercialUse
      ? { commercialUse: options.commercialUse }
      : {}),
    prompt: action === 'continue_edit' ? (options.visiblePrompt ?? '') : '',
    changeTargets: [...(options.changeTargets ?? [])],
    model: options.model,
    style: options.style ?? 'random',
    aspectRatio: options.aspectRatio,
    imageCount: options.imageCount,
    attachments,
    subjectAttachmentClientId:
      action !== 'reuse_settings' && subject ? (subject.clientId ?? null) : null,
    userOverriddenSettings: new Set<ImageStudioSettingKey>([
      'model',
      'style',
      'aspectRatio',
      'imageCount',
    ]),
  };
}

function continuedAttachment(fileId: string, filename: string): DraftAttachment {
  return {
    clientId: `continued_${fileId}`,
    fileId,
    filename,
    mimetype: 'image/*',
    size: 0,
    status: 'ready',
  };
}
