import {
  reconcileNormalVideoParameters,
  type NormalVideoModelId,
} from '@holaday/shared-types';
import {
  AlertCircle,
  ArrowUp,
  ChevronDown,
  Check,
  CheckCircle2,
  CircleSlash,
  Clapperboard,
  Clock,
  Film,
  ImagePlus,
  Lightbulb,
  Loader2,
  Lock,
  Mic,
  Palette,
  Pin,
  Sparkles,
  Trash2,
  UserRound,
  Video as VideoIcon,
  X,
  XCircle,
} from 'lucide-react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AttachmentChip, type DraftAttachment } from '@/components/AttachmentChip';
import { FileDownloadCard } from '@/components/FileDownloadCard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { uploadFailureMessage, uploadFile, uploadMediaFile } from '@/lib/upload-file';
import { cn } from '@/lib/utils';
import {
  currentMediaTaskText,
  isVideoTaskRunning,
  selectStepsFor,
  shouldRefreshForTask,
  videoTaskStatusIconKind,
  videoTaskStatusLabel,
} from '@/lib/video-task-selectors';
import {
  creativeHistoryDisplayTitle,
  creativeHistoryLoadReducer,
  filterCreativeHistoryRows,
  isLockedSubjectImageIntent,
  showImageOption,
  toImageRow,
  toVideoRow,
  type CreativeHistoryFilter,
  type VideoRow,
  type VideoType,
} from '@/lib/video-history-row';
import { ipRenderingHint } from '@/lib/video-ip-estimate';
import { LazyPosterImg } from '@/components/LazyPosterImg';
import { PageContainer, Section } from '@/pages/PageShell';
import { useTaskStore } from '@/stores/task-store';
import type { ImageCreationOptions, ImageModel } from '@/types/image';
import type { UiTask } from '@/types/task';
import {
  cloneModeFromVideoModel,
  estimateCloneCny,
  estimateIpVideo,
  estimatePerSegmentCny,
  normalVideoModelFromSelection,
  type NormalVideoModel,
  type VideoAspect,
  type VideoCreationOptions,
  type VideoDuration,
  type VideoModel,
  type VideoResolution,
  type VideoStyleOption,
} from '@/types/video';

/**
 * 视频任务 — Phase 2 第一期独立视频界面(骨架 + 普通可用)。
 *
 * 三类型 tab:普通视频 / 复刻视频 / IP人物视频。
 * 普通走既有两段式:提交 = tasks.create
 * (videoOptions 透传)→ awaiting_user video_quote 报价卡 → confirmVideo
 * 确认后才烧。本页只采集参数 + 实时估价 + 列历史,不直接计费。
 */

type CreativeMode = 'video' | 'image';
type VideoTab = 'normal' | 'pet' | 'ip';
type ImageGenerationMode = 'free' | 'lock_subject';
type CreativeModelValue = VideoModel | ImageModel;
type ImageStyleKey =
  | 'random'
  | 'cinematic'
  | 'creative'
  | 'dynamic'
  | 'fashion'
  | 'portrait'
  | 'stock_photo'
  | 'vibrant'
  | 'anime'
  | 'illustration'
  | 'logo'
  | 'watercolor'
  | 'line_art'
  | 'fantasy'
  | 'product'
  | 'three_d_render';
type CreativeStyleGroup = 'vibe' | 'lighting' | 'color';
type CreativeStylePreviewSubject = 'default' | 'human';
type CreativeStyleKey =
  | 'random'
  | 'clay'
  | 'color_sketch'
  | 'logo'
  | 'papercraft'
  | 'pro_photo'
  | 'sci_fi'
  | 'sketch'
  | 'stock_footage'
  | 'backlight'
  | 'candle_lit'
  | 'chiaroscuro'
  | 'film_haze'
  | 'foggy'
  | 'golden_hour'
  | 'hardlight'
  | 'lens_flare'
  | 'light_art'
  | 'low_key'
  | 'luminous'
  | 'mystical'
  | 'rainy'
  | 'soft_light'
  | 'volumetric'
  | 'autumn'
  | 'complementary'
  | 'cool'
  | 'dark'
  | 'earthy'
  | 'electric'
  | 'iridescent'
  | 'pastel'
  | 'split'
  | 'terracotta_teal'
  | 'ultraviolet'
  | 'vibrant'
  | 'warm';

const CREATIVE_ACCEPT_IMAGES = '.png,.jpg,.jpeg,.webp,.gif,image/*';
const CREATIVE_ACCEPT_REFERENCE_VIDEO = '.mp4,.mov,video/mp4,video/quicktime';
const CREATIVE_MAX_ATTACHMENTS = 5;
export const DEFAULT_IMAGE_COUNT: 1 | 2 | 3 | 4 = 1;

export function normalVideoParametersAfterTabReturn(
  model: VideoModel,
  resolution: VideoResolution,
  durationSeconds: VideoDuration,
): {
  model: NormalVideoModel;
  resolution: VideoResolution;
  durationSeconds: VideoDuration;
} {
  const next = reconcileNormalVideoParameters(
    {
      model: normalVideoModelFromSelection(model) as NormalVideoModelId,
      resolution,
      durationSeconds,
    },
    'resolution',
  );
  return {
    model: next.model as NormalVideoModel,
    resolution: next.resolution,
    durationSeconds: next.durationSeconds as VideoDuration,
  };
}

export function buildImageCreationOptions(
  model: ImageModel,
  aspectRatio: VideoAspect,
  imageCount: 1 | 2 | 3 | 4 = DEFAULT_IMAGE_COUNT,
): ImageCreationOptions {
  return { model, aspectRatio, imageCount };
}

const CREATIVE_SECTION_CLASS = 'rounded-[22px] border-[#EFEFEF] bg-white shadow-[0_14px_34px_rgba(17,24,39,0.04)]';
const CREATIVE_PRICE_SECTION_CLASS = 'rounded-[22px] border-[#EFEFEF] bg-white shadow-[0_14px_34px_rgba(17,24,39,0.04)]';
const CREATIVE_ASPECT_OPTIONS: ReadonlyArray<{ value: VideoAspect; label: string }> = [
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
];

const VIDEO_TABS: ReadonlyArray<{
  id: VideoTab;
  label: string;
  icon: typeof Film;
}> = [
  { id: 'normal', label: '普通视频', icon: Film },
  { id: 'pet', label: '复刻视频', icon: VideoIcon },
  { id: 'ip', label: 'IP人物视频', icon: UserRound },
];

interface CreativeModelOption {
  value: CreativeModelValue;
  name: string;
  version: string;
  description: string;
  badges: readonly string[];
  tone: string;
}

const IMAGE_MODEL_OPTIONS: ReadonlyArray<CreativeModelOption> = [
  {
    value: 'nano_banana_2',
    name: 'Nano Banana',
    version: '2',
    description: '默认图片模型，适合日常文生图、图生图和主体一致性生成，优先快速稳定出图。',
    badges: ['默认', '快速', '图生图'],
    tone: 'from-[#FFE24A] via-[#FFB23F] to-[#42C0EF]',
  },
  {
    value: 'nano_banana_pro',
    name: 'Nano Banana',
    version: 'Pro',
    description: '高质量图片模型，适合海报、带字图、营销图、复杂构图和更高保真的成片。',
    badges: ['高质量', '带字图', '营销图'],
    tone: 'from-[#111827] via-[#6154F4] to-[#42C0EF]',
  },
];

const IMAGE_STYLE_OPTIONS: ReadonlyArray<{
  key: ImageStyleKey;
  label: string;
  description: string;
  prompt?: string;
}> = [
  { key: 'random', label: 'Random', description: '让模型按内容自动选择' },
  { key: 'cinematic', label: 'Cinematic', description: '电影感光影与镜头语言', prompt: '电影感构图，真实镜头语言，细腻光影，高级色彩分级' },
  { key: 'creative', label: 'Creative', description: '更有创意的视觉表达', prompt: '创意视觉表达，构图大胆，形式感强，但主体清晰可读' },
  { key: 'dynamic', label: 'Dynamic', description: '动势强、画面有张力', prompt: '动态构图，强动势，画面有速度感和张力' },
  { key: 'fashion', label: 'Fashion', description: '时尚大片与 editorial 质感', prompt: '时尚大片质感，editorial 摄影风格，精致造型与高级布光' },
  { key: 'portrait', label: 'Portrait', description: '人物肖像与面部表现优先', prompt: '高质量肖像摄影，面部清晰，表情自然，肤色准确，背景干净' },
  { key: 'stock_photo', label: 'Stock Photo', description: '商业图库质感，干净可用', prompt: '商业图库照片质感，真实自然，构图干净，可直接用于内容配图' },
  { key: 'vibrant', label: 'Vibrant', description: '鲜艳明快，高饱和', prompt: '鲜艳明快，高饱和色彩，画面有活力，视觉冲击强' },
  { key: 'anime', label: 'Anime', description: '二次元动画质感', prompt: '原创二次元动画风格，线条清晰，色彩干净，画面有故事感' },
  { key: 'illustration', label: 'Illustration', description: '扁平插画与叙事图', prompt: '现代扁平插画风格，造型友好，色块清晰，适合说明类画面' },
  { key: 'logo', label: 'Logo', description: '标志与图形识别', prompt: '简洁标志设计风格，几何图形明确，不加入真实品牌或可识别商标' },
  { key: 'watercolor', label: 'Watercolor', description: '水彩纸感与柔和色', prompt: '水彩插画风格，纸张纹理，柔和晕染，层次自然' },
  { key: 'line_art', label: 'Line Art', description: '黑白线稿细节', prompt: '黑白线稿风格，细节丰富，线条干净，适合填色和结构表达' },
  { key: 'fantasy', label: 'Fantasy', description: '奇幻史诗感', prompt: '原创奇幻史诗风格，戏剧化光影，宏大氛围，不引用现有 IP' },
  { key: 'product', label: 'Product', description: '商品棚拍质感', prompt: '高端商品棚拍风格，干净背景，精致布光，主体轮廓清楚' },
  { key: 'three_d_render', label: '3D Render', description: '3D 渲染与图标质感', prompt: '高质量 3D 渲染风格，光滑材质，柔和反射，现代图标质感' },
];

const CREATIVE_MODEL_OPTIONS: ReadonlyArray<CreativeModelOption> = [
  {
    value: 'veo_fast',
    name: 'Veo',
    version: '3 Fast',
    description: '快速生成，适合日常短视频草稿与轻量创意验证。',
    badges: ['文本成片', '图像参考', '性价比'],
    tone: 'from-[#1E9BFF] via-[#735CFF] to-[#EA1F59]',
  },
  {
    value: 'veo_standard',
    name: 'Veo',
    version: '3 Quality',
    description: '画面稳定度和细节更高，适合正式成片前的高质量版本。',
    badges: ['文本成片', '高质量', '1080p'],
    tone: 'from-[#8A63FF] via-[#EA1F59] to-[#FFB23F]',
  },
  {
    value: 'happyhorse',
    name: 'Happy Horse',
    version: '1.1',
    description: '带音效倾向的短片模型，适合更有动感的创意片段。',
    badges: ['文本成片', '音效倾向'],
    tone: 'from-[#FFB23F] via-[#E54D2E] to-[#2E1914]',
  },
];

const CLONE_MODEL_OPTIONS: ReadonlyArray<CreativeModelOption> = [
  {
    value: 'wan_animate_std',
    name: 'Wan Animate',
    version: '2.2 Standard',
    description: '使用主角照片替换参考视频主体，保留原视频动作、镜头节奏与音频。',
    badges: ['主角替换', '参考视频', '标准模式'],
    tone: 'from-[#2F6BFF] via-[#5C42E8] to-[#21C8B6]',
  },
  {
    value: 'wan_animate_pro',
    name: 'Wan Animate',
    version: '2.2 Pro',
    description: '同一主角替换能力的高质量档，适合对人物边缘和动作一致性要求更高的成片。',
    badges: ['主角替换', '参考视频', '高质量'],
    tone: 'from-[#0B1838] via-[#3268D8] to-[#7CE7D8]',
  },
];

const STYLE_GROUPS: Record<CreativeStyleGroup, { title: string; subtitle: string; icon: typeof Sparkles }> = {
  vibe: { title: '氛围', subtitle: '风格基调', icon: Sparkles },
  lighting: { title: '光感', subtitle: '光线效果', icon: Lightbulb },
  color: { title: '色彩', subtitle: '配色倾向', icon: Palette },
};

const STYLE_OPTIONS_BY_GROUP: Record<
  CreativeStyleGroup,
  ReadonlyArray<{ key: CreativeStyleKey; label: string; description: string; prompt?: string; swatch: string }>
> = {
  vibe: [
    { key: 'random', label: '随机', description: '让模型按内容自动选择', swatch: 'from-[#FCE7F3] via-[#E0F2FE] to-[#FEF3C7]' },
    { key: 'clay', label: '黏土', description: '柔软手作质感', prompt: '黏土动画质感，柔软圆润，手作感', swatch: 'from-[#D9B99B] via-[#F2D8BF] to-[#8DAA91]' },
    { key: 'color_sketch', label: '彩色手绘', description: '轻快插画线稿', prompt: '彩色手绘草图风格，线条轻盈，保留动感', swatch: 'from-[#FDE68A] via-[#F9A8D4] to-[#93C5FD]' },
    { key: 'logo', label: '标志化', description: '图形符号更强', prompt: '简洁标志化构图，图形感强，主体明确', swatch: 'from-[#111827] via-[#FFFFFF] to-[#EA1F59]' },
    { key: 'papercraft', label: '纸艺', description: '纸张层次与剪贴', prompt: '纸艺剪贴质感，多层纸张，柔和阴影', swatch: 'from-[#F7E8D0] via-[#FFFFFF] to-[#FCA5A5]' },
    { key: 'pro_photo', label: '专业摄影', description: '商业摄影质感', prompt: '专业摄影质感，真实镜头语言，清晰主体', swatch: 'from-[#111827] via-[#6B7280] to-[#F8FAFC]' },
    { key: 'sci_fi', label: '科幻', description: '未来感科技视觉', prompt: '科幻未来感，发光细节，科技场景', swatch: 'from-[#0F172A] via-[#1D4ED8] to-[#22D3EE]' },
    { key: 'sketch', label: '素描', description: '黑白线稿质感', prompt: '素描线稿风格，黑白铅笔质感', swatch: 'from-[#111827] via-[#9CA3AF] to-[#F9FAFB]' },
    { key: 'stock_footage', label: '素材片', description: '自然素材库镜头', prompt: '高质量素材片镜头，自然真实，少夸张特效', swatch: 'from-[#14532D] via-[#86EFAC] to-[#EFF6FF]' },
  ],
  lighting: [
    { key: 'random', label: '随机', description: '自动匹配光线', swatch: 'from-[#FEF3C7] via-[#E0F2FE] to-[#FCE7F3]' },
    { key: 'backlight', label: '逆光', description: '轮廓光突出', prompt: '逆光轮廓，主体边缘有柔和高光', swatch: 'from-[#020617] via-[#64748B] to-[#FFFFFF]' },
    { key: 'candle_lit', label: '烛光', description: '暖调低照度', prompt: '烛光暖调，低照度，温柔阴影', swatch: 'from-[#1C1917] via-[#B45309] to-[#FED7AA]' },
    { key: 'chiaroscuro', label: '明暗对照', description: '强烈戏剧阴影', prompt: '明暗对照强烈，戏剧化阴影', swatch: 'from-[#000000] via-[#44403C] to-[#F5F5F4]' },
    { key: 'film_haze', label: '胶片雾感', description: '轻柔散射', prompt: '胶片雾感，柔和散射光，低对比', swatch: 'from-[#94A3B8] via-[#E2E8F0] to-[#FDE68A]' },
    { key: 'foggy', label: '薄雾', description: '空气感更强', prompt: '薄雾环境，空气透视明显，氛围朦胧', swatch: 'from-[#CBD5E1] via-[#F8FAFC] to-[#BAE6FD]' },
    { key: 'golden_hour', label: '黄金时刻', description: '日落暖光', prompt: '黄金时刻日落暖光，皮肤和环境偏暖', swatch: 'from-[#7C2D12] via-[#F97316] to-[#FEF3C7]' },
    { key: 'hardlight', label: '硬光', description: '边界清晰的阴影', prompt: '硬光照明，阴影边界清晰，反差强', swatch: 'from-[#111827] via-[#F59E0B] to-[#FFFFFF]' },
    { key: 'lens_flare', label: '镜头光斑', description: '有镜头眩光', prompt: '自然镜头光斑，适度眩光，电影感', swatch: 'from-[#7DD3FC] via-[#F9A8D4] to-[#FDE68A]' },
    { key: 'light_art', label: '光绘', description: '彩色光轨', prompt: '光绘效果，彩色光轨，动势明显', swatch: 'from-[#0F172A] via-[#A855F7] to-[#22D3EE]' },
    { key: 'low_key', label: '低调光', description: '暗背景高质感', prompt: '低调光，暗背景，主体局部被打亮', swatch: 'from-[#020617] via-[#111827] to-[#64748B]' },
    { key: 'luminous', label: '明亮发光', description: '高亮通透', prompt: '明亮通透，主体有柔和发光感', swatch: 'from-[#ECFEFF] via-[#FFFFFF] to-[#FBCFE8]' },
    { key: 'mystical', label: '神秘', description: '梦幻微光', prompt: '神秘梦幻微光，细腻粒子和柔和暗部', swatch: 'from-[#1E1B4B] via-[#6D28D9] to-[#C4B5FD]' },
    { key: 'rainy', label: '雨天', description: '潮湿反光', prompt: '雨天湿润反光，柔和阴天光线', swatch: 'from-[#0F172A] via-[#64748B] to-[#BAE6FD]' },
    { key: 'soft_light', label: '柔光', description: '干净自然', prompt: '柔和漫射光，皮肤和物体边缘自然', swatch: 'from-[#FDF2F8] via-[#FFFFFF] to-[#DBEAFE]' },
    { key: 'volumetric', label: '体积光', description: '空间光束', prompt: '体积光束穿过空间，层次清楚', swatch: 'from-[#0F172A] via-[#D97706] to-[#FDE68A]' },
  ],
  color: [
    { key: 'random', label: '随机', description: '自动匹配色彩', swatch: 'from-[#FCE7F3] via-[#DDD6FE] to-[#CCFBF1]' },
    { key: 'autumn', label: '秋日', description: '橙棕暖调', prompt: '秋日橙棕暖调，柔和复古', swatch: 'from-[#7C2D12] via-[#D97706] to-[#FDE68A]' },
    { key: 'complementary', label: '互补色', description: '色彩对比明确', prompt: '互补色搭配，主次分明，视觉对比强', swatch: 'from-[#2563EB] via-[#FFFFFF] to-[#F97316]' },
    { key: 'cool', label: '冷调', description: '蓝青冷色', prompt: '冷调蓝青色彩，清爽克制', swatch: 'from-[#0F172A] via-[#0EA5E9] to-[#CCFBF1]' },
    { key: 'dark', label: '暗色', description: '深色高级感', prompt: '暗色调，高级感，低饱和', swatch: 'from-[#020617] via-[#1F2937] to-[#4B5563]' },
    { key: 'earthy', label: '大地色', description: '自然低饱和', prompt: '大地色系，低饱和，自然温和', swatch: 'from-[#3F2A1D] via-[#A16207] to-[#D6D3D1]' },
    { key: 'electric', label: '电光', description: '高饱和霓虹', prompt: '电光霓虹色，高饱和，强视觉冲击', swatch: 'from-[#0F172A] via-[#D946EF] to-[#22D3EE]' },
    { key: 'iridescent', label: '虹彩', description: '流动渐变', prompt: '虹彩渐变，色彩流动，梦幻光泽', swatch: 'from-[#F0ABFC] via-[#67E8F9] to-[#FDE68A]' },
    { key: 'pastel', label: '粉彩', description: '柔和浅色', prompt: '粉彩色调，浅色柔和，轻盈干净', swatch: 'from-[#FBCFE8] via-[#BFDBFE] to-[#FEF3C7]' },
    { key: 'split', label: '分离色调', description: '阴影高光分色', prompt: '分离色调，阴影和高光有明确色彩分层', swatch: 'from-[#0F172A] via-[#7C3AED] to-[#F59E0B]' },
    { key: 'terracotta_teal', label: '陶土青绿', description: '暖冷平衡', prompt: '陶土橙与青绿色搭配，温暖又清爽', swatch: 'from-[#C2410C] via-[#FDE68A] to-[#0F766E]' },
    { key: 'ultraviolet', label: '紫外线', description: '紫蓝未来感', prompt: '紫外线紫蓝色调，未来感，高对比', swatch: 'from-[#2E1065] via-[#7E22CE] to-[#60A5FA]' },
    { key: 'vibrant', label: '鲜艳', description: '明快高饱和', prompt: '鲜艳明快，高饱和，画面有活力', swatch: 'from-[#EA1F59] via-[#F97316] to-[#22C55E]' },
    { key: 'warm', label: '暖调', description: '舒适柔暖', prompt: '暖色调，舒适亲和，柔和光泽', swatch: 'from-[#B45309] via-[#FDBA74] to-[#FFF7ED]' },
  ],
};

interface VideoPageProps {
  mode?: CreativeMode;
}

export function VideoPage({ mode = 'video' }: VideoPageProps): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tasks = useTaskStore((s) => s.tasks);
  const refreshTasks = useTaskStore((s) => s.refreshTasks);
  const [videoTab, setVideoTab] = React.useState<VideoTab>('normal');
  const taskId = searchParams.get('task');
  const currentTask = taskId ? tasks.find((task) => task.taskId === taskId) ?? null : null;
  const handleTaskCreated = React.useCallback(
    (createdTaskId: string) => {
      navigate(`/${mode}?task=${encodeURIComponent(createdTaskId)}`);
    },
    [mode, navigate],
  );

  // Deep-linked `?task=` whose row isn't in the store yet → fetch the
  // list ONCE. The ref guard stops the effect feeding itself (refresh →
  // store change → re-render → refresh …); without it a row that the
  // list never returns would loop.
  const refreshedTaskIds = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const already = taskId ? refreshedTaskIds.current.has(taskId) : false;
    if (!shouldRefreshForTask({ taskId, hasTask: Boolean(currentTask), already })) return;
    if (taskId) refreshedTaskIds.current.add(taskId);
    void refreshTasks();
  }, [currentTask, refreshTasks, taskId]);

  React.useEffect(() => {
    if (!taskId) return;
    const status = currentTask?.status;
    if (status && !['queued', 'executing', 'awaiting_user'].includes(status)) return;
    const timer = window.setInterval(() => {
      void refreshTasks();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [currentTask?.status, refreshTasks, taskId]);

  return (
    <CreativeStudioPage
      mode={mode}
      videoTab={mode === 'video' ? videoTab : undefined}
      onVideoTabChange={
        mode === 'video'
          ? (nextTab) => {
              setVideoTab(nextTab);
              if (taskId) navigate('/video');
            }
          : undefined
      }
      onTaskCreated={handleTaskCreated}
      historyRefreshKey={currentTask ? `${currentTask.taskId}:${currentTask.status}` : taskId ?? ''}
      currentTaskPanel={
        taskId ? (
          <CurrentVideoTaskPanel
            taskId={taskId}
            task={currentTask}
            preferredConfirm={mode === 'image' ? 'image' : 'video'}
          />
        ) : null
      }
    />
  );
}

function CreativeStudioPage({
  mode,
  videoTab = 'normal',
  onVideoTabChange,
  onTaskCreated,
  historyRefreshKey,
  currentTaskPanel,
}: {
  mode: CreativeMode;
  videoTab?: VideoTab;
  onVideoTabChange?(tab: VideoTab): void;
  onTaskCreated(taskId: string): void;
  historyRefreshKey?: string;
  currentTaskPanel: React.ReactNode;
}): JSX.Element {
  const toast = useToast();
  const createTask = useTaskStore((s) => s.createTask);
  const [prompt, setPrompt] = React.useState('');
  const [model, setModel] = React.useState<VideoModel>('veo_fast');
  const [imageModel, setImageModel] = React.useState<ImageModel>('nano_banana_2');
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false);
  const [stylePickerOpen, setStylePickerOpen] = React.useState<CreativeStyleGroup | null>(null);
  const [imageStylePickerOpen, setImageStylePickerOpen] = React.useState(false);
  const [referenceVideoDialogOpen, setReferenceVideoDialogOpen] = React.useState(false);
  const [imageStyle, setImageStyle] = React.useState<ImageStyleKey>('random');
  const [imageGenerationMode, setImageGenerationMode] = React.useState<ImageGenerationMode>('free');
  const [vibeStyle, setVibeStyle] = React.useState<CreativeStyleKey>('random');
  const [lightingStyle, setLightingStyle] = React.useState<CreativeStyleKey>('random');
  const [colorStyle, setColorStyle] = React.useState<CreativeStyleKey>('random');
  const [durationSeconds, setDurationSeconds] = React.useState<VideoDuration>(8);
  const [aspectRatio, setAspectRatio] = React.useState<VideoAspect>(mode === 'image' ? '1:1' : '16:9');
  const [resolution, setResolution] = React.useState<VideoResolution>('1080p');
  const [imageCount, setImageCount] = React.useState<1 | 2 | 3 | 4>(DEFAULT_IMAGE_COUNT);
  const [attachments, setAttachments] = React.useState<DraftAttachment[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const previousVideoTabRef = React.useRef<VideoTab>(videoTab);
  const isImage = mode === 'image';
  const isCloneVideo = !isImage && videoTab === 'pet';
  const isIpVideo = !isImage && videoTab === 'ip';
  const accent = isImage ? '#42C0EF' : '#EA1F59';
  const softBg = isImage ? 'bg-[#42C0EF]/10' : 'bg-[#EA1F59]/10';
  const title = isImage ? '图片任务' : '用AI创作视频';
  const placeholder = isImage
    ? '描述你想让 HOLA DAY 创作的图片内容 ...'
    : '描述你想让 HOLA DAY 创作的视频内容 ...';
  const submitLabel = isImage ? '生成图片' : '生成视频';
  const readyImageAttachmentCount = attachments.filter(
    (attachment) => attachment.status === 'ready' && attachment.fileId && attachment.mimetype.startsWith('image/'),
  ).length;

  React.useEffect(() => {
    setAspectRatio(isImage ? '1:1' : '16:9');
  }, [isImage]);

  React.useEffect(() => {
    const previous = previousVideoTabRef.current;
    previousVideoTabRef.current = videoTab;
    if (isImage || previous === videoTab) return;
    if (videoTab === 'pet') {
      setModel('wan_animate_std');
      return;
    }
    if (cloneModeFromVideoModel(model)) {
      const next = normalVideoParametersAfterTabReturn(model, resolution, durationSeconds);
      setModel(next.model);
      setResolution(next.resolution);
      setDurationSeconds(next.durationSeconds);
    }
  }, [durationSeconds, isImage, model, resolution, videoTab]);

  function applyNormalVideoModel(nextModel: NormalVideoModel): void {
    const next = reconcileNormalVideoParameters(
      {
        model: nextModel as NormalVideoModelId,
        resolution,
        durationSeconds,
      },
      'resolution',
    );
    setModel(nextModel);
    if (next.durationSeconds !== durationSeconds) {
      setDurationSeconds(next.durationSeconds as VideoDuration);
      toast.show('Veo 1080p 仅支持 8 秒，已同步调整时长。', 'info', 3000);
    }
  }

  function applyNormalVideoDuration(nextDuration: VideoDuration): void {
    const next = reconcileNormalVideoParameters(
      {
        model: normalVideoModelFromSelection(model) as NormalVideoModelId,
        resolution,
        durationSeconds: nextDuration,
      },
      'duration',
    );
    setDurationSeconds(next.durationSeconds as VideoDuration);
    if (next.resolution !== resolution) {
      setResolution(next.resolution);
      toast.show('Veo 6 秒仅支持 720p，已同步切换为 720p 标清。', 'info', 3000);
    }
  }

  function applyNormalVideoResolution(nextResolution: VideoResolution): void {
    const next = reconcileNormalVideoParameters(
      {
        model: normalVideoModelFromSelection(model) as NormalVideoModelId,
        resolution: nextResolution,
        durationSeconds,
      },
      'resolution',
    );
    setResolution(next.resolution);
    if (next.durationSeconds !== durationSeconds) {
      setDurationSeconds(next.durationSeconds as VideoDuration);
      toast.show('Veo 1080p 仅支持 8 秒，已同步调整时长。', 'info', 3000);
    }
  }

  async function ingestCreativeFiles(files: FileList | File[], imageOnly = false): Promise<void> {
    const list = Array.from(files);
    if (list.length === 0) return;
    if (attachments.length + list.length > CREATIVE_MAX_ATTACHMENTS) {
      toast.show(`最多附 ${CREATIVE_MAX_ATTACHMENTS} 个文件`);
      return;
    }
    for (const file of list) {
      if (imageOnly && !/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
        toast.show('请上传 PNG / JPG / WebP / GIF 图片', 'error');
        continue;
      }
      const clientId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const previewDataUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      const draft: DraftAttachment = {
        clientId,
        fileId: '',
        filename: file.name,
        mimetype: file.type || 'application/octet-stream',
        size: file.size,
        status: 'uploading',
        ...(previewDataUrl ? { previewDataUrl } : {}),
      };
      setAttachments((prev) => [...prev, draft]);
      try {
        const meta = isCreativeReferenceVideo(file) ? await uploadMediaFile(file) : await uploadFile(file);
        setAttachments((prev) =>
          prev.map((attachment) =>
            attachment.clientId === clientId
              ? { ...attachment, fileId: meta.fileId, status: 'ready' as const }
              : attachment,
          ),
        );
      } catch (err) {
        const message = uploadFailureMessage(err);
        setAttachments((prev) =>
          prev.map((attachment) =>
            attachment.clientId === clientId
              ? { ...attachment, status: 'error' as const, errorMessage: message }
              : attachment,
          ),
        );
        toast.show(message, 'error');
      }
    }
  }

  function removeCreativeAttachment(clientId: string | undefined, index: number): void {
    setAttachments((prev) => {
      const target = clientId
        ? prev.find((attachment) => attachment.clientId === clientId)
        : prev[index];
      if (target?.previewDataUrl?.startsWith('blob:')) URL.revokeObjectURL(target.previewDataUrl);
      return clientId
        ? prev.filter((attachment) => attachment.clientId !== clientId)
        : prev.filter((_, i) => i !== index);
    });
  }

  async function handleSubmit(): Promise<void> {
    const intent = prompt.trim();
    if (intent.length < 4) {
      toast.show(isImage ? '请先描述想生成的图片内容' : '请先描述想生成的视频内容', 'error');
      return;
    }
    if (submitting) return;
    if (attachments.some((attachment) => attachment.status === 'uploading')) {
      toast.show('文件上传中，请稍候');
      return;
    }
    if (isImage && imageGenerationMode === 'lock_subject' && readyImageAttachmentCount === 0) {
      toast.show('请先上传一张清晰的主角图', 'error');
      return;
    }
    setSubmitting(true);
    const fileIds = attachments
      .filter((attachment) => attachment.status === 'ready' && attachment.fileId)
      .map((attachment) => attachment.fileId);
    const styledVideoIntent = buildVideoIntentWithCreativeStyles(intent, {
      vibe: vibeStyle,
      lighting: lightingStyle,
      color: colorStyle,
    });
    const styledImageIntent = buildImageIntentForSubmit(intent, imageStyle, imageGenerationMode);
    const normalVideoModel = normalVideoModelFromSelection(model);
    const finalIntent = isImage
      ? `生成图片：${styledImageIntent}`
      : styledVideoIntent;
    const imageOptions = buildImageCreationOptions(imageModel, aspectRatio, imageCount);
    try {
      const res = isImage
        ? await createTask(
            finalIntent,
            fileIds,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            imageOptions,
          )
        : await createTask(finalIntent, fileIds, undefined, undefined, undefined, undefined, {
            tab: 'normal',
            model: normalVideoModel,
            style: inferVideoStyleOption('auto', {
              vibe: vibeStyle,
              lighting: lightingStyle,
              color: colorStyle,
            }),
            aspectRatio,
            resolution,
            durationSeconds,
          });
      if ('error' in res) {
        toast.show(res.error || '提交失败，请重试', 'error');
        return;
      }
      if (isImage) {
        for (const attachment of attachments) {
          if (attachment.previewDataUrl?.startsWith('blob:')) URL.revokeObjectURL(attachment.previewDataUrl);
        }
        setAttachments([]);
        setPrompt('');
      }
      toast.show(isImage ? '已提交，图片生成中' : '已提交，请确认报价后开始制作', 'info', 3000);
      onTaskCreated(res.taskId);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '提交失败，请重试', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-full bg-white">
      <PageContainer width="wide" className="max-w-[1220px] pb-14 pt-10 md:px-12 md:pt-12">
        <div className="relative overflow-hidden rounded-none">
          <div className="pointer-events-none absolute right-20 top-5 hidden h-32 w-[320px] items-center justify-center opacity-80 md:flex">
            <div className={cn('flex h-20 w-20 rotate-[-10deg] items-center justify-center rounded-[24px] bg-white shadow-[0_18px_42px_rgba(17,24,39,0.08)]', isImage && 'text-[#42C0EF]', !isImage && 'text-[#EA1F59]')}>
              {isImage ? <ImagePlus className="h-12 w-12" /> : <Clapperboard className="h-12 w-12" />}
            </div>
            <div className="ml-4 flex h-[72px] w-[72px] rotate-[8deg] items-center justify-center rounded-[22px] bg-[#EA1F59]/10 text-[#EA1F59] shadow-[0_14px_32px_rgba(234,31,89,0.10)]">
              <Sparkles className="h-8 w-8" />
            </div>
            <div className={cn('ml-3 flex h-14 w-14 rotate-[14deg] items-center justify-center rounded-[18px] bg-white shadow-[0_14px_30px_rgba(17,24,39,0.06)]', isImage ? 'text-[#42C0EF]' : 'text-[#EA1F59]')}>
              {isImage ? <VideoIcon className="h-8 w-8" /> : <ImagePlus className="h-8 w-8" />}
            </div>
          </div>
          <header className="relative z-10 mb-5">
            <h1 className="text-[30px] font-semibold leading-tight tracking-normal text-[#111827] md:text-[34px]">
              {title}
              <Sparkles
                className={cn(
                  'ml-2 inline h-5 w-5 align-super',
                  isImage ? 'text-[#42C0EF]' : 'text-[#EA1F59]',
                )}
              />
            </h1>
          </header>

          {!isImage && onVideoTabChange && (
            <CreativeTypeTabs
              value={videoTab}
              onChange={onVideoTabChange}
              accent={accent}
            />
          )}

          <div className="relative z-40 mt-5 rounded-[22px] border border-[#EFEFEF] bg-white px-5 py-4 shadow-[0_16px_42px_rgba(17,24,39,0.05)]">
            <div
              className={cn(
                'grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 2xl:items-end',
                isImage
                  ? '2xl:grid-cols-[260px_minmax(360px,1fr)_230px_190px]'
                  : isCloneVideo
                    ? '2xl:grid-cols-[260px_minmax(360px,1fr)]'
                    : isIpVideo
                      ? '2xl:grid-cols-[280px_minmax(360px,1fr)_230px]'
                      : '2xl:grid-cols-[190px_minmax(340px,1fr)_150px_210px_190px]',
              )}
            >
              {isImage ? (
                <CreativeModelPicker
                  value={imageModel}
                  options={IMAGE_MODEL_OPTIONS}
                  open={modelPickerOpen}
                  onOpenChange={setModelPickerOpen}
                  onChange={(value) => setImageModel(value as ImageModel)}
                  accent={accent}
                  modelKind="image"
                />
              ) : isCloneVideo ? (
                <CreativeModelPicker
                  value={model}
                  options={CLONE_MODEL_OPTIONS}
                  open={modelPickerOpen}
                  onOpenChange={setModelPickerOpen}
                  onChange={(value) => setModel(value as VideoModel)}
                  accent={accent}
                  modelKind="video"
                />
              ) : isIpVideo ? (
                <CreativeReadonlyField
                  label="生成引擎"
                  value="Qwen Voice + LatentSync"
                  description="固定使用已准备的本人声纹与出镜底版"
                />
              ) : (
                <CreativeModelPicker
                  value={model}
                  options={CREATIVE_MODEL_OPTIONS}
                  open={modelPickerOpen}
                  onOpenChange={setModelPickerOpen}
                  onChange={(value) => applyNormalVideoModel(value as NormalVideoModel)}
                  accent={accent}
                  modelKind="video"
                />
              )}
              {isImage ? (
                <ImageStyleSummaryPicker
                  value={imageStyle}
                  open={imageStylePickerOpen}
                  onOpenChange={setImageStylePickerOpen}
                  onChange={setImageStyle}
                  accent={accent}
                />
              ) : videoTab === 'normal' ? (
                <CreativeStyleSummaryPicker
                  vibe={vibeStyle}
                  lighting={lightingStyle}
                  color={colorStyle}
                  previewSubject="default"
                  openGroup={stylePickerOpen}
                  onOpenGroupChange={setStylePickerOpen}
                  onVibeChange={setVibeStyle}
                  onLightingChange={setLightingStyle}
                  onColorChange={setColorStyle}
                  accent={accent}
                />
              ) : isCloneVideo ? (
                <CreativeReadonlyField
                  label="复刻范围"
                  value="主角替换，其他跟随参考视频"
                  description="动作、镜头、节奏、时长和音频均以参考视频为准"
                />
              ) : (
                <CreativeReadonlyField
                  label="人物一致性"
                  value="本人底版 + 本人声音"
                  description="可在下方重新上传或清除素材"
                />
              )}
              {!isImage && videoTab === 'normal' && (
                <CreativeSegment
                  label="时长"
                  value={durationSeconds}
                  options={[
                    { value: 6, label: '6s' },
                    { value: 8, label: '8s' },
                  ]}
                  onChange={(value) => applyNormalVideoDuration(value as VideoDuration)}
                  accent={accent}
                  compact
                />
              )}
              {!isCloneVideo ? (
                <CreativeSegment
                  label="比例"
                  value={aspectRatio}
                  options={CREATIVE_ASPECT_OPTIONS}
                  onChange={(value) => setAspectRatio(value as VideoAspect)}
                  accent={accent}
                  compact
                  className="md:col-span-2 2xl:col-span-1"
                />
              ) : null}
              {isImage ? (
                <CreativeSegment
                  label="生成数量"
                  value={imageCount}
                  options={[
                    { value: 1, label: '1' },
                    { value: 2, label: '2' },
                    { value: 3, label: '3' },
                    { value: 4, label: '4' },
                  ]}
                  onChange={(value) => setImageCount(value as 1 | 2 | 3 | 4)}
                  accent={accent}
                  compact
                />
              ) : videoTab === 'normal' ? (
                <CreativeSelect
                  label="画质"
                  value={resolution === '1080p' ? '1080p 高清' : '720p 标清'}
                  options={['1080p 高清', '720p 标清']}
                  onPick={(value) =>
                    applyNormalVideoResolution(value.includes('720') ? '720p' : '1080p')
                  }
                />
              ) : null}
            </div>
          </div>

          {isImage ? (
            <ImageModeChooser
              value={imageGenerationMode}
              onChange={setImageGenerationMode}
              onAddSubject={() => imageInputRef.current?.click()}
              subjectImageCount={readyImageAttachmentCount}
              accent={accent}
            />
          ) : null}

          {!isImage && videoTab !== 'normal' ? (
            <>
              <div className="relative z-10 mt-5 rounded-[26px] border border-[#EFEFEF] bg-white p-5 shadow-[0_16px_42px_rgba(17,24,39,0.05)]">
                {videoTab === 'pet' ? (
                  <PetVideoForm
                    onTaskCreated={onTaskCreated}
                    model={model}
                  />
                ) : (
                  <IpOnboardingWizard
                    onTaskCreated={onTaskCreated}
                    aspectRatio={aspectRatio}
                  />
                )}
                {currentTaskPanel ? <div className="mt-6">{currentTaskPanel}</div> : null}
              </div>
              <CreativeHistory
                mode="video"
                accent={accent}
                softBg={softBg}
                videoType={videoTab === 'pet' ? 'pet' : 'ip_person'}
                refreshKey={historyRefreshKey}
              />
            </>
          ) : (
            <>

          <div className="relative z-10 mt-5 rounded-[24px] border border-[#EFEFEF] bg-white p-6 shadow-[0_16px_42px_rgba(17,24,39,0.05)]">
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={placeholder}
              rows={6}
              className="min-h-[168px] resize-none border-0 bg-transparent p-0 text-[16px] font-semibold leading-7 text-[#111827] placeholder:text-[#DCDDDD] focus-visible:ring-0"
            />
            {attachments.length > 0 ? (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-[#EFEFEF] pt-4">
                {attachments.map((attachment, index) => (
                  <AttachmentChip
                    key={attachment.clientId ?? `${attachment.filename}-${index}`}
                    attachment={attachment}
                    onRemove={() => removeCreativeAttachment(attachment.clientId, index)}
                  />
                ))}
              </div>
            ) : null}
            <div className="mt-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 text-[#ADADAD]">
                <button
                  type="button"
                  title={isImage && imageGenerationMode === 'lock_subject' ? '添加主角图' : '添加参考图'}
                  aria-label={isImage && imageGenerationMode === 'lock_subject' ? '添加主角图' : '添加参考图'}
                  onClick={() => imageInputRef.current?.click()}
                  className="rounded-[8px] p-1.5 outline-none hover:bg-[#EFEFEF] hover:text-[#595757] focus-visible:bg-[#EA1F59]/10 focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20"
                >
                  <ImagePlus className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  title="添加参考视频"
                  aria-label="添加参考视频"
                  onClick={() => setReferenceVideoDialogOpen(true)}
                  className="rounded-[8px] p-1.5 outline-none hover:bg-[#EFEFEF] hover:text-[#595757] focus-visible:bg-[#EA1F59]/10 focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20"
                >
                  <VideoIcon className="h-5 w-5" />
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept={CREATIVE_ACCEPT_IMAGES}
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    if (event.target.files) void ingestCreativeFiles(event.target.files, true);
                    event.target.value = '';
                  }}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={CREATIVE_ACCEPT_REFERENCE_VIDEO}
                  className="hidden"
                  onChange={(event) => {
                    if (event.target.files) {
                      void ingestCreativeFiles(event.target.files).finally(() => setReferenceVideoDialogOpen(false));
                    }
                    event.target.value = '';
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={submitting}
                className={cn(
                  'inline-flex h-[46px] min-h-[46px] items-center gap-2 rounded-full border px-4 py-2 text-[15px] font-semibold text-white shadow-[0_12px_26px_rgba(87,71,156,0.15)] transition-all disabled:cursor-not-allowed disabled:opacity-60',
                  isImage
                    ? 'border-[#42C0EF] bg-[#42C0EF] hover:bg-[#42C0EF]/90'
                    : 'border-[#EA1F59] bg-[#EA1F59] hover:bg-[#EA1F59]/90',
                )}
              >
                {submitting ? '提交中…' : submitLabel}
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/18">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
                </span>
              </button>
            </div>
            {referenceVideoDialogOpen ? (
              <ReferenceVideoUploadDialog
                onClose={() => setReferenceVideoDialogOpen(false)}
                onChoose={() => fileInputRef.current?.click()}
              />
            ) : null}
          </div>

          {currentTaskPanel ? <div className="relative z-10 mt-6">{currentTaskPanel}</div> : null}
          <CreativeHistory mode={mode} accent={accent} softBg={softBg} refreshKey={historyRefreshKey} />
            </>
          )}
        </div>
      </PageContainer>
    </div>
  );
}

function CreativeTypeTabs({
  value,
  onChange,
  accent,
}: {
  value: VideoTab;
  onChange(tab: VideoTab): void;
  accent: string;
}): JSX.Element {
  return (
    <div className="relative z-10 flex flex-wrap gap-2" role="tablist" aria-label="视频类型">
      {VIDEO_TABS.map((tab) => {
        const Icon = tab.icon;
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors',
              active
                ? 'bg-white shadow-[0_8px_18px_rgba(17,24,39,0.07)]'
                : 'border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:text-[#111827]',
            )}
            style={
              active
                ? { borderColor: `${accent}55`, color: accent }
                : undefined
            }
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function ImageModeChooser({
  value,
  onChange,
  onAddSubject,
  subjectImageCount,
  accent,
}: {
  value: ImageGenerationMode;
  onChange(value: ImageGenerationMode): void;
  onAddSubject(): void;
  subjectImageCount: number;
  accent: string;
}): JSX.Element {
  const locked = value === 'lock_subject';
  return (
    <section className="relative z-30 mt-5 rounded-[22px] border border-[#EFEFEF] bg-white p-4 shadow-[0_14px_34px_rgba(17,24,39,0.04)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-[#ADADAD]">图片生成方式</div>
          <div className="mt-1 text-[13px] leading-5 text-[#6B7280]">
            锁定主角会优先保留上传图里的主体，只改画面表达。
          </div>
        </div>
        {locked ? (
          <button
            type="button"
            onClick={onAddSubject}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-[#DCDDDD] bg-white px-3 text-[13px] font-semibold text-[#111827] hover:border-[#ADADAD]"
          >
            <ImagePlus className="h-4 w-4" />
            添加主角图
          </button>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ImageModeOption
          active={!locked}
          icon={<Sparkles className="h-5 w-5" />}
          title="自由创作"
          description="从文字和参考图生成，不强制保持同一主体。"
          onClick={() => onChange('free')}
          accent={accent}
        />
        <ImageModeOption
          active={locked}
          icon={<Lock className="h-5 w-5" />}
          title="锁定主角"
          description="上传人物、宠物、商品或 IP 图后，保持主体一致，只换背景、风格、光线、动作和构图。"
          meta={subjectImageCount > 0 ? `已就绪 ${subjectImageCount} 张主角图` : '需要至少 1 张主角图'}
          onClick={() => onChange('lock_subject')}
          accent={accent}
        />
      </div>
    </section>
  );
}

function ImageModeOption({
  active,
  icon,
  title,
  description,
  meta,
  onClick,
  accent,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  meta?: string;
  onClick(): void;
  accent: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex min-h-[92px] items-start gap-3 rounded-[16px] border bg-white p-4 text-left transition-colors',
        active ? 'shadow-[0_10px_24px_rgba(17,24,39,0.05)]' : 'border-[#EFEFEF] hover:border-[#DCDDDD]',
      )}
      style={active ? { borderColor: accent, backgroundColor: `${accent}0D` } : undefined}
    >
      <span
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[#F6F7F9] text-[#595757]"
        style={active ? { backgroundColor: `${accent}18`, color: accent } : undefined}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[15px] font-semibold text-[#111827]">{title}</span>
          {active ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-full text-white" style={{ backgroundColor: accent }}>
              <Check className="h-3.5 w-3.5" />
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-[13px] leading-5 text-[#6B7280]">{description}</span>
        {meta ? <span className="mt-2 block text-[12px] font-semibold text-[#8B93A6]">{meta}</span> : null}
      </span>
    </button>
  );
}

function isCreativeReferenceVideo(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|mov)$/i.test(file.name);
}

function modelOptionFor(model: CreativeModelValue, options: ReadonlyArray<CreativeModelOption> = CREATIVE_MODEL_OPTIONS): CreativeModelOption {
  return options.find((option) => option.value === model) ?? options[0] ?? CREATIVE_MODEL_OPTIONS[0];
}

function modelPreviewSrc(model: CreativeModelValue): string {
  if (model === 'nano_banana_2') return '/video-style-previews/models/nano_banana_2.svg';
  if (model === 'nano_banana_pro') return '/video-style-previews/models/nano_banana_pro.svg';
  if (model === 'wanxiang') return '/video-style-previews/models/wanxiang.svg';
  return `/video-style-previews/models/${model}.png`;
}

function imageStyleOptionFor(key: ImageStyleKey): (typeof IMAGE_STYLE_OPTIONS)[number] {
  return IMAGE_STYLE_OPTIONS.find((option) => option.key === key) ?? IMAGE_STYLE_OPTIONS[0];
}

function imageStylePreviewSrc(key: ImageStyleKey): string {
  return `/image-style-previews/${key}.png`;
}

function buildImageIntentWithStyle(intent: string, imageStyle: ImageStyleKey): string {
  const option = imageStyleOptionFor(imageStyle);
  if (option.key === 'random' || !option.prompt) return intent;
  return `${intent}\n\n图片风格要求：${option.prompt}。`;
}

export function buildImageIntentWithMode(
  intent: string,
  imageStyle: ImageStyleKey,
  imageMode: ImageGenerationMode,
): string {
  const styled = buildImageIntentWithStyle(intent, imageStyle);
  if (imageMode !== 'lock_subject') return styled;
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

export function buildImageIntentForSubmit(
  intent: string,
  imageStyle: ImageStyleKey,
  imageMode: ImageGenerationMode,
): string {
  return buildImageIntentWithMode(intent, imageStyle, imageMode);
}

function styleOptionFor(group: CreativeStyleGroup, key: CreativeStyleKey): (typeof STYLE_OPTIONS_BY_GROUP)[CreativeStyleGroup][number] {
  return STYLE_OPTIONS_BY_GROUP[group].find((option) => option.key === key) ?? STYLE_OPTIONS_BY_GROUP[group][0];
}

function stylePreviewSrc(group: CreativeStyleGroup, key: CreativeStyleKey, subject: CreativeStylePreviewSubject): string {
  if (subject === 'human') return `/video-style-previews/human/${group}/${key}.png`;
  return `/video-style-previews/${group}/${key}.png`;
}

function selectedStylePrompt(group: CreativeStyleGroup, key: CreativeStyleKey): string | undefined {
  const option = styleOptionFor(group, key);
  if (option.key === 'random') return undefined;
  return option.prompt;
}

export function buildVideoIntentWithCreativeStyles(
  intent: string,
  styles: { vibe: CreativeStyleKey; lighting: CreativeStyleKey; color: CreativeStyleKey },
): string {
  const prompts = [
    selectedStylePrompt('vibe', styles.vibe),
    selectedStylePrompt('lighting', styles.lighting),
    selectedStylePrompt('color', styles.color),
  ].filter((value): value is string => Boolean(value));
  if (prompts.length === 0) return intent;
  return `${intent}\n\n视觉风格要求：${prompts.join('；')}。`;
}

export function buildCloneVideoIntent(intent: string): string {
  const trimmed = intent.trim();
  const lines = ['复刻视频：使用上传照片替换参考视频中的主角，并保留参考视频的动作、镜头、节奏和音频。'];
  if (trimmed.length > 0) {
    lines.push(`任务备注（仅用于记录，不改变本次模型输入）：${trimmed}`);
  }
  return lines.join('\n');
}

export function buildIpVideoIntent(
  intent: string,
  _styles?: { vibe: CreativeStyleKey; lighting: CreativeStyleKey; color: CreativeStyleKey },
): string {
  return intent;
}

export function inferVideoStyleOption(
  base: VideoStyleOption,
  styles: { vibe: CreativeStyleKey; lighting: CreativeStyleKey; color: CreativeStyleKey },
): VideoStyleOption {
  if (base !== 'auto') return base;
  if (styles.vibe === 'sci_fi') return 'science';
  if (styles.lighting !== 'random') return 'atmospheric';
  if (styles.color !== 'random') return 'atmospheric';
  if (styles.vibe === 'pro_photo' || styles.vibe === 'stock_footage') return 'realistic';
  return 'auto';
}

function CreativeModelPicker({
  value,
  options = CREATIVE_MODEL_OPTIONS,
  open,
  onOpenChange,
  onChange,
  accent,
  modelKind = 'video',
}: {
  value: CreativeModelValue;
  options?: ReadonlyArray<CreativeModelOption>;
  open: boolean;
  onOpenChange(open: boolean): void;
  onChange(value: CreativeModelValue): void;
  accent: string;
  modelKind?: CreativeMode;
}): JSX.Element {
  const selected = modelOptionFor(value, options);
  const effectiveValue = selected.value;
  const modelCopy =
    modelKind === 'image'
      ? '只显示当前图片任务真实接入的模型。'
      : '只显示当前视频任务真实接入的模型。';
  return (
    <div className="relative">
      <div className="mb-2 text-[13px] font-semibold text-[#ADADAD]">AI 模型</div>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="flex h-11 w-full items-center gap-3 rounded-[10px] border border-[#DCDDDD] bg-white px-3 text-left outline-none transition-colors hover:border-[#ADADAD] focus:border-[#EA1F59]"
      >
        <img
          src={modelPreviewSrc(selected.value)}
          alt=""
          className="h-7 w-7 rounded-[8px] object-cover"
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-semibold leading-none text-[#8B93A6]">
            模型
          </span>
          <span className="block truncate text-[14px] font-semibold leading-5 text-[#111827]">
            {selected.name} {selected.version}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 text-[#595757]" />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-8" onMouseDown={() => onOpenChange(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={modelKind === 'image' ? '选择图片模型' : '选择视频模型'}
            className="max-h-[min(720px,calc(100vh-56px))] w-full max-w-[620px] overflow-hidden rounded-[24px] border border-[#DCDDDD] bg-white shadow-[0_28px_80px_rgba(17,24,39,0.24)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[#EFEFEF] px-5 py-4">
          <div>
            <h2 className="text-[18px] font-semibold text-[#111827]">Models</h2>
                <p className="mt-1 text-[12px] text-[#8B93A6]">{modelCopy}</p>
          </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-[10px] p-2 text-[#8B93A6] hover:bg-[#EFEFEF] hover:text-[#111827]"
                aria-label="关闭模型选择"
                title="关闭模型选择"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[560px] space-y-3 overflow-y-auto p-5">
              {options.map((option) => {
                const active = option.value === effectiveValue;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onChange(option.value);
                      onOpenChange(false);
                    }}
                    className={cn(
                      'grid w-full grid-cols-[72px_1fr] gap-4 rounded-[20px] border p-3 text-left transition-colors',
                      active
                        ? 'border-[#EA1F59]/55 bg-[#EA1F59]/5'
                        : 'border-[#EFEFEF] bg-white hover:border-[#DCDDDD] hover:bg-[#FAFAFA]',
                    )}
                  >
                    <img
                      src={modelPreviewSrc(option.value)}
                      alt=""
                      className="h-[72px] w-[72px] rounded-[18px] object-cover"
                      aria-hidden
                    />
                    <span className="min-w-0 py-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-semibold text-[#111827]">
                          {option.name} {option.version}
                        </span>
                        {active ? (
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: accent }}>
                            已选择
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-[12px] leading-5 text-[#595757]">{option.description}</span>
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        {option.badges.map((badge) => (
                          <span key={badge} className="rounded-full bg-[#EFEFEF] px-2 py-0.5 text-[11px] font-medium text-[#595757]">
                            {badge}
                          </span>
                        ))}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CreativeStyleSummaryPicker({
  vibe,
  lighting,
  color,
  openGroup,
  onOpenGroupChange,
  onVibeChange,
  onLightingChange,
  onColorChange,
  accent,
  previewSubject,
}: {
  vibe: CreativeStyleKey;
  lighting: CreativeStyleKey;
  color: CreativeStyleKey;
  previewSubject: CreativeStylePreviewSubject;
  openGroup: CreativeStyleGroup | null;
  onOpenGroupChange(group: CreativeStyleGroup | null): void;
  onVibeChange(value: CreativeStyleKey): void;
  onLightingChange(value: CreativeStyleKey): void;
  onColorChange(value: CreativeStyleKey): void;
  accent: string;
}): JSX.Element {
  const values: Record<CreativeStyleGroup, CreativeStyleKey> = {
    vibe,
    lighting,
    color,
  };
  const onChangeByGroup: Record<CreativeStyleGroup, (value: CreativeStyleKey) => void> = {
    vibe: onVibeChange,
    lighting: onLightingChange,
    color: onColorChange,
  };
  const selected = (Object.keys(STYLE_GROUPS) as CreativeStyleGroup[])
    .map((group) => styleOptionFor(group, values[group]).label)
    .filter((label) => label !== '随机');
  const summary = selected.length === 0 ? '随机' : selected.join(' / ');
  return (
    <div className="md:col-span-2 2xl:col-span-1">
      <div className="mb-2 text-[13px] font-semibold text-[#ADADAD]">风格样式</div>
      <button
        type="button"
        onClick={() => onOpenGroupChange('vibe')}
        className="flex h-11 w-full min-w-0 items-center gap-3 rounded-[10px] border border-[#DCDDDD] bg-white px-3 text-left transition-colors hover:border-[#ADADAD] focus:border-[#EA1F59] focus:outline-none"
      >
        <CreativeStyleIcon />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] leading-none text-[#8B93A6]">
            氛围 / 光感 / 色彩
          </span>
          <span className="block truncate text-[13px] font-semibold leading-5 text-[#111827]">
            {summary}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#595757]" />
      </button>
      {openGroup ? (
        <CreativeStyleDialog
          activeGroup={openGroup}
          values={values}
          onActiveGroupChange={onOpenGroupChange}
          onChange={(group, value) => onChangeByGroup[group](value)}
          onClose={() => onOpenGroupChange(null)}
          accent={accent}
          previewSubject={previewSubject}
        />
      ) : null}
    </div>
  );
}

function CreativeStyleIcon(): JSX.Element {
  return (
    <span className="relative flex h-7 w-7 shrink-0 overflow-hidden rounded-[8px] bg-[#0F172A] shadow-[inset_0_1px_1px_rgba(255,255,255,0.42),0_8px_16px_rgba(17,24,39,0.16)]">
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_24%_22%,rgba(255,255,255,0.78)_0%,rgba(255,255,255,0.18)_18%,rgba(255,255,255,0)_34%),linear-gradient(135deg,#1E9BFF_0%,#6F5BFF_38%,#EA1F59_72%,#FFB23F_100%)]" aria-hidden />
      <span className="absolute -left-2 top-3 h-6 w-8 rotate-[-18deg] rounded-full bg-white/18 blur-[2px]" aria-hidden />
      <span className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full bg-white/22 blur-[1px]" aria-hidden />
    </span>
  );
}

function ImageStyleSummaryPicker({
  value,
  open,
  onOpenChange,
  onChange,
  accent,
}: {
  value: ImageStyleKey;
  open: boolean;
  onOpenChange(open: boolean): void;
  onChange(value: ImageStyleKey): void;
  accent: string;
}): JSX.Element {
  const selected = imageStyleOptionFor(value);
  return (
    <div className="md:col-span-2 2xl:col-span-1">
      <div className="mb-2 text-[13px] font-semibold text-[#ADADAD]">风格样式</div>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="flex h-11 w-full min-w-0 items-center gap-3 rounded-[10px] border border-[#DCDDDD] bg-white px-3 text-left transition-colors hover:border-[#ADADAD] focus:border-[#42C0EF] focus:outline-none"
      >
        <CreativeStyleIcon />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] leading-none text-[#8B93A6]">图片风格</span>
          <span className="block truncate text-[13px] font-semibold leading-5 text-[#111827]">
            {selected.label}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#595757]" />
      </button>
      {open ? (
        <ImageStyleDialog
          value={value}
          onChange={onChange}
          onClose={() => onOpenChange(false)}
          accent={accent}
        />
      ) : null}
    </div>
  );
}

function ImageStyleDialog({
  value,
  onChange,
  onClose,
  accent,
}: {
  value: ImageStyleKey;
  onChange(value: ImageStyleKey): void;
  onClose(): void;
  accent: string;
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-8" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="选择图片风格"
        className="max-h-[min(760px,calc(100vh-56px))] w-full max-w-[760px] overflow-hidden rounded-[24px] border border-white/20 bg-[#151515] text-white shadow-[0_28px_80px_rgba(0,0,0,0.34)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-[18px] font-semibold text-white">图片风格</h2>
            <p className="mt-1 text-[12px] text-white/55">选择会写进图片提示词；随机则交给模型自行判断。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] bg-white/10 p-2 text-white/70 hover:bg-white/15 hover:text-white"
            aria-label="关闭图片风格选择"
            title="关闭图片风格选择"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[620px] overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {IMAGE_STYLE_OPTIONS.map((option) => {
              const active = option.key === value;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    onChange(option.key);
                    onClose();
                  }}
                  aria-label={`${option.label}：${option.description}`}
                  title={option.description}
                  className={cn(
                    'group overflow-hidden rounded-[12px] border bg-[#222222] text-left transition-colors',
                    active
                      ? 'shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_12px_28px_rgba(0,0,0,0.24)]'
                      : 'border-white/10 hover:border-white/28',
                  )}
                  style={active ? { borderColor: accent } : undefined}
                >
                  <span className="relative flex aspect-square items-end overflow-hidden bg-[#111827]">
                    <img
                      src={imageStylePreviewSrc(option.key)}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                      aria-hidden
                    />
                    <span className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/88 via-black/42 to-transparent" />
                    {active ? (
                      <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-white" style={{ backgroundColor: accent }}>
                        <Check className="h-4 w-4" />
                      </span>
                    ) : null}
                    <span className="relative z-10 w-full px-3 pb-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.72)]">
                      <span className="block text-[13px] font-semibold text-white">{option.label}</span>
                      <span className="mt-0.5 block truncate text-[11px] font-medium text-white/78">{option.description}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreativeStyleDialog({
  activeGroup,
  values,
  onActiveGroupChange,
  onChange,
  onClose,
  accent,
  previewSubject,
}: {
  activeGroup: CreativeStyleGroup;
  values: Record<CreativeStyleGroup, CreativeStyleKey>;
  onActiveGroupChange(group: CreativeStyleGroup): void;
  onChange(group: CreativeStyleGroup, value: CreativeStyleKey): void;
  onClose(): void;
  accent: string;
  previewSubject: CreativeStylePreviewSubject;
}): JSX.Element {
  const title = STYLE_GROUPS[activeGroup].title;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-8" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`选择${title}`}
        className="max-h-[min(760px,calc(100vh-56px))] w-full max-w-[560px] overflow-hidden rounded-[24px] border border-white/20 bg-[#151515] text-white shadow-[0_28px_80px_rgba(0,0,0,0.34)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
          <div>
            <h2 className="text-[18px] font-semibold text-white">{title}</h2>
            <p className="mt-1 text-[12px] text-white/55">选择会写进视频提示词；随机则交给模型自行判断。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] bg-white/10 p-2 text-white/70 hover:bg-white/15 hover:text-white"
            aria-label="关闭风格选择"
            title="关闭风格选择"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-3 px-5 pt-2">
          {(Object.keys(STYLE_GROUPS) as CreativeStyleGroup[]).map((group) => {
            const active = group === activeGroup;
            return (
              <button
                key={group}
                type="button"
                onClick={() => onActiveGroupChange(group)}
                className={cn(
                  'border-b-2 px-3 pb-3 text-[14px] font-semibold transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-0',
                  active ? 'text-white' : 'border-transparent text-white/55 hover:text-white/78',
                )}
                style={active ? { borderColor: accent } : undefined}
              >
                {STYLE_GROUPS[group].title}
                <span className="ml-1 text-[12px] font-medium text-white/42">
                  {STYLE_GROUPS[group].subtitle}
                </span>
              </button>
            );
          })}
        </div>
        <div className="max-h-[580px] overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STYLE_OPTIONS_BY_GROUP[activeGroup].map((option) => {
              const active = option.key === values[activeGroup];
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => onChange(activeGroup, option.key)}
                  aria-label={`${option.label}：${option.description}`}
                  title={option.description}
                  className={cn(
                    'group overflow-hidden rounded-[10px] border bg-[#222222] text-left transition-colors',
                    active
                      ? 'shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_12px_28px_rgba(0,0,0,0.24)]'
                      : 'border-white/10 hover:border-white/28',
                  )}
                  style={active ? { borderColor: accent } : undefined}
                >
                  <span className="relative flex aspect-square items-end overflow-hidden bg-[#111827]">
                    <img
                      src={stylePreviewSrc(activeGroup, option.key, previewSubject)}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                      aria-hidden
                    />
                    <span className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/62 to-transparent" />
                    {active ? (
                      <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-white" style={{ backgroundColor: accent }}>
                        <Check className="h-4 w-4" />
                      </span>
                    ) : null}
                    <span className="relative z-10 w-full px-3 pb-2 text-[13px] font-semibold text-white">
                      {option.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReferenceVideoUploadDialog({
  onClose,
  onChoose,
}: {
  onClose(): void;
  onChoose(): void;
}): React.ReactPortal | null {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#111827]/28 px-4 py-8 backdrop-blur-[1px]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="添加参考视频"
        className="w-full max-w-[420px] overflow-hidden rounded-[24px] border border-white/70 bg-white shadow-[0_28px_80px_rgba(17,24,39,0.22)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#EFEFEF] px-5 py-4">
          <div>
            <h2 className="text-[17px] font-semibold text-[#111827]">添加参考视频</h2>
            <p className="mt-1 text-[12px] leading-5 text-[#8B93A6]">用于参考动作、节奏、镜头或构图。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] p-2 text-[#8B93A6] hover:bg-[#EFEFEF] hover:text-[#111827]"
            aria-label="关闭添加参考视频"
            title="关闭添加参考视频"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">
          <div className="rounded-[20px] border border-[#EFEFEF] bg-[#FAFAFA] p-4">
            <div className="flex items-start gap-3">
              <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-[linear-gradient(135deg,#EA1F59_0%,#8A63FF_55%,#1E9BFF_100%)] text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.48),0_10px_20px_rgba(234,31,89,0.16)]">
                <span className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,0.62),rgba(255,255,255,0)_35%)]" aria-hidden />
                <Clapperboard className="relative h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-[#111827]">参考视频文件</div>
                <div className="mt-1 text-[12px] leading-5 text-[#8B93A6]">
                  支持 MP4 / MOV。建议上传清晰、较短的视频片段，最终以生成结果为准。
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-[#595757] ring-1 ring-[#EFEFEF]">MP4</span>
                  <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-[#595757] ring-1 ring-[#EFEFEF]">MOV</span>
                  <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-[#595757] ring-1 ring-[#EFEFEF]">动作参考</span>
                  <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-[#595757] ring-1 ring-[#EFEFEF]">镜头参考</span>
                </div>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button type="button" variant="outline" className="h-9 rounded-full px-4 text-[13px]" onClick={onClose}>
                取消
              </Button>
              <Button type="button" className="h-9 rounded-full bg-[#EA1F59] px-4 text-[13px] hover:bg-[#EA1F59]/90" onClick={onChoose}>
                选择视频
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CreativeReadonlyField({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}): JSX.Element {
  return (
    <div className="min-w-0">
      <div className="mb-2 text-[13px] font-semibold text-[#ADADAD]">{label}</div>
      <div className="flex min-h-11 min-w-0 items-center rounded-[10px] border border-[#DCDDDD] bg-white px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-[#111827]">{value}</div>
          <div className="mt-0.5 truncate text-[11px] text-[#8B93A6]">{description}</div>
        </div>
      </div>
    </div>
  );
}

function CreativeSelect({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onPick(value: string): void;
}): JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <div
      className="relative"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!next || !event.currentTarget.contains(next as Node)) setOpen(false);
      }}
    >
      <div className="mb-2 text-[13px] font-semibold text-[#ADADAD]">{label}</div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex h-11 w-full items-center justify-between rounded-[10px] border bg-white px-4 text-left text-[14px] font-semibold text-[#111827] outline-none transition-colors',
          open ? 'border-[#EA1F59]' : 'border-[#DCDDDD] hover:border-[#ADADAD]',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{value === 'auto' ? 'Auto' : value}</span>
        <ChevronDown className={cn('h-4 w-4 text-[#595757] transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-[70] overflow-hidden rounded-[12px] border border-[#DCDDDD] bg-white p-1 shadow-[0_18px_44px_rgba(17,24,39,0.14)]"
        >
          {options.map((option) => {
            const active = option === value || (value === 'auto' && option === 'Auto');
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onPick(option);
                  setOpen(false);
                }}
                className={cn(
                  'flex h-9 w-full items-center justify-between rounded-[9px] px-3 text-left text-[13px] font-semibold transition-colors',
                  active ? 'bg-[#EA1F59]/10 text-[#EA1F59]' : 'text-[#111827] hover:bg-[#F7F7F7]',
                )}
              >
                <span>{option}</span>
                {active ? <Check className="h-4 w-4" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CreativeSegment<T extends string | number>({
  label,
  value,
  options,
  onChange,
  accent,
  compact = false,
  className,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange(value: T): void;
  accent: string;
  compact?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <div className={className}>
      <div className="mb-2 text-[13px] font-semibold text-[#ADADAD]">{label}</div>
      <div className="flex h-11 w-full items-center gap-1 overflow-hidden rounded-[10px] bg-[#EFEFEF]/70 p-1">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => onChange(option.value)}
              className={cn(
                'flex h-9 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-[8px] px-3 text-[14px] font-semibold leading-none transition-colors',
                compact && 'px-3',
                active ? 'bg-white shadow-[0_1px_4px_rgba(15,23,42,0.08)]' : 'text-[#111827] hover:bg-white/60',
              )}
              style={active ? { color: accent } : undefined}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CreativeHistory({
  mode,
  accent,
  softBg,
  videoType = 'normal',
  refreshKey,
}: {
  mode: CreativeMode;
  accent: string;
  softBg: string;
  videoType?: VideoType;
  refreshKey?: string;
}): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const togglePin = useTaskStore((state) => state.togglePin);
  const [{ rows, loading, error: loadError }, dispatchLoad] = React.useReducer(
    creativeHistoryLoadReducer,
    { rows: null, loading: false, error: false },
  );
  const [filter, setFilter] = React.useState<CreativeHistoryFilter>('all');
  const [pinningTaskId, setPinningTaskId] = React.useState<string | null>(null);
  const mountedRef = React.useRef(true);
  const loadRequestRef = React.useRef(0);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadHistory = React.useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    dispatchLoad({ type: 'start' });
    try {
      const res = await trpc.tasks.list.query({ limit: 30 });
      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      const mapper = mode === 'image' ? toImageRow : toVideoRow;
      const list = (res?.tasks ?? []).map(mapper).filter((v): v is VideoRow => v != null);
      dispatchLoad({ type: 'success', rows: list });
    } catch {
      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      dispatchLoad({ type: 'failure' });
    }
  }, [mode]);

  React.useEffect(() => {
    dispatchLoad({ type: 'reset' });
  }, [mode]);

  React.useEffect(() => {
    void loadHistory();
  }, [loadHistory, refreshKey]);

  const visible = React.useMemo(() => {
    if (!rows) return rows;
    return filterCreativeHistoryRows(rows, { mode, videoType, filter });
  }, [filter, mode, rows, videoType]);

  const emptyCopy =
    filter === 'pinned'
      ? `暂无置顶${mode === 'image' ? '图片' : '视频'}作品。`
      : filter === 'recent'
        ? `最近 7 天暂无${mode === 'image' ? '图片' : '视频'}作品。`
        : `暂无${mode === 'image' ? '图片' : '视频'}作品，先在上方创建一个。`;

  const handleTogglePin = React.useCallback(
    async (row: VideoRow) => {
      if (pinningTaskId) return;
      const next = row.starred !== true;
      setPinningTaskId(row.taskId);
      dispatchLoad({
        type: 'update_pin',
        taskId: row.taskId,
        starred: next,
        starredAt: next ? new Date() : null,
      });
      try {
        await togglePin(row.taskId, next);
        toast.show(next ? '已置顶作品' : '已取消置顶', 'info', 1800);
      } catch {
        if (mountedRef.current) {
          dispatchLoad({
            type: 'update_pin',
            taskId: row.taskId,
            starred: row.starred === true,
            starredAt: row.starredAt ?? null,
          });
          toast.show('置顶状态更新失败，请重试', 'error');
        }
      } finally {
        if (mountedRef.current) setPinningTaskId(null);
      }
    },
    [pinningTaskId, toast, togglePin],
  );

  return (
    <section className="relative z-10 mt-10 rounded-[28px] border border-[#EFEFEF] bg-white p-5 shadow-[0_16px_40px_rgba(17,24,39,0.04)]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-[15px] font-semibold text-[#111827]">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
          历史生成
        </div>
        <div className="flex gap-5 text-[14px] font-semibold">
          {[
            { id: 'all' as const, label: '全部' },
            { id: 'recent' as const, label: '最近' },
            { id: 'pinned' as const, label: '置顶' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={cn('pb-2 text-[#ADADAD] transition-colors hover:text-[#595757]', filter === tab.id && 'border-b-2')}
              style={filter === tab.id ? { color: accent, borderColor: accent } : undefined}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {loadError && rows !== null ? (
        <div
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#F6D3DD] bg-[#FFF7F9] px-4 py-3 text-[13px] text-[#595757]"
          role="status"
        >
          <span className="inline-flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-[#EA1F59]" aria-hidden />
            未能同步最新作品，当前展示上次已加载的内容。
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void loadHistory()}
            disabled={loading}
            className="h-8 border-[#F1B8C8] bg-white text-[#595757] hover:bg-white hover:text-[#EA1F59]"
          >
            {loading ? '重试中…' : '重新加载'}
          </Button>
        </div>
      ) : null}
      {visible === null ? (
        loadError ? (
          <div
            className="flex min-h-[260px] flex-col items-center justify-center rounded-[24px] border border-dashed border-[#DCDDDD] bg-white p-8 text-center"
            role="alert"
          >
            <AlertCircle className="h-7 w-7 text-[#EA1F59]" aria-hidden />
            <div className="mt-3 text-[14px] font-semibold text-[#111827]">历史生成暂时无法加载</div>
            <div className="mt-1 text-[13px] text-muted-foreground">请检查网络后重试，加载失败不会删除已有作品。</div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void loadHistory()}
              disabled={loading}
              className="mt-4 border-[#DCDDDD] bg-white text-[#595757] hover:bg-white hover:text-[#EA1F59]"
            >
              {loading ? '重试中…' : '重新加载'}
            </Button>
          </div>
        ) : (
          <div className="flex min-h-[260px] items-center justify-center gap-2 rounded-[24px] border border-dashed border-[#DCDDDD] bg-white p-8 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            历史加载中…
          </div>
        )
      ) : visible.length === 0 ? (
        <div className="flex min-h-[260px] items-center justify-center rounded-[24px] border border-dashed border-[#DCDDDD] bg-white p-10 text-center text-[13px] text-muted-foreground">
          {emptyCopy}
        </div>
      ) : (
        <div className="space-y-5">
          {visible.slice(0, 4).map((row) => {
            const download = row.download;
            if (!download) return null;
            const displayTitle = creativeHistoryDisplayTitle(row, mode);
            return (
            <article
              key={row.taskId}
              className="grid gap-5 rounded-[26px] bg-white p-4 shadow-[0_16px_40px_rgba(89,87,87,0.06)] md:grid-cols-[minmax(260px,520px)_1fr]"
            >
              <button
                type="button"
                onClick={() => navigate(`/${mode}?task=${encodeURIComponent(row.taskId)}`)}
                className={cn('relative min-h-[210px] overflow-hidden rounded-[22px] text-left', softBg)}
              >
                {row.posterUrl ? (
                  <LazyPosterImg
                    posterUrl={row.posterUrl}
                    alt={displayTitle}
                    className="h-full w-full rounded-[22px] object-cover"
                  />
                ) : (
                  <div className="flex h-full min-h-[210px] items-center justify-center text-[#ADADAD]">
                    {mode === 'image' ? <ImagePlus className="h-10 w-10" /> : <Clapperboard className="h-10 w-10" />}
                  </div>
                )}
              </button>
              <div className="flex min-w-0 flex-col justify-between py-3 pr-3">
                <div>
                  <div className="mb-5 flex items-center justify-end gap-2">
                    <span className="text-[13px] font-semibold text-[#ADADAD]">
                      {formatDateOnly(row.createdAt)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleTogglePin(row)}
                      disabled={pinningTaskId !== null}
                      aria-pressed={row.starred === true}
                      aria-label={row.starred ? '取消置顶作品' : '置顶作品'}
                      title={row.starred ? '取消置顶作品' : '置顶作品'}
                      className={cn(
                        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border transition-colors focus-visible:outline-none focus-visible:ring-2',
                        row.starred
                          ? 'border-[#EA1F59]/30 bg-[#EA1F59]/10 text-[#EA1F59] focus-visible:ring-[#EA1F59]/20'
                          : 'border-[#DCDDDD] bg-white text-[#ADADAD] hover:border-[#EA1F59]/30 hover:text-[#EA1F59] focus-visible:ring-[#EA1F59]/20',
                      )}
                    >
                      {pinningTaskId === row.taskId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Pin className={cn('h-3.5 w-3.5', row.starred && 'fill-current')} />
                      )}
                    </button>
                  </div>
                  <h2 className="line-clamp-3 text-[15px] font-semibold leading-7 text-[#8B93A6]">
                    {displayTitle}
                  </h2>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {row.status === 'partial_success' ? (
                      <span className="rounded-full bg-[#FFC910]/20 px-3 py-1 text-[11px] font-medium text-[#8A6A00]">
                        {videoTaskStatusLabel(row.status)}
                      </span>
                    ) : null}
                    {mode === 'video' && row.videoType ? (
                      <span className="rounded-full bg-[#EA1F59]/10 px-3 py-1 text-[11px] font-medium text-[#595757]">
                        {videoTypeLabel(row.videoType)}
                      </span>
                    ) : null}
                    {mode === 'image' && isLockedSubjectImageIntent(row.intent) ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#42C0EF]/10 px-3 py-1 text-[11px] font-medium text-[#237B9D]">
                        <Lock className="h-3 w-3" />
                        锁定主角
                      </span>
                    ) : null}
                    {download.filename ? (
                      <span className="rounded-full px-3 py-1 text-[11px] font-medium text-[#595757]" style={{ backgroundColor: `${accent}1A` }}>
                        {fileKindLabel(download.filename)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="mt-5">
                  <FileDownloadCard payload={download} />
                </div>
              </div>
            </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CurrentVideoTaskPanel({
  taskId,
  task,
  preferredConfirm = 'video',
}: {
  taskId: string;
  task: UiTask | null;
  preferredConfirm?: 'video' | 'image';
}): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const refreshTasks = useTaskStore((s) => s.refreshTasks);
  const progress = useTaskStore((s) => s.progressByTask[taskId]);
  const subStatus = useTaskStore((s) => s.subStatusByTask[taskId]?.subStatus);
  const streamingText = useTaskStore((s) => s.streamingByTask[taskId]);
  const awaiting = useTaskStore((s) => s.awaitingUserByTask[taskId]);
  const steps = useTaskStore(selectStepsFor(taskId));
  const abortTask = useTaskStore((s) => s.abortTask);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const latestStep = steps[steps.length - 1];
  const liveText = currentMediaTaskText({
    status: task?.status ?? 'unknown',
    awaitingQuestion: awaiting?.question,
    liveSubStatusText: videoSubStatusCopy(subStatus),
    progress,
    streamingText,
    latestStepSummary: latestStep?.actionSummary,
    resultText: task?.resultText,
  });

  async function confirmVideo(choice: 'confirm_video' | 'confirm_image' | 'cancel'): Promise<void> {
    if (confirming) return;
    setConfirming(choice);
    try {
      const result = await trpc.tasks.confirmVideo.mutate({ taskId, choice });
      await refreshTasks().catch(() => undefined);
      if (choice === 'cancel') {
        toast.show('已取消，未产生费用', 'info', 2000);
      } else {
        toast.show('已确认，开始制作', 'info', 2000);
        navigate(`/video?task=${encodeURIComponent(result.taskId)}`);
      }
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '操作失败，请重试', 'error');
    } finally {
      setConfirming(null);
    }
  }

  async function cancelTask(): Promise<void> {
    if (confirming) return;
    setConfirming('abort');
    try {
      const res = await abortTask(taskId);
      if ('error' in res) {
        toast.show(res.error, 'error');
      } else {
        toast.show('已取消任务', 'info', 2000);
      }
      await refreshTasks().catch(() => undefined);
    } finally {
      setConfirming(null);
    }
  }

  // A2 retry — re-open the form to re-submit. NOTE: a failed 成片 task does NOT
  // persist its original videoOptions (model/style/aspect) or the pet photo
  // fileId, so a one-click "same-params re-burn" isn't reconstructable from the
  // task alone. We send the user back to the form (cleared ?task=) where the
  // 报价卡→确认制作 flow is the inherent spend confirmation (防误点).
  function retryFailed(): void {
    navigate('/video');
  }

  return (
    <Section
      title="当前制作"
      description="报价确认、制作进度和最终文件都留在本页，不需要跳回任务界面。"
      className="mb-6 rounded-[22px] border-[#EFEFEF] bg-white shadow-[0_14px_34px_rgba(17,24,39,0.04)]"
    >
      {!task ? (
        <div className="flex items-center gap-2 py-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在同步视频任务…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <VideoStatusIcon status={task.status} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium text-foreground">
                  {task.title?.trim() || task.intent || '视频任务'}
                </span>
                <span className="rounded-full border border-[#DCDDDD] bg-white px-2 py-0.5 text-[11px] text-muted-foreground">
                  {videoTaskStatusLabel(task.status)}
                </span>
              </div>
              {liveText && (
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[#595757]">
                  {liveText}
                </p>
              )}
              {/* A1 — IP 换口型慢，给等待预期（仅 ip_person 生成中）。 */}
              {task.videoType === 'ip_person' && isVideoTaskRunning(task.status) && (
                <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-[#8A6A00]">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {ipRenderingHint(task.intent)}
                </p>
              )}
            </div>
          </div>

          {task.status === 'awaiting_user' && task.awaitingKind === 'video_quote' && (
            <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[#FFC910]/55 bg-white px-3 py-3 text-[12px]">
              <span className="mr-auto text-muted-foreground">确认后才会开始制作并消耗额度。</span>
              <Button
                type="button"
                size="sm"
                onClick={() => void confirmVideo(preferredConfirm === 'image' ? 'confirm_image' : 'confirm_video')}
                disabled={confirming !== null}
              >
                {confirming === 'confirm_video' || confirming === 'confirm_image'
                  ? '提交中…'
                  : preferredConfirm === 'image'
                    ? '确认生成图片'
                    : '确认制作'}
              </Button>
              {/* B2 — 真人换口型没法降级成静图，ip_person 不出「图片版」。 */}
              {preferredConfirm !== 'image' && showImageOption(task.videoType) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void confirmVideo('confirm_image')}
                  disabled={confirming !== null}
                >
                  {confirming === 'confirm_image' ? '提交中…' : '图片版'}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void confirmVideo('cancel')}
                disabled={confirming !== null}
              >
                {confirming === 'cancel' ? '取消中…' : '取消'}
              </Button>
            </div>
          )}

          {(isVideoTaskRunning(task.status) || task.status === 'awaiting_user') &&
            task.awaitingKind !== 'video_quote' && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void cancelTask()}
                  disabled={confirming !== null}
                >
                  {confirming === 'abort' ? '取消中…' : '取消任务'}
                </Button>
              </div>
            )}

          {/* A2 — 失败态：透传后端白名单友好 reason（在 task.resultText 里）+ 重试入口。 */}
          {task.status === 'failed' && (
            <div className="rounded-[8px] border border-[#EA1F59]/30 bg-[#EA1F59]/5 px-3 py-3 text-[12px]">
              <div className="text-[13px] font-medium text-[#EA1F59]">生成失败</div>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed text-[#595757]">
                {task.resultText?.trim() || '生成失败，请重试。'}
              </p>
              <div className="mt-2.5">
                <Button type="button" variant="outline" size="sm" onClick={() => retryFailed()}>
                  重新制作
                </Button>
              </div>
            </div>
          )}

          {task.attachments && task.attachments.length > 0 && (
            <div className="space-y-2 border-t border-[#DCDDDD]/70 pt-3">
              <div className="text-[11px] font-medium text-muted-foreground">产出文件</div>
              {task.attachments.map((attachment) => (
                <FileDownloadCard
                  key={attachment.fileId}
                  payload={{
                    fileId: attachment.fileId,
                    filename: attachment.filename,
                    size: attachment.sizeBytes,
                    downloadUrl: attachment.downloadUrl,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function videoSubStatusCopy(subStatus: string | undefined): string {
  switch (subStatus) {
    case 'queued':
      return '已进入制作队列。';
    case 'generating':
      return '正在生成视频…';
    case 'verifying':
      return '正在整理结果…';
    case 'awaiting_user':
      return '等待你确认下一步。';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// 普通视频表单
// ---------------------------------------------------------------------------

const MODEL_OPTIONS: ReadonlyArray<{ value: NormalVideoModel; label: string; hint?: string }> = [
  { value: 'veo_fast', label: 'Veo 3 Fast', hint: '推荐 · 性价比' },
  { value: 'happyhorse', label: 'Happy Horse 1.1', hint: '自带音效' },
  { value: 'veo_standard', label: 'Veo 3 Quality', hint: '高质量' },
];
const STYLE_OPTIONS: ReadonlyArray<{ value: VideoStyleOption; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'realistic', label: '写实' },
  { value: 'atmospheric', label: '氛围感' },
  { value: 'science', label: '科普清晰' },
];
const ASPECT_OPTIONS: ReadonlyArray<{ value: VideoAspect; label: string }> = [
  { value: '9:16', label: '竖屏 9:16' },
  { value: '3:4', label: '竖屏 3:4' },
  { value: '16:9', label: '横屏 16:9' },
  { value: '4:3', label: '横屏 4:3' },
  { value: '1:1', label: '方形 1:1' },
];
const RES_OPTIONS: ReadonlyArray<{ value: VideoResolution; label: string }> = [
  { value: '1080p', label: '1080P 高清' },
  { value: '720p', label: '720P 标清' },
];
const DURATION_OPTIONS: ReadonlyArray<{ value: VideoDuration; label: string }> = [
  { value: 8, label: '8 秒/段' },
  { value: 6, label: '6 秒/段' },
];

/** 估算段数(真实段数由后端 optimize 决定,这里仅用于价格预览). */
const SEG_ESTIMATE = 5;
const NB_USD_PER_IMG = 0.067;
const USD_TO_CNY = 7.3;

export function NormalVideoForm({ onTaskCreated }: { onTaskCreated: (taskId: string) => void }): JSX.Element {
  const toast = useToast();
  const createTask = useTaskStore((s) => s.createTask);

  const [prompt, setPrompt] = React.useState('');
  const [model, setModel] = React.useState<NormalVideoModel>('veo_fast');
  const [style, setStyle] = React.useState<VideoStyleOption>('auto');
  const [aspectRatio, setAspectRatio] = React.useState<VideoAspect>('9:16');
  const [resolution, setResolution] = React.useState<VideoResolution>('1080p');
  const [durationSeconds, setDurationSeconds] = React.useState<VideoDuration>(8);
  const [submitting, setSubmitting] = React.useState(false);

  const perSegCny = estimatePerSegmentCny({ model, resolution, durationSeconds });
  const estVideoCny = perSegCny * SEG_ESTIMATE;
  const estImageCny = Math.ceil(SEG_ESTIMATE * NB_USD_PER_IMG * USD_TO_CNY);

  async function handleSubmit(): Promise<void> {
    const intent = prompt.trim();
    if (intent.length < 4) {
      toast.show('请先写一段文案或想法(至少 4 个字)', 'error');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    const opts: VideoCreationOptions = { tab: 'normal', model, style, aspectRatio, resolution, durationSeconds };
    try {
      const res = await createTask(intent, undefined, undefined, undefined, undefined, undefined, opts);
      if ('error' in res) {
        toast.show(res.error || '提交失败,请重试', 'error');
        return;
      }
      toast.show('已提交,请在本页确认报价后开始制作', 'info', 3500);
      onTaskCreated(res.taskId);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '提交失败,请重试', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section title="文案" description="写你想讲的内容,AI 会忠于原意优化、配画面与配音。">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例如:夏天紫外线很强,出门前 20 分钟涂够量,每两小时补涂一次……"
          rows={5}
          className="resize-y"
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          仅编排你本人的内容,不模仿/冒充他人。最终成片带 HOLA DAY 水印。
        </p>
      </Section>

      <Section title="参数">
        <div className="space-y-5">
          <SegGroup label="模型" value={model} options={MODEL_OPTIONS} onChange={setModel} />
          <SegGroup label="风格" value={style} options={STYLE_OPTIONS} onChange={setStyle} />
          <SegGroup label="尺寸" value={aspectRatio} options={ASPECT_OPTIONS} onChange={setAspectRatio} />
          <SegGroup label="画质" value={resolution} options={RES_OPTIONS} onChange={setResolution} />
          <SegGroup label="时长" value={durationSeconds} options={DURATION_OPTIONS} onChange={setDurationSeconds} />
        </div>
      </Section>

      <Section title="价格预览" className={CREATIVE_PRICE_SECTION_CLASS}>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <span className="text-2xl font-semibold text-[#EA1F59]">约 ¥{estVideoCny}</span>
            <span className="ml-2 text-[13px] text-muted-foreground">
              视频版 · 每段约 ¥{perSegCny} × {SEG_ESTIMATE} 段(估算)
            </span>
          </div>
          <div className="text-[13px] text-muted-foreground">
            图片版约 ¥{estImageCny}(静态图,更省)
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          按 {SEG_ESTIMATE} 段估算,实际段数由 AI 拆分文案决定;
          <span className="font-medium text-[#595757]"> 提交后会先给精确报价,确认后才扣费。</span>
        </p>
      </Section>

      <div className="flex items-center justify-end gap-3">
        <span className="text-[12px] text-muted-foreground">提交后先报价,不会立即扣费</span>
        <Button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="min-w-[120px]">
          {submitting ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              提交中…
            </>
          ) : (
            <>
              <Sparkles className="mr-1.5 h-4 w-4" />
              生成视频
            </>
          )}
        </Button>
      </div>

      <VideoHistory videoType="normal" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 宠物视频 i2v 表单 (Phase 2 第二期)
// ---------------------------------------------------------------------------

export function PetVideoForm({
  onTaskCreated,
  model,
}: {
  onTaskCreated: (taskId: string) => void;
  model: VideoModel;
}): JSX.Element {
  const toast = useToast();
  const createTask = useTaskStore((s) => s.createTask);

  const [prompt, setPrompt] = React.useState('');
  const [photo, setPhoto] = React.useState<{ fileId: string; name: string; previewUrl: string } | null>(null);
  const [referenceVideo, setReferenceVideo] = React.useState<{
    fileId: string;
    name: string;
    previewUrl: string;
    durationSeconds?: number;
  } | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = React.useState(false);
  const [uploadingVideo, setUploadingVideo] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const photoRef = React.useRef<HTMLInputElement>(null);
  const videoRef = React.useRef<HTMLInputElement>(null);

  const cloneMode = cloneModeFromVideoModel(model);
  const selectedCloneModel = modelOptionFor(model, CLONE_MODEL_OPTIONS);
  const estCny =
    cloneMode && referenceVideo?.durationSeconds
      ? estimateCloneCny({ mode: cloneMode, durationSeconds: referenceVideo.durationSeconds })
      : null;

  React.useEffect(() => {
    const url = photo?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo?.previewUrl]);

  React.useEffect(() => {
    const url = referenceVideo?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [referenceVideo?.previewUrl]);

  async function handlePickPhoto(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      toast.show('请上传 JPG / PNG / WebP 图片', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.show('主角照片不能超过 5 MB', 'error');
      return;
    }
    setUploadingPhoto(true);
    try {
      const res = await uploadFile(file);
      setPhoto((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return { fileId: res.fileId, name: res.filename, previewUrl: URL.createObjectURL(file) };
      });
    } catch (err) {
      toast.show(uploadFailureMessage(err), 'error');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handlePickReferenceVideo(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isCreativeReferenceVideo(file)) {
      toast.show('请上传 MP4 / MOV 参考视频', 'error');
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      toast.show('参考视频不能超过 200 MB', 'error');
      return;
    }
    setUploadingVideo(true);
    try {
      const res = await uploadMediaFile(file);
      setReferenceVideo((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return { fileId: res.fileId, name: res.filename, previewUrl: URL.createObjectURL(file) };
      });
    } catch (err) {
      toast.show(uploadFailureMessage(err), 'error');
    } finally {
      setUploadingVideo(false);
    }
  }

  function removePhoto(): void {
    setPhoto((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }

  function removeReferenceVideo(): void {
    setReferenceVideo((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }

  async function handleSubmit(): Promise<void> {
    if (!photo) {
      toast.show('请先上传主角照片', 'error');
      return;
    }
    if (!referenceVideo) {
      toast.show('请先上传想要复刻的参考视频', 'error');
      return;
    }
    if (!cloneMode) {
      toast.show('请选择 Wan Animate 2.2 Standard 或 Pro', 'error');
      return;
    }
    const referenceDuration = referenceVideo.durationSeconds;
    if (!referenceDuration || referenceDuration < 2 || referenceDuration > 30) {
      toast.show('参考视频必须为 2-30 秒，请更换后重试', 'error');
      return;
    }
    const intent = prompt.trim();
    if (submitting) return;
    setSubmitting(true);
    const finalIntent = buildCloneVideoIntent(intent);
    const opts: VideoCreationOptions = {
      tab: 'pet',
      petImageFileId: photo.fileId,
      referenceVideoFileId: referenceVideo.fileId,
      referenceVideoDurationSeconds: referenceDuration,
      cloneMode,
    };
    try {
      const res = await createTask(finalIntent, undefined, undefined, undefined, undefined, undefined, opts);
      if ('error' in res) {
        toast.show(res.error || '提交失败,请重试', 'error');
        return;
      }
      toast.show('已提交,请在本页确认报价后开始制作', 'info', 3500);
      onTaskCreated(res.taskId);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '提交失败,请重试', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section
        title="主角照片"
        description="上传要替换进视频的主角照片，可以是宠物、人物或产品主体。"
        className={CREATIVE_SECTION_CLASS}
      >
        <input
          ref={photoRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => void handlePickPhoto(e)}
        />
        {photo ? (
          <div className="flex items-center gap-4">
            <img
              src={photo.previewUrl}
              alt="主角照片预览"
              className="h-24 w-24 rounded-[18px] border border-[#DCDDDD] object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-foreground">{photo.name}</div>
              <div className="mt-1 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => photoRef.current?.click()} disabled={uploadingPhoto}>
                  {uploadingPhoto ? '上传中…' : '换一张'}
                </Button>
                <button
                  type="button"
                  onClick={removePhoto}
                  className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground hover:text-[#EA1F59]"
                >
                  <X className="h-3.5 w-3.5" />
                  移除
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => photoRef.current?.click()}
            disabled={uploadingPhoto}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-[#DCDDDD] bg-white py-10 text-muted-foreground transition-colors hover:border-[#EA1F59]/40 hover:text-[#EA1F59] disabled:opacity-60"
          >
            {uploadingPhoto ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
            <span className="text-[13px]">{uploadingPhoto ? '上传中…' : '点击上传主角照片'}</span>
            <span className="text-[11px] text-muted-foreground">JPG / PNG / WebP</span>
          </button>
        )}
      </Section>

      <Section
        title="参考视频"
        description="上传想要复刻的视频，HOLA DAY 会把它作为动作、镜头和节奏参考。"
        className={CREATIVE_SECTION_CLASS}
      >
        <input
          ref={videoRef}
          type="file"
          accept={CREATIVE_ACCEPT_REFERENCE_VIDEO}
          className="hidden"
          onChange={(e) => void handlePickReferenceVideo(e)}
        />
        {referenceVideo ? (
          <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <video
              src={referenceVideo.previewUrl}
              className="h-[124px] w-full rounded-[18px] border border-[#DCDDDD] bg-black object-cover"
              controls
              muted
              playsInline
              onLoadedMetadata={(event) => {
                const duration = event.currentTarget.duration;
                setReferenceVideo((current) =>
                  current && Number.isFinite(duration) ? { ...current, durationSeconds: duration } : current,
                );
              }}
            />
            <div className="flex min-w-0 flex-col justify-center">
              <div className="truncate text-[13px] font-medium text-foreground">{referenceVideo.name}</div>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                保留它的动作、镜头、节奏、时长和音频；只替换为上方主角。
              </p>
              <div className="mt-1 text-[11px] text-[#8B93A6]">
                {referenceVideo.durationSeconds
                  ? `${referenceVideo.durationSeconds.toFixed(1)} 秒 · 支持 2-30 秒`
                  : '正在读取视频时长…'}
              </div>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => videoRef.current?.click()} disabled={uploadingVideo}>
                  {uploadingVideo ? '上传中…' : '换一个视频'}
                </Button>
                <button
                  type="button"
                  onClick={removeReferenceVideo}
                  className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground hover:text-[#EA1F59]"
                >
                  <X className="h-3.5 w-3.5" />
                  移除
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => videoRef.current?.click()}
            disabled={uploadingVideo}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-[#DCDDDD] bg-white py-10 text-muted-foreground transition-colors hover:border-[#EA1F59]/40 hover:text-[#EA1F59] disabled:opacity-60"
          >
            {uploadingVideo ? <Loader2 className="h-6 w-6 animate-spin" /> : <VideoIcon className="h-6 w-6" />}
            <span className="text-[13px]">{uploadingVideo ? '上传中…' : '点击上传参考视频'}</span>
            <span className="text-[11px] text-muted-foreground">MP4 / MOV · 2-30 秒 · 不超过 200 MB</span>
          </button>
        )}
      </Section>

      <Section title="任务备注（可选）" description="备注仅用于任务记录，不会改变参考视频的动作、镜头、节奏或音频。" className={CREATIVE_SECTION_CLASS}>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例如：用于周五新品发布，成片后发给设计组。"
          rows={3}
          className="min-h-[128px] resize-y rounded-[18px] border-[#EFEFEF] bg-white text-[15px] leading-7"
        />
      </Section>

      <Section title="价格预览" className={CREATIVE_PRICE_SECTION_CLASS}>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <span className="text-2xl font-semibold text-[#EA1F59]">
            {estCny === null ? '上传视频后估价' : `约 ¥${estCny}`}
          </span>
          <span className="text-[13px] text-muted-foreground">
            {selectedCloneModel.name} {selectedCloneModel.version}
            {referenceVideo?.durationSeconds ? ` · 参考视频 ${referenceVideo.durationSeconds.toFixed(1)} 秒` : ''}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          按参考视频时长预估；供应商仅对成功输出的实际秒数计费，失败不计费。
          <span className="font-medium text-[#595757]"> 确认报价后才开始生成。</span>
        </p>
      </Section>

      <div className="flex items-center justify-end gap-3">
        <span className="text-[12px] text-muted-foreground">提交后先报价,不会立即扣费</span>
        <Button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="min-w-[120px]">
          {submitting ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              提交中…
            </>
          ) : (
            <>
              <VideoIcon className="mr-1.5 h-4 w-4" />
              生成视频
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/** 通用分段单选控件(标签 + 一排按钮). */
function SegGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="w-12 shrink-0 text-[13px] font-semibold text-[#8B93A6]">{label}</div>
      <div className="flex flex-wrap gap-1 rounded-[10px] bg-[#EFEFEF]/70 p-1">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className={cn(
                'inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] border border-transparent px-3 text-[13px] font-semibold transition-colors',
                active
                  ? 'bg-white text-[#EA1F59] shadow-[0_1px_4px_rgba(15,23,42,0.08)]'
                  : 'text-[#111827] hover:bg-white/60 hover:text-[#EA1F59]',
              )}
            >
              {o.label}
              {o.hint && (
                <span
                  className={cn(
                    'text-[11px]',
                    active ? 'text-[#EA1F59]/70' : 'text-muted-foreground',
                  )}
                >
                  {o.hint}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 生成历史
// ---------------------------------------------------------------------------

// VideoResultMeta / VideoRow / isVideoLane / toVideoRow moved to
// '@/lib/video-history-row' so the "only successful 成片" filter is
// unit-testable. toVideoRow drops failed / cancelled / awaiting
// (报价 stub) / executing rows, but keeps downloadable partial-success output.

function VideoHistory({ videoType }: { videoType: VideoType }): JSX.Element {
  return (
    <CreativeHistory
      mode="video"
      accent="#EA1F59"
      softBg="bg-[#EA1F59]/10"
      videoType={videoType}
    />
  );
}

/** Render-only type chip (A5). Legacy 成片 (no videoType) → 「视频」. */
function videoTypeLabel(videoType: VideoType | undefined): string {
  switch (videoType) {
    case 'ip_person':
      return 'IP人物视频';
    case 'pet':
      return '复刻视频';
    case 'normal':
      return '文本视频';
    default:
      return '视频';
  }
}

function VideoStatusIcon({ status }: { status: string }): JSX.Element {
  const base = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border';
  const iconKind = videoTaskStatusIconKind(status);
  if (iconKind === 'attention') {
    return (
      <span className={cn(base, 'border-[#FFC910]/55 bg-[#FFC910]/15 text-[#8A6A00]')}>
        <AlertCircle className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (iconKind === 'failed') {
    return (
      <span className={cn(base, 'border-[#EA1F59]/45 bg-[#EA1F59]/10 text-[#EA1F59]')}>
        <XCircle className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (iconKind === 'inactive') {
    return (
      <span className={cn(base, 'border-[#DCDDDD] bg-[#EFEFEF]/45 text-muted-foreground')}>
        <CircleSlash className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (iconKind === 'success') {
    return (
      <span className={cn(base, 'border-[#DCDDDD] bg-white text-[#EA1F59]')}>
        <CheckCircle2 className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span className={cn(base, 'border-[#DCDDDD] bg-white text-[#595757]')}>
      <Clock className="h-3.5 w-3.5" />
    </span>
  );
}

function formatDateOnly(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function fileKindLabel(filename: string): string {
  const match = filename.match(/\.([a-z0-9]+)$/i);
  if (!match) return '产物文件';
  return `${match[1].toUpperCase()} 文件`;
}

// ---------------------------------------------------------------------------
// IP人物视频 — 素材准备向导 (Phase 2 第三期 阶段2)
// 两个必要前提:本人声音(克隆) + 本人出镜底版。授权声明放在生成前确认。
// ---------------------------------------------------------------------------

interface OnboardingStatus {
  hasVoice: boolean;
  hasBaseVideo: boolean;
  authorized: boolean;
}

export function IpOnboardingWizard({
  onTaskCreated,
  aspectRatio,
}: {
  onTaskCreated: (taskId: string) => void;
  aspectRatio: VideoAspect;
}): JSX.Element {
  const toast = useToast();
  const [status, setStatus] = React.useState<OnboardingStatus | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [uploadingVoice, setUploadingVoice] = React.useState(false);
  const [uploadingVideo, setUploadingVideo] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const voiceRef = React.useRef<HTMLInputElement>(null);
  const videoRef = React.useRef<HTMLInputElement>(null);
  const mountedRef = React.useRef(true);

  const load = React.useCallback(async () => {
    setLoadError(false);
    try {
      const s = await trpc.videoOnboarding.status.query();
      if (!mountedRef.current) return;
      setStatus({ hasVoice: s.hasVoice, hasBaseVideo: s.hasBaseVideo, authorized: s.authorized });
    } catch {
      if (!mountedRef.current) return;
      setLoadError(true);
      setStatus({ hasVoice: false, hasBaseVideo: false, authorized: false });
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  async function handleVoice(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(wav|mp3|m4a)$/i.test(file.name) && !/^audio\/(wav|mpeg|mp4|x-m4a)$/i.test(file.type)) {
      toast.show('声音样本请用 WAV / MP3 / M4A', 'error');
      return;
    }
    setUploadingVoice(true);
    try {
      const up = await uploadMediaFile(file);
      await trpc.videoOnboarding.enrollVoice.mutate({ audioFileId: up.fileId });
      await load();
      toast.show('声音已就绪', 'info', 2000);
    } catch (err) {
      toast.show(uploadFailureMessage(err), 'error');
    } finally {
      setUploadingVoice(false);
    }
  }

  async function handleVideo(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(mp4|mov)$/i.test(file.name) && !/^video\/(mp4|quicktime)$/i.test(file.type)) {
      toast.show('出镜底版请用 MP4 / MOV', 'error');
      return;
    }
    setUploadingVideo(true);
    try {
      const up = await uploadMediaFile(file);
      await trpc.videoOnboarding.setBaseVideo.mutate({ videoFileId: up.fileId });
      await load();
      toast.show('底版已就绪', 'info', 2000);
    } catch (err) {
      toast.show(uploadFailureMessage(err), 'error');
    } finally {
      setUploadingVideo(false);
    }
  }

  async function handleClear(): Promise<void> {
    if (clearing) return;
    setClearing(true);
    try {
      await trpc.videoOnboarding.deleteAssets.mutate();
      await load();
      toast.show('已清除全部 IP 素材', 'info', 2000);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '清除失败,请重试', 'error');
    } finally {
      setClearing(false);
    }
  }

  if (status === null) {
    return (
      <Section className={CREATIVE_SECTION_CLASS}>
        {loadError ? (
          <div className="flex flex-col items-start gap-2 py-4 text-[13px] text-muted-foreground">
            <span>加载失败,请稍后重试</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              重试
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        )}
      </Section>
    );
  }

  const ready = status.hasVoice && status.hasBaseVideo;
  const anyAsset = status.authorized || status.hasVoice || status.hasBaseVideo;

  return (
    <div className="space-y-6">
      <input ref={voiceRef} type="file" accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4" className="hidden" onChange={(e) => void handleVoice(e)} />
      <input ref={videoRef} type="file" accept=".mp4,.mov,video/mp4,video/quicktime" className="hidden" onChange={(e) => void handleVideo(e)} />

      <Section
        title="IP人物视频素材准备"
        description="生成前需要先准备本人声音和出镜底版；授权确认会放在生成视频前。"
        className={CREATIVE_SECTION_CLASS}
      >
        <div className="space-y-4">
          {loadError ? (
            <div className="rounded-[16px] border border-[#FED7AA] bg-[#FFF7ED] px-4 py-3 text-[12px] leading-relaxed text-[#9A3412]">
              <div className="font-semibold text-[#7C2D12]">素材状态同步失败</div>
              <p className="mt-1">
                暂时没有拿到已上传素材状态。你可以先重试同步；若继续失败，请稍后再上传声音和出镜视频。
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void load()}
                className="mt-3 h-8 border-[#FDBA74] bg-white text-[#9A3412] hover:bg-[#FFEDD5]"
              >
                重试同步
              </Button>
            </div>
          ) : null}
          {/* Step 1 — 声音 */}
          <WizardStep
            index={1}
            done={status.hasVoice}
            icon={Mic}
            title="本人声音(克隆)"
            locked={false}
          >
            <div className="space-y-2">
              {status.hasVoice ? (
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                  <span>声音已就绪 ✓</span>
                  <Button variant="outline" size="sm" onClick={() => voiceRef.current?.click()} disabled={uploadingVoice}>
                    {uploadingVoice ? '上传中…' : '重新上传'}
                  </Button>
                </div>
              ) : (
                <Button type="button" size="sm" onClick={() => voiceRef.current?.click()} disabled={uploadingVoice}>
                  {uploadingVoice ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      上传并克隆…
                    </>
                  ) : (
                    '上传声音样本'
                  )}
                </Button>
              )}
              <p className="text-[11px] text-muted-foreground">
                WAV / MP3 / M4A,10-20 秒清晰人声(安静环境、连续说话);用完即弃,只保留声纹。
              </p>
            </div>
          </WizardStep>

          {/* Step 2 — 底版 */}
          <WizardStep
            index={2}
            done={status.hasBaseVideo}
            icon={VideoIcon}
            title="本人出镜底版"
            locked={false}
          >
            <div className="space-y-2">
              {status.hasBaseVideo ? (
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                  <span>底版已就绪 ✓</span>
                  <Button variant="outline" size="sm" onClick={() => videoRef.current?.click()} disabled={uploadingVideo}>
                    {uploadingVideo ? '上传中…' : '重新上传'}
                  </Button>
                </div>
              ) : (
                <Button type="button" size="sm" onClick={() => videoRef.current?.click()} disabled={uploadingVideo}>
                  {uploadingVideo ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      上传中…
                    </>
                  ) : (
                    '上传出镜视频'
                  )}
                </Button>
              )}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                MP4 / MOV,10-60 秒竖屏口播。<span className="font-medium text-[#595757]">为保证人物视频质量:正脸面对镜头、光线均匀打亮脸部、画面只有你一人、对焦清晰、安静环境、嘴部不被遮挡。</span>侧脸/逆光/模糊会明显变差。
              </p>
            </div>
          </WizardStep>
        </div>
      </Section>

      {/* 就绪 → 生成表单;未就绪 → 引导 */}
      {ready ? (
        <IpGenerateForm
          onTaskCreated={onTaskCreated}
          aspectRatio={aspectRatio}
        />
      ) : (
        <Section className={CREATIVE_SECTION_CLASS}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-muted-foreground">完成声音克隆和出镜底版，即可解锁「IP人物视频」生成。</span>
            <Button type="button" disabled className="min-w-[140px]">
              <Lock className="mr-1.5 h-4 w-4" />
              生成(未就绪)
            </Button>
          </div>
        </Section>
      )}

      {/* 隐私 + 清除 */}
      <Section title="隐私与素材管理" className={CREATIVE_SECTION_CLASS}>
        <ul className="mb-3 space-y-1 text-[12px] leading-relaxed text-muted-foreground">
          <li>· 声音样本在克隆出声纹后<span className="font-medium text-[#595757]">即刻删除</span>,我们只保留声纹用于合成。</li>
          <li>· 出镜底版加密存储、仅用于你本人的视频,可随时删除/重传。</li>
          <li>· 一键清除会删掉云端声纹 + 出镜底版 + 授权记录。</li>
        </ul>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleClear()}
          disabled={!anyAsset || clearing}
          className="border-[#DCDDDD] text-[#595757] hover:border-[#EA1F59]/40 hover:text-[#EA1F59]"
        >
          {clearing ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              清除中…
            </>
          ) : (
            <>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              清除全部 IP 素材
            </>
          )}
        </Button>
      </Section>
    </div>
  );
}

function IpGenerateForm({
  onTaskCreated,
  aspectRatio,
}: {
  onTaskCreated: (taskId: string) => void;
  aspectRatio: VideoAspect;
}): JSX.Element {
  const toast = useToast();
  const createTask = useTaskStore((s) => s.createTask);
  const [copy, setCopy] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  // ① 合规闸 — per-generate 授权确认。与 onboarding 的一次性 consent 双保险:
  // 每次生成都要重新勾(默认 false),不勾禁止提交。
  const [consent, setConsent] = React.useState(false);

  const est = estimateIpVideo(copy);

  async function handleSubmit(): Promise<void> {
    const intent = copy.trim();
    if (intent.length < 4) {
      toast.show('请先写一段要口播的文案(至少 4 个字)', 'error');
      return;
    }
    if (!consent) {
      toast.show('请先勾选「本人肖像、已获授权」确认', 'error');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    const finalIntent = buildIpVideoIntent(intent);
    const opts: VideoCreationOptions = {
      tab: 'ip_person',
      aspectRatio,
    };
    try {
      await trpc.videoOnboarding.authorize.mutate();
      const res = await createTask(finalIntent, undefined, undefined, undefined, undefined, undefined, opts);
      if ('error' in res) {
        toast.show(res.error || '提交失败,请重试', 'error');
        return;
      }
      toast.show('已提交,请在本页确认报价后开始制作', 'info', 3500);
      onTaskCreated(res.taskId);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '提交失败,请重试', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
    <Section
      title="生成视频"
      description="素材已就绪 —— 用你本人的声音 + 出镜底版,把文案口播出来。"
      className={CREATIVE_SECTION_CLASS}
    >
      <div className="space-y-5">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-[#EA1F59]" />
          使用你已上传的本人声音 + 出镜底版(可在上方重传/清除)。
        </div>
        <Textarea
          value={copy}
          onChange={(e) => setCopy(e.target.value)}
          placeholder="写你要口播的文案,会用你本人的声音讲出来(单条 ≤40 秒,约 160 字内)。"
          rows={4}
          className="min-h-[150px] resize-y rounded-[18px] border-[#EFEFEF] bg-white text-[15px] leading-7"
        />
        <div className="rounded-[18px] border border-[#EFEFEF] bg-white px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-xl font-semibold text-[#EA1F59]">约 ¥{est.videoCny}</span>
            <span className="text-[13px] text-muted-foreground">
              Qwen Voice + LatentSync · {aspectRatio} · 约 {est.chars} 字
            </span>
          </div>
          {est.maybeTooLong && (
            <p className="mt-1 text-[11px] text-[#B45309]">⚠️ 文案偏长,可能超过 40 秒上限;过长会被拒,请适当截短。</p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">提交后会先给精确报价,确认后才扣费。</p>
        </div>
        {/* per-generate 授权确认:用户点生成前勾选,提交时写入后端授权记录。 */}
        <div className="rounded-[16px] border border-[#EFEFEF] bg-white px-4 py-3">
          <div className="text-[13px] font-semibold text-[#111827]">本人授权声明</div>
          <label className="mt-2 flex cursor-pointer items-start gap-2 text-[12px] leading-relaxed text-foreground">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#EA1F59]"
            />
            <span>
              我承诺:口播所用的声音与出镜底版<strong>均为本人</strong>、已获授权;勾选即表示同意
              <Link to="/terms" target="_blank" className="text-[#EA1F59] underline">
                《服务条款》
              </Link>
              与
              <Link to="/privacy" target="_blank" className="text-[#EA1F59] underline">
                《隐私政策》
              </Link>
              。
            </span>
          </label>
        </div>
        <div className="flex items-center justify-end gap-3">
          <span className="text-[12px] text-muted-foreground">提交后先报价,不会立即扣费</span>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || !consent}
            className="min-w-[120px]"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                提交中…
              </>
            ) : (
              <>
                <Sparkles className="mr-1.5 h-4 w-4" />
                生成视频
              </>
            )}
          </Button>
        </div>
      </div>
    </Section>
    </div>
  );
}

function WizardStep({
  index,
  done,
  locked,
  icon: Icon,
  title,
  children,
}: {
  index: number;
  done: boolean;
  locked: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={cn('flex gap-3 rounded-[18px] border bg-white p-4', done ? 'border-[#EA1F59]/30' : 'border-[#DCDDDD]', locked && 'opacity-60')}>
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-medium',
          done ? 'bg-[#EA1F59] text-white' : 'bg-[#EFEFEF] text-[#595757]',
        )}
      >
        {done ? <Check className="h-4 w-4" /> : index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[14px] font-medium text-foreground">
          <Icon className="h-4 w-4 text-[#EA1F59]" />
          {title}
          {locked && <Lock className="h-3 w-3 text-muted-foreground" />}
        </div>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

export default VideoPage;
