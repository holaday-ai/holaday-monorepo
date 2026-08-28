import type { DraftAttachment } from '@/components/AttachmentChip';
import type {
  CommercialImageUse,
  ImageChangeTarget,
  ImageCreationGoal,
  ImageCreationOptions,
  ImageModel,
  ImageStyleKey,
} from '@/types/image';
import type { VideoAspect } from '@/types/video';
import type { ImageStudioDraft } from './image-studio-state';

export interface ImageModelOption {
  value: ImageModel;
  name: string;
  version: string;
  description: string;
  badges: readonly string[];
}

export interface ImageStyleOption {
  key: ImageStyleKey;
  label: string;
  description: string;
  prompt?: string;
}

export interface ImageGoalPreset {
  model: ImageModel;
  style: ImageStyleKey;
  aspectRatio: VideoAspect;
  imageCount: 1 | 2 | 3 | 4;
}

export const IMAGE_MODEL_OPTIONS: readonly ImageModelOption[] = [
  {
    value: 'nano_banana_2',
    name: 'Nano Banana',
    version: '2',
    description: '适合日常文生图、图生图和主体一致性生成，优先快速稳定出图。',
    badges: ['默认', '快速', '图生图'],
  },
  {
    value: 'nano_banana_pro',
    name: 'Nano Banana',
    version: 'Pro',
    description: '适合海报、带字图、营销图、复杂构图和更高保真的成片。',
    badges: ['高质量', '带字图', '营销图'],
  },
];

export const IMAGE_STYLE_OPTIONS: readonly ImageStyleOption[] = [
  { key: 'random', label: '智能匹配', description: '让模型按内容自动选择' },
  { key: 'cinematic', label: '电影感', description: '电影感光影与镜头语言', prompt: '电影感构图，真实镜头语言，细腻光影，高级色彩分级' },
  { key: 'creative', label: '创意视觉', description: '更有创意的视觉表达', prompt: '创意视觉表达，构图大胆，形式感强，但主体清晰可读' },
  { key: 'dynamic', label: '动感', description: '动势强、画面有张力', prompt: '动态构图，强动势，画面有速度感和张力' },
  { key: 'fashion', label: '时尚大片', description: '时尚大片与 editorial 质感', prompt: '时尚大片质感，editorial 摄影风格，精致造型与高级布光' },
  { key: 'portrait', label: '人物肖像', description: '人物肖像与面部表现优先', prompt: '高质量肖像摄影，面部清晰，表情自然，肤色准确，背景干净' },
  { key: 'stock_photo', label: '商业图库', description: '商业图库质感，干净可用', prompt: '商业图库照片质感，真实自然，构图干净，可直接用于内容配图' },
  { key: 'vibrant', label: '鲜艳活力', description: '鲜艳明快，高饱和', prompt: '鲜艳明快，高饱和色彩，画面有活力，视觉冲击强' },
  { key: 'anime', label: '二次元', description: '二次元动画质感', prompt: '原创二次元动画风格，线条清晰，色彩干净，画面有故事感' },
  { key: 'illustration', label: '现代插画', description: '扁平插画与叙事图', prompt: '现代扁平插画风格，造型友好，色块清晰，适合说明类画面' },
  { key: 'logo', label: '标志设计', description: '标志与图形识别', prompt: '简洁标志设计风格，几何图形明确，不加入真实品牌或可识别商标' },
  { key: 'watercolor', label: '水彩', description: '水彩纸感与柔和色', prompt: '水彩插画风格，纸张纹理，柔和晕染，层次自然' },
  { key: 'line_art', label: '线稿', description: '黑白线稿细节', prompt: '黑白线稿风格，细节丰富，线条干净，适合填色和结构表达' },
  { key: 'fantasy', label: '奇幻', description: '奇幻史诗感', prompt: '原创奇幻史诗风格，戏剧化光影，宏大氛围，不引用现有 IP' },
  { key: 'product', label: '商品棚拍', description: '商品棚拍质感', prompt: '高端商品棚拍风格，干净背景，精致布光，主体轮廓清楚' },
  { key: 'three_d_render', label: '3D 渲染', description: '3D 渲染与图标质感', prompt: '高质量 3D 渲染风格，光滑材质，柔和反射，现代图标质感' },
];

export const IMAGE_ASPECT_OPTIONS: ReadonlyArray<{ value: VideoAspect; label: string }> = [
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
];

export const IMAGE_CREATION_GOALS: readonly ImageCreationGoal[] = [
  'inspiration',
  'lock_subject',
  'commercial',
];

export const COMMERCIAL_IMAGE_USES: readonly CommercialImageUse[] = [
  'product',
  'poster',
  'social_cover',
];

export const IMAGE_CHANGE_TARGETS: readonly ImageChangeTarget[] = [
  'background',
  'style',
  'lighting',
  'action',
  'composition',
];

export const IMAGE_GOAL_PRESETS: Readonly<{
  inspiration: ImageGoalPreset;
  lock_subject: ImageGoalPreset;
  commercial: Readonly<Record<CommercialImageUse, ImageGoalPreset>>;
}> = {
  inspiration: {
    model: 'nano_banana_2',
    style: 'random',
    aspectRatio: '1:1',
    imageCount: 1,
  },
  lock_subject: {
    model: 'nano_banana_2',
    style: 'random',
    aspectRatio: '1:1',
    imageCount: 2,
  },
  commercial: {
    product: {
      model: 'nano_banana_2',
      style: 'product',
      aspectRatio: '4:3',
      imageCount: 2,
    },
    poster: {
      model: 'nano_banana_pro',
      style: 'random',
      aspectRatio: '3:4',
      imageCount: 1,
    },
    social_cover: {
      model: 'nano_banana_2',
      style: 'vibrant',
      aspectRatio: '1:1',
      imageCount: 2,
    },
  },
};

export function imageGoalPreset(
  goal: ImageCreationGoal,
  commercialUse: CommercialImageUse = 'product',
): ImageGoalPreset {
  return goal === 'commercial' ? IMAGE_GOAL_PRESETS.commercial[commercialUse] : IMAGE_GOAL_PRESETS[goal];
}

export function buildImageCreationOptions(
  draft: ImageStudioDraft,
  subjectFileId?: string,
): ImageCreationOptions {
  return {
    model: draft.model,
    style: draft.style,
    aspectRatio: draft.aspectRatio,
    imageCount: draft.imageCount,
    ...(draft.goal === 'lock_subject' ? { mode: 'lock_subject' as const } : {}),
    ...(draft.goal === 'lock_subject' && subjectFileId ? { subjectFileId } : {}),
    goal: draft.goal,
    ...(draft.commercialUse ? { commercialUse: draft.commercialUse } : {}),
    changeTargets: [...draft.changeTargets],
    visiblePrompt: draft.prompt.trim(),
  };
}

type ImageFileOrderAttachment = Pick<
  DraftAttachment,
  'clientId' | 'fileId' | 'mimetype' | 'status'
>;

export function buildImageFileOrder(
  attachments: readonly ImageFileOrderAttachment[],
  mode: 'free' | 'lock_subject',
  subjectClientId?: string | null,
): string[] {
  const ready = attachments.filter(
    (attachment) => attachment.status === 'ready' && Boolean(attachment.fileId),
  );
  if (mode !== 'lock_subject') return ready.map((attachment) => attachment.fileId);
  const subject =
    ready.find(
      (attachment) =>
        attachment.clientId === subjectClientId && attachment.mimetype.startsWith('image/'),
    ) ?? ready.find((attachment) => attachment.mimetype.startsWith('image/'));
  if (!subject) return ready.map((attachment) => attachment.fileId);
  return [
    subject.fileId,
    ...ready
      .filter((attachment) => attachment.fileId !== subject.fileId)
      .map((attachment) => attachment.fileId),
  ];
}

function buildImageIntentWithStyle(intent: string, imageStyle: ImageStyleKey): string {
  const option = IMAGE_STYLE_OPTIONS.find(({ key }) => key === imageStyle);
  if (!option?.prompt) return intent;
  return `${intent}\n\n图片风格要求：${option.prompt}。`;
}

export function buildImageIntentForSubmit(draft: ImageStudioDraft): string {
  const styled = buildImageIntentWithStyle(draft.prompt.trim(), draft.style);
  if (draft.goal !== 'lock_subject') return styled;
  return [
    styled,
    [
      '主体一致性要求：请以用户上传的第一张图片作为锁定主角。',
      '尽量保持主角身份、脸型五官、毛色/花纹、商品结构、Logo/包装关键特征或 IP 核心造型不变。',
      '只根据用户描述改变背景、风格、光线、场景、动作、姿态、构图和系列化画面。',
      '如果上传图与描述冲突，优先保留上传图中的主角身份，并在可行范围内执行描述变化。',
    ].join('\n'),
  ].join('\n\n');
}
