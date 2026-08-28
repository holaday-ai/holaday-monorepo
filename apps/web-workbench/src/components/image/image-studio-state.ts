import type { DraftAttachment } from '@/components/AttachmentChip';
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
