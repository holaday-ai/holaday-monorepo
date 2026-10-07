import { useCreativeProject } from '@/components/CreativeProjectPicker';
import { CreativeReferenceLibrary } from '@/components/CreativeReferenceLibrary';
import { CreativePopover } from '@/components/CreativePopover';
import { CreativeInspiration } from '@/components/CreativeInspiration';
import { AttachmentChip, type DraftAttachment } from '@/components/AttachmentChip';
import { FileDownloadCard, type FileDownloadPayload } from '@/components/FileDownloadCard';
import { LazyPosterImg } from '@/components/LazyPosterImg';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { VideoCreationStoryboard } from '@/components/video/VideoCreationStoryboard';
import {
  type VideoCreationScenarioId,
  scenarioForVideoTab,
  videoCreationScenario,
  videoTabForScenario,
} from '@/components/video/video-creation-scenarios';
import {
  canContinueEditing,
  createVideoEditingProject,
} from '@/features/video-editing/video-edit-entry';
import { revokeCreativePreviewUrls } from '@/lib/creative-preview-urls';
import { createMediaActionGuard } from '@/lib/media-action-guard';
import { filterAvailableOptions, useMediaModels } from '@/lib/media-models';
import { normalizeTaskHubCursor } from '@/lib/task-hub-state';
import { trpc } from '@/lib/trpc';
import {
  isFileUnavailable,
  markFileUnavailable,
  useUnavailableFiles,
} from '@/lib/unavailable-file-registry';
import { uploadFailureMessage, uploadFile, uploadMediaFile } from '@/lib/upload-file';
import { cn } from '@/lib/utils';
import {
  type CreativeHistoryFilter,
  type VideoRow,
  type VideoType,
  canChangeCreativeHistoryFilter,
  canLoadOlderCreativeHistory,
  creativeHistoryArtifactAvailability,
  creativeHistoryCardPresentation,
  creativeHistoryDisplayTitle,
  creativeHistoryListInput,
  creativeHistoryLoadReducer,
  creativeHistoryPreviewAvailability,
  filterCreativeHistoryRows,
  nextCreativeHistoryVisibleCount,
  showImageOption,
  toVideoRow,
  videoAudioVerificationBadge,
} from '@/lib/video-history-row';
import { ipRenderingHint } from '@/lib/video-ip-estimate';
import {
  currentMediaTaskText,
  currentMediaTaskTitle,
  hydrateMissingMediaTask,
  isVideoTaskRunning,
  resolveVideoAwaitingKind,
  selectStepsFor,
  videoTabForTaskType,
  videoTaskStatusIconKind,
  videoTaskStatusLabel,
} from '@/lib/video-task-selectors';
import { PageContainer, Section } from '@/pages/PageShell';
import { useTaskStore } from '@/stores/task-store';
import type { UiTask, UiTerminalAttachment } from '@/types/task';
import {
  type NormalVideoModel,
  type VideoAspect,
  type VideoCreationOptions,
  type VideoDuration,
  type VideoModel,
  type VideoResolution,
  type VideoStyleOption,
  cloneModeFromVideoModel,
  estimateCloneCny,
  estimateIpVideo,
  estimatePerSegmentCny,
  normalVideoModelFromSelection,
} from '@/types/video';
import { type NormalVideoModelId, reconcileNormalVideoParameters } from '@holaday/shared-types';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Clapperboard,
  Clock,
  ImagePlus,
  Files,
  Plus,
  Lightbulb,
  Loader2,
  Mic,
  Palette,
  Pin,
  Play,
  Scissors,
  Sparkles,
  Video as VideoIcon,
  X,
  XCircle,
} from 'lucide-react';
import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CreativeDisclosure } from '@/components/CreativeDisclosure';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

/**
 * 视频任务 — Phase 2 第一期独立视频界面(骨架 + 普通可用)。
 *
 * 三类型 tab:普通视频 / 复刻视频 / IP人物视频。
 * 普通走既有两段式:提交 = tasks.create
 * (videoOptions 透传)→ awaiting_user video_quote 报价卡 → confirmVideo
 * 确认后才烧。本页只采集参数 + 实时估价 + 列历史,不直接计费。
 */

type CreativeMode = 'video' | 'image';

export function creativeRetryPath(mode: CreativeMode): '/video' | '/image' {
  return mode === 'video' ? '/video' : '/image';
}

export function creativeTaskPath(mode: CreativeMode, taskId: string): string {
  return `${creativeRetryPath(mode)}?task=${encodeURIComponent(taskId)}`;
}

export function currentMediaDownloadPayload(attachment: UiTerminalAttachment): FileDownloadPayload {
  return {
    fileId: attachment.fileId,
    filename: attachment.filename,
    size: attachment.sizeBytes,
    downloadUrl: attachment.downloadUrl,
    expiresAt: attachment.expiresAt,
    ...(attachment.availability === 'unavailable' ? { unavailable: true } : {}),
  };
}

const CREATIVE_HISTORY_VISIBLE_PAGE_SIZE = 4;
const CREATIVE_HISTORY_SCAN_PAGES_PER_CLICK = 5;
export const IP_VIDEO_ASPECT_RATIO: VideoAspect = '9:16';
type VideoTab = 'normal' | 'pet' | 'ip';
type CreativeModelValue = VideoModel;
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

const CREATIVE_SECTION_CLASS =
  'rounded-[22px] border-[var(--creative-line,#EFEFEF)] bg-[var(--creative-surface,#fff)] shadow-[0_14px_34px_rgba(17,24,39,0.04)]';
const CREATIVE_PRICE_SECTION_CLASS =
  'rounded-[22px] border-[var(--creative-line,#EFEFEF)] bg-[var(--creative-surface,#fff)] shadow-[0_14px_34px_rgba(17,24,39,0.04)]';
const CREATIVE_ASPECT_OPTIONS: ReadonlyArray<{ value: VideoAspect; label: string }> = [
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
];

interface CreativeModelOption {
  value: CreativeModelValue;
  name: string;
  version: string;
  description: string;
  badges: readonly string[];
  tone: string;
}

const CREATIVE_MODEL_OPTIONS: ReadonlyArray<CreativeModelOption> = [
  {
    value: 'veo_fast',
    name: 'Veo',
    version: '3.1 Fast',
    description: '快速生成，适合日常短视频草稿与轻量创意验证。',
    badges: ['文本成片', '图像参考', '性价比'],
    tone: 'from-[#1E9BFF] via-[#735CFF] to-[#FF0061]',
  },
  {
    value: 'veo_standard',
    name: 'Veo',
    version: '3.1 Standard',
    description: '画面稳定度和细节更高，适合正式成片前的高质量版本。',
    badges: ['文本成片', '高质量', '1080p'],
    tone: 'from-[#8A63FF] via-[#FF0061] to-[#FFB23F]',
  },
  {
    value: 'wanxiang',
    name: 'Wan',
    version: '2.7',
    description: '万相 2.7 文生视频，支持 2–15 秒与 720p/1080p，国内直连、成本更低。',
    badges: ['文本成片', '国内直连', '性价比'],
    tone: 'from-[#2F6BFF] via-[#5C42E8] to-[#21C8B6]',
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

const STYLE_GROUPS: Record<
  CreativeStyleGroup,
  { title: string; subtitle: string; icon: typeof Sparkles }
> = {
  vibe: { title: '氛围', subtitle: '风格基调', icon: Sparkles },
  lighting: { title: '光感', subtitle: '光线效果', icon: Lightbulb },
  color: { title: '色彩', subtitle: '配色倾向', icon: Palette },
};

const STYLE_OPTIONS_BY_GROUP: Record<
  CreativeStyleGroup,
  ReadonlyArray<{
    key: CreativeStyleKey;
    label: string;
    description: string;
    prompt?: string;
    swatch: string;
  }>
> = {
  vibe: [
    {
      key: 'random',
      label: '随机',
      description: '让模型按内容自动选择',
      swatch: 'from-[#FCE7F3] via-[#E0F2FE] to-[#FEF3C7]',
    },
    {
      key: 'clay',
      label: '黏土',
      description: '柔软手作质感',
      prompt: '黏土动画质感，柔软圆润，手作感',
      swatch: 'from-[#D9B99B] via-[#F2D8BF] to-[#8DAA91]',
    },
    {
      key: 'color_sketch',
      label: '彩色手绘',
      description: '轻快插画线稿',
      prompt: '彩色手绘草图风格，线条轻盈，保留动感',
      swatch: 'from-[#FDE68A] via-[#F9A8D4] to-[#93C5FD]',
    },
    {
      key: 'logo',
      label: '标志化',
      description: '图形符号更强',
      prompt: '简洁标志化构图，图形感强，主体明确',
      swatch: 'from-[#111827] via-[#FFFFFF] to-[#FF0061]',
    },
    {
      key: 'papercraft',
      label: '纸艺',
      description: '纸张层次与剪贴',
      prompt: '纸艺剪贴质感，多层纸张，柔和阴影',
      swatch: 'from-[#F7E8D0] via-[#FFFFFF] to-[#FCA5A5]',
    },
    {
      key: 'pro_photo',
      label: '专业摄影',
      description: '商业摄影质感',
      prompt: '专业摄影质感，真实镜头语言，清晰主体',
      swatch: 'from-[#111827] via-[#6B7280] to-[#F8FAFC]',
    },
    {
      key: 'sci_fi',
      label: '科幻',
      description: '未来感科技视觉',
      prompt: '科幻未来感，发光细节，科技场景',
      swatch: 'from-[#0F172A] via-[#1D4ED8] to-[#22D3EE]',
    },
    {
      key: 'sketch',
      label: '素描',
      description: '黑白线稿质感',
      prompt: '素描线稿风格，黑白铅笔质感',
      swatch: 'from-[#111827] via-[#9CA3AF] to-[#F9FAFB]',
    },
    {
      key: 'stock_footage',
      label: '素材片',
      description: '自然素材库镜头',
      prompt: '高质量素材片镜头，自然真实，少夸张特效',
      swatch: 'from-[#14532D] via-[#86EFAC] to-[#EFF6FF]',
    },
  ],
  lighting: [
    {
      key: 'random',
      label: '随机',
      description: '自动匹配光线',
      swatch: 'from-[#FEF3C7] via-[#E0F2FE] to-[#FCE7F3]',
    },
    {
      key: 'backlight',
      label: '逆光',
      description: '轮廓光突出',
      prompt: '逆光轮廓，主体边缘有柔和高光',
      swatch: 'from-[#020617] via-[#64748B] to-[#FFFFFF]',
    },
    {
      key: 'candle_lit',
      label: '烛光',
      description: '暖调低照度',
      prompt: '烛光暖调，低照度，温柔阴影',
      swatch: 'from-[#1C1917] via-[#B45309] to-[#FED7AA]',
    },
    {
      key: 'chiaroscuro',
      label: '明暗对照',
      description: '强烈戏剧阴影',
      prompt: '明暗对照强烈，戏剧化阴影',
      swatch: 'from-[#000000] via-[#44403C] to-[#F5F5F4]',
    },
    {
      key: 'film_haze',
      label: '胶片雾感',
      description: '轻柔散射',
      prompt: '胶片雾感，柔和散射光，低对比',
      swatch: 'from-[#94A3B8] via-[#E2E8F0] to-[#FDE68A]',
    },
    {
      key: 'foggy',
      label: '薄雾',
      description: '空气感更强',
      prompt: '薄雾环境，空气透视明显，氛围朦胧',
      swatch: 'from-[#CBD5E1] via-[#F8FAFC] to-[#BAE6FD]',
    },
    {
      key: 'golden_hour',
      label: '黄金时刻',
      description: '日落暖光',
      prompt: '黄金时刻日落暖光，皮肤和环境偏暖',
      swatch: 'from-[#7C2D12] via-[#F97316] to-[#FEF3C7]',
    },
    {
      key: 'hardlight',
      label: '硬光',
      description: '边界清晰的阴影',
      prompt: '硬光照明，阴影边界清晰，反差强',
      swatch: 'from-[#111827] via-[#F59E0B] to-[#FFFFFF]',
    },
    {
      key: 'lens_flare',
      label: '镜头光斑',
      description: '有镜头眩光',
      prompt: '自然镜头光斑，适度眩光，电影感',
      swatch: 'from-[#7DD3FC] via-[#F9A8D4] to-[#FDE68A]',
    },
    {
      key: 'light_art',
      label: '光绘',
      description: '彩色光轨',
      prompt: '光绘效果，彩色光轨，动势明显',
      swatch: 'from-[#0F172A] via-[#A855F7] to-[#22D3EE]',
    },
    {
      key: 'low_key',
      label: '低调光',
      description: '暗背景高质感',
      prompt: '低调光，暗背景，主体局部被打亮',
      swatch: 'from-[#020617] via-[#111827] to-[#64748B]',
    },
    {
      key: 'luminous',
      label: '明亮发光',
      description: '高亮通透',
      prompt: '明亮通透，主体有柔和发光感',
      swatch: 'from-[#ECFEFF] via-[#FFFFFF] to-[#FBCFE8]',
    },
    {
      key: 'mystical',
      label: '神秘',
      description: '梦幻微光',
      prompt: '神秘梦幻微光，细腻粒子和柔和暗部',
      swatch: 'from-[#1E1B4B] via-[#6D28D9] to-[#C4B5FD]',
    },
    {
      key: 'rainy',
      label: '雨天',
      description: '潮湿反光',
      prompt: '雨天湿润反光，柔和阴天光线',
      swatch: 'from-[#0F172A] via-[#64748B] to-[#BAE6FD]',
    },
    {
      key: 'soft_light',
      label: '柔光',
      description: '干净自然',
      prompt: '柔和漫射光，皮肤和物体边缘自然',
      swatch: 'from-[#FDF2F8] via-[#FFFFFF] to-[#DBEAFE]',
    },
    {
      key: 'volumetric',
      label: '体积光',
      description: '空间光束',
      prompt: '体积光束穿过空间，层次清楚',
      swatch: 'from-[#0F172A] via-[#D97706] to-[#FDE68A]',
    },
  ],
  color: [
    {
      key: 'random',
      label: '随机',
      description: '自动匹配色彩',
      swatch: 'from-[#FCE7F3] via-[#DDD6FE] to-[#CCFBF1]',
    },
    {
      key: 'autumn',
      label: '秋日',
      description: '橙棕暖调',
      prompt: '秋日橙棕暖调，柔和复古',
      swatch: 'from-[#7C2D12] via-[#D97706] to-[#FDE68A]',
    },
    {
      key: 'complementary',
      label: '互补色',
      description: '色彩对比明确',
      prompt: '互补色搭配，主次分明，视觉对比强',
      swatch: 'from-[#2563EB] via-[#FFFFFF] to-[#F97316]',
    },
    {
      key: 'cool',
      label: '冷调',
      description: '蓝青冷色',
      prompt: '冷调蓝青色彩，清爽克制',
      swatch: 'from-[#0F172A] via-[#0EA5E9] to-[#CCFBF1]',
    },
    {
      key: 'dark',
      label: '暗色',
      description: '深色高级感',
      prompt: '暗色调，高级感，低饱和',
      swatch: 'from-[#020617] via-[#1F2937] to-[#4B5563]',
    },
    {
      key: 'earthy',
      label: '大地色',
      description: '自然低饱和',
      prompt: '大地色系，低饱和，自然温和',
      swatch: 'from-[#3F2A1D] via-[#A16207] to-[#D6D3D1]',
    },
    {
      key: 'electric',
      label: '电光',
      description: '高饱和霓虹',
      prompt: '电光霓虹色，高饱和，强视觉冲击',
      swatch: 'from-[#0F172A] via-[#D946EF] to-[#22D3EE]',
    },
    {
      key: 'iridescent',
      label: '虹彩',
      description: '流动渐变',
      prompt: '虹彩渐变，色彩流动，梦幻光泽',
      swatch: 'from-[#F0ABFC] via-[#67E8F9] to-[#FDE68A]',
    },
    {
      key: 'pastel',
      label: '粉彩',
      description: '柔和浅色',
      prompt: '粉彩色调，浅色柔和，轻盈干净',
      swatch: 'from-[#FBCFE8] via-[#BFDBFE] to-[#FEF3C7]',
    },
    {
      key: 'split',
      label: '分离色调',
      description: '阴影高光分色',
      prompt: '分离色调，阴影和高光有明确色彩分层',
      swatch: 'from-[#0F172A] via-[#7C3AED] to-[#F59E0B]',
    },
    {
      key: 'terracotta_teal',
      label: '陶土青绿',
      description: '暖冷平衡',
      prompt: '陶土橙与青绿色搭配，温暖又清爽',
      swatch: 'from-[#C2410C] via-[#FDE68A] to-[#0F766E]',
    },
    {
      key: 'ultraviolet',
      label: '紫外线',
      description: '紫蓝未来感',
      prompt: '紫外线紫蓝色调，未来感，高对比',
      swatch: 'from-[#2E1065] via-[#7E22CE] to-[#60A5FA]',
    },
    {
      key: 'vibrant',
      label: '鲜艳',
      description: '明快高饱和',
      prompt: '鲜艳明快，高饱和，画面有活力',
      swatch: 'from-[#FF0061] via-[#F97316] to-[#22C55E]',
    },
    {
      key: 'warm',
      label: '暖调',
      description: '舒适柔暖',
      prompt: '暖色调，舒适亲和，柔和光泽',
      swatch: 'from-[#B45309] via-[#FDBA74] to-[#FFF7ED]',
    },
  ],
};

export function VideoPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tasks = useTaskStore((s) => s.tasks);
  const refreshTasks = useTaskStore((s) => s.refreshTasks);
  const selectTask = useTaskStore((s) => s.selectTask);
  const [videoTab, setVideoTab] = React.useState<VideoTab>('normal');
  const taskId = searchParams.get('task');
  const currentTask = taskId ? (tasks.find((task) => task.taskId === taskId) ?? null) : null;
  const handleTaskCreated = React.useCallback(
    (createdTaskId: string) => {
      navigate(creativeTaskPath('video', createdTaskId));
    },
    [navigate],
  );

  // History can link to tasks older than the first list page. Hydrate the
  // exact detail row once so the current-task panel does not spin forever.
  const hydratedTaskIds = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const already = taskId ? hydratedTaskIds.current.has(taskId) : false;
    hydrateMissingMediaTask({ taskId, hasTask: Boolean(currentTask), already }, (missingTaskId) => {
      hydratedTaskIds.current.add(missingTaskId);
      selectTask(missingTaskId, 'url');
    });
  }, [currentTask, selectTask, taskId]);

  React.useEffect(() => {
    if (!taskId) return;
    const status = currentTask?.status;
    if (status && !['queued', 'executing', 'awaiting_user'].includes(status)) return;
    const timer = window.setInterval(() => {
      void refreshTasks();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [currentTask?.status, refreshTasks, taskId]);

  React.useEffect(() => {
    if (!taskId) return;
    const taskTab = videoTabForTaskType(currentTask?.videoType);
    if (taskTab) setVideoTab(taskTab);
  }, [currentTask?.videoType, taskId]);

  return (
    <CreativeStudioPage
      videoTab={videoTab}
      onVideoTabChange={(nextTab) => {
        setVideoTab(nextTab);
        if (taskId) navigate('/video');
      }}
      onTaskCreated={handleTaskCreated}
      historyRefreshKey={
        currentTask ? `${currentTask.taskId}:${currentTask.status}` : (taskId ?? '')
      }
      currentTaskPanel={
        taskId ? <CurrentVideoTaskPanel taskId={taskId} task={currentTask} /> : null
      }
    />
  );
}

function CreativeStudioPage({
  videoTab = 'normal',
  onVideoTabChange,
  onTaskCreated,
  historyRefreshKey,
  currentTaskPanel,
}: {
  videoTab?: VideoTab;
  onVideoTabChange?(tab: VideoTab): void;
  onTaskCreated(taskId: string): void;
  historyRefreshKey?: string;
  currentTaskPanel: React.ReactNode;
}): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const createTask = useTaskStore((s) => s.createTask);
  const [scenarioId, setScenarioId] = React.useState<VideoCreationScenarioId>(() =>
    scenarioForVideoTab(videoTab),
  );
  const [prompt, setPrompt] = React.useState('');
  const [templateLabel, setTemplateLabel] = React.useState<string | null>('产品短片');
  const [model, setModel] = React.useState<VideoModel>('veo_fast');
  const mediaModels = useMediaModels();
  const normalModelOptions = React.useMemo(
    () => filterAvailableOptions(CREATIVE_MODEL_OPTIONS, mediaModels?.video),
    [mediaModels],
  );
  React.useEffect(() => {
    // Hidden (unconfigured) normal-video model selected → move to the first usable one.
    // Veo models need fal + DashScope, so the fallback is never a Veo-only constraint.
    if (videoTab !== 'normal') return;
    const first = normalModelOptions[0];
    if (first && !normalModelOptions.some((option) => option.value === model)) {
      setModel(first.value as VideoModel);
    }
  }, [model, normalModelOptions, videoTab]);
  const [stylePickerOpen, setStylePickerOpen] = React.useState<CreativeStyleGroup | null>(null);
  const [referenceVideoDialogOpen, setReferenceVideoDialogOpen] = React.useState(false);
  const referenceVideoTrigger = React.useRef<HTMLButtonElement>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsKind, setSettingsKind] = React.useState<'model' | 'specs'>('model');
  const settingsAnchor = React.useRef<HTMLButtonElement | null>(null);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const libraryAnchor = React.useRef<HTMLButtonElement | null>(null);
  const [vibeStyle, setVibeStyle] = React.useState<CreativeStyleKey>('random');
  const [lightingStyle, setLightingStyle] = React.useState<CreativeStyleKey>('random');
  const [colorStyle, setColorStyle] = React.useState<CreativeStyleKey>('random');
  const [durationSeconds, setDurationSeconds] = React.useState<VideoDuration>(8);
  const [aspectRatio, setAspectRatio] = React.useState<VideoAspect>('16:9');
  const [resolution, setResolution] = React.useState<VideoResolution>('1080p');
  const [attachments, setAttachments] = React.useState<DraftAttachment[]>([]);
  const attachmentsRef = React.useRef(attachments);
  attachmentsRef.current = attachments;
  const [submitting, setSubmitting] = React.useState(false);
  const [videoEditingEnabled, setVideoEditingEnabled] = React.useState(false);
  const [uploadingForEditing, setUploadingForEditing] = React.useState(false);
  const [submitGuard] = React.useState(createMediaActionGuard);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const editingUploadRef = React.useRef<HTMLInputElement>(null);
  const previousVideoTabRef = React.useRef<VideoTab>(videoTab);
  const isCloneVideo = videoTab === 'pet';
  const isIpVideo = videoTab === 'ip';
  const accent = '#AF99F2';
  const softBg = 'bg-[#FF0061]/10';
  const activeScenario = videoCreationScenario(scenarioId);

  React.useEffect(() => {
    let active = true;
    void trpc.videoEditing.capability.query().then(
      (result) => {
        if (active) setVideoEditingEnabled(result.enabled);
      },
      () => {
        if (active) setVideoEditingEnabled(false);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function uploadForEditing(file: File): Promise<void> {
    if (uploadingForEditing || !videoEditingEnabled) return;
    if (!file.type.startsWith('video/')) {
      toast.show('请选择视频文件', 'error');
      return;
    }
    setUploadingForEditing(true);
    try {
      const uploaded = await uploadMediaFile(file);
      const { projectId } = await createVideoEditingProject({
        sourceFileIds: [uploaded.fileId],
        create: (input) => trpc.videoEditing.createProject.mutate(input),
      });
      navigate(`/video/edit/${encodeURIComponent(projectId)}`);
    } catch (error) {
      toast.show(uploadFailureMessage(error), 'error');
    } finally {
      setUploadingForEditing(false);
    }
  }

  React.useEffect(
    () => () => {
      revokeCreativePreviewUrls(attachmentsRef.current);
    },
    [],
  );

  React.useEffect(() => {
    const previous = previousVideoTabRef.current;
    previousVideoTabRef.current = videoTab;
    if (previous === videoTab) return;
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
  }, [durationSeconds, model, resolution, videoTab]);

  React.useEffect(() => {
    setScenarioId((current) => scenarioForVideoTab(videoTab, current));
  }, [videoTab]);

  function handleScenarioChange(nextScenarioId: VideoCreationScenarioId): void {
    const nextTab = videoTabForScenario(nextScenarioId);
    setScenarioId(nextScenarioId);
    setSettingsOpen(false);
    if (nextTab === 'normal') {
    }
    onVideoTabChange?.(nextTab);
  }

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
        const meta = isCreativeReferenceVideo(file)
          ? await uploadMediaFile(file)
          : await uploadFile(file);
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
      toast.show('请先描述想生成的视频内容', 'error');
      return;
    }
    if (attachments.some((attachment) => attachment.status === 'uploading')) {
      toast.show('文件上传中，请稍候');
      return;
    }
    if (!submitGuard.acquire()) return;
    setSubmitting(true);
    const fileIds = attachments
      .filter((attachment) => attachment.status === 'ready' && attachment.fileId)
      .map((attachment) => attachment.fileId);
    const styledVideoIntent = buildVideoIntentWithCreativeStyles(intent, {
      vibe: vibeStyle,
      lighting: lightingStyle,
      color: colorStyle,
    });
    const normalVideoModel = normalVideoModelFromSelection(model);
    try {
      const res = await createTask(
        styledVideoIntent,
        fileIds,
        undefined,
        undefined,
        undefined,
        undefined,
        {
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
        },
      );
      if ('error' in res) {
        toast.show(res.error || '提交失败，请重试', 'error');
        return;
      }
      toast.show('已提交，请确认报价后开始制作', 'info', 3000);
      await handleCreated(res.taskId);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '提交失败，请重试', 'error');
    } finally {
      submitGuard.release();
      setSubmitting(false);
    }
  }

  const project = useCreativeProject();
  async function handleCreated(taskId: string) { await project.associate(taskId); onTaskCreated(taskId); }
  const modelControl = (<div className="hd-composer-meta"><button className="hd-glass-pill" type="button" aria-expanded={settingsOpen} title="模型与生成设置" onClick={event => { settingsAnchor.current = event.currentTarget; const kind = isIpVideo ? 'specs' : 'model'; setSettingsKind(kind); setSettingsOpen(open => settingsKind === kind ? !open : true); }}><Clapperboard className="h-4 w-4" />{isCloneVideo ? modelOptionDisplayName(modelOptionFor(model, CLONE_MODEL_OPTIONS)) : isIpVideo ? '人物口播' : creativeModelDisplayName(model as NormalVideoModel)}<ChevronDown className="h-3 w-3" /></button>{videoTab === 'normal' && templateLabel && <button type="button" className="hd-glass-pill" title="移除模板" onClick={() => setTemplateLabel(null)}>{templateLabel}<X className="h-3 w-3" /></button>}</div>);

  return (
    <main className="hd-creative-page hd-video-page min-h-full bg-[var(--creative-surface,#FBFAF7)] text-[var(--creative-ink,#342E39)]">
      <PageContainer width="wide" className="hd-creative-container max-w-[1220px] pb-14 pt-7 md:px-10 md:pt-9">
        <div className="relative overflow-hidden rounded-none">
          <header className="hd-creative-heading"><span>HOLADAY VIDEO</span><h1>把想法，拍成画面。</h1><p>从一句描述、一张参考图开始。</p></header>
          {onVideoTabChange && <div className="hd-creative-tabs" role="tablist" aria-label="视频创作模式" style={{ '--active-tab': videoTab === 'normal' ? 0 : videoTab === 'pet' ? 1 : 2 } as React.CSSProperties}>
            {([{id:'normal', label:'自由创作', scenario:'product_highlight'},{id:'pet',label:'动作复刻',scenario:'action_remake'},{id:'ip',label:'人物口播',scenario:'ip_presenter'}] as const).map(tab => <button key={tab.id} type="button" role="tab" aria-selected={videoTab === tab.id} disabled={submitting} onClick={() => handleScenarioChange(tab.scenario)}>{tab.label}</button>)}
          </div>}
          {videoTab === 'normal' && <CreativeInspiration kind="video" disabled={submitting} onPick={idea => { setPrompt(idea.prompt); setAspectRatio(idea.image === 'vlog' ? '9:16' : '16:9'); }} />}
          {videoTab === 'normal' && modelControl}

          {project.notice}
          <CreativeReferenceLibrary open={libraryOpen} onOpenChange={setLibraryOpen} anchorRef={libraryAnchor} disabled={submitting || attachments.length >= CREATIVE_MAX_ATTACHMENTS} selectedFileIds={attachments.map(file => file.fileId)} onChooseLocal={() => imageInputRef.current?.click()} onPick={file => { if (submitting) return; setAttachments(current => current.some(item => item.fileId === file.fileId) || current.length >= CREATIVE_MAX_ATTACHMENTS ? current : [...current, file]); }} />
          <CreativePopover open={settingsOpen} onOpenChange={setSettingsOpen} anchorRef={settingsAnchor} title={settingsKind === 'model' ? '选择视频模型' : '视频规格'}>
            {isIpVideo ? <p className="hd-mode-help">9:16 · 随文案时长 · 跟随已上传出镜底版。使用已准备的声音与人物素材。</p> : settingsKind === 'model' ? <div className="hd-model-options">{(isCloneVideo ? CLONE_MODEL_OPTIONS : normalModelOptions).map(option => <button key={option.value} type="button" aria-pressed={model === option.value} onClick={() => { if (isCloneVideo) setModel(option.value as VideoModel); else applyNormalVideoModel(option.value as NormalVideoModel); setSettingsOpen(false); }}><span><strong>{modelOptionDisplayName(option)}</strong><small>{option.description}</small></span>{model === option.value && <Check />}</button>)}</div> : <div className="hd-spec-options">
              <CreativeSegment label="比例" value={aspectRatio} options={CREATIVE_ASPECT_OPTIONS} onChange={value => setAspectRatio(value as VideoAspect)} accent={accent} compact />
              <CreativeSegment label="时长" value={durationSeconds} options={[{ value: 6, label: '6s' }, { value: 8, label: '8s' }]} onChange={value => applyNormalVideoDuration(value as VideoDuration)} accent={accent} compact />
              <CreativeSelect label="画质" value={resolution === '1080p' ? '1080p 高清' : '720p 标清'} options={['1080p 高清', '720p 标清']} onPick={value => applyNormalVideoResolution(value.includes('720') ? '720p' : '1080p')} />
              <CreativeStyleSummaryPicker vibe={vibeStyle} lighting={lightingStyle} color={colorStyle} previewSubject="default" openGroup={stylePickerOpen} onOpenGroupChange={setStylePickerOpen} onVibeChange={setVibeStyle} onLightingChange={setLightingStyle} onColorChange={setColorStyle} accent={accent} />
            </div>}
          </CreativePopover>

          <div className="hd-media-mode" hidden={videoTab === 'normal'}>
              <div className="hd-special-video relative z-10 mt-5 rounded-[26px] border border-[var(--creative-line,#EFEFEF)] bg-[var(--creative-surface,#fff)] p-5 shadow-[0_16px_42px_rgba(17,24,39,0.05)]">
                <div className="hd-media-mode" hidden={videoTab !== 'pet'}><PetVideoForm onTaskCreated={handleCreated} model={model} modelControl={modelControl} projectAction={project.renderPicker(submitting)} /></div>
                <div className="hd-media-mode" hidden={videoTab !== 'ip'}><IpOnboardingWizard onTaskCreated={handleCreated} modelControl={modelControl} projectAction={project.renderPicker(submitting)} /></div>
                {currentTaskPanel && videoTab !== 'normal' ? <div className="mt-6">{currentTaskPanel}</div> : null}
              </div>
              {videoTab !== 'normal' && <VideoHistory
                accent={accent}
                softBg={softBg}
                videoType={videoTab === 'pet' ? 'pet' : 'ip_person'}
                refreshKey={historyRefreshKey}
              />}
          </div>
          <div className="hd-media-mode" hidden={videoTab !== 'normal'}>
              <section aria-label="视频创作工作台" data-creative-composer className="hd-video-brief">
                <div className="hd-composer-source"><button type="button" title="添加参考素材" ref={libraryAnchor} onClick={() => setLibraryOpen(open => !open)}><Files className="h-4 w-4" />参考资料</button>{project.renderPicker(submitting)}</div>
                <h2 id="video-brief-heading" className="sr-only">告诉 HOLA DAY 你的重点</h2>
                  {attachments.length > 0 ? (
                    <div className="hd-brief-chips mt-5 flex flex-wrap gap-2 border-t border-[var(--creative-line,#EFEFEF)] pt-4">
                      {attachments.map((attachment, index) => (
                        <AttachmentChip
                          key={attachment.clientId ?? `${attachment.filename}-${index}`}
                          attachment={attachment}
                          onRemove={() => removeCreativeAttachment(attachment.clientId, index)}
                        />
                      ))}
                    </div>
                  ) : null}

                <Textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="描述你想拍出的画面，也可以添加产品或主角图片…" aria-label="告诉 HOLA DAY 你的重点" className="hd-media-prompt" />
                <div className="hd-media-bottom"><div className="hd-media-tools"><button type="button" className="hd-media-add" title="添加本地资料" aria-label="添加本地资料" onClick={() => imageInputRef.current?.click()}><Plus className="h-4 w-4" /></button>
                  <button className="hd-glass-pill" type="button" title="添加参考图" aria-label="添加参考图" onClick={() => imageInputRef.current?.click()}><ImagePlus className="h-4 w-4" />参考图</button>
                  <button className="hd-glass-pill" type="button" title="添加参考视频" aria-label="添加参考视频" ref={referenceVideoTrigger} onClick={() => setReferenceVideoDialogOpen(true)}><VideoIcon className="h-4 w-4" />参考视频</button>
                  <button className="hd-glass-pill" type="button" aria-expanded={settingsOpen} title="调整视频规格" onClick={event => { settingsAnchor.current = event.currentTarget; setSettingsKind('specs'); setSettingsOpen(open => settingsKind === 'specs' ? !open : true); }}>{aspectRatio} · {durationSeconds}秒 · {resolution}<ChevronDown className="h-3 w-3" /></button>
                </div><div className="hd-creative-generation-actions"><button type="button" className="hd-generate" onClick={() => void handleSubmit()} disabled={submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}<span>{submitting ? '提交中…' : '准备生成'}</span></button><small className="hd-quote-hint">生成前确认积分</small></div></div>
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept={CREATIVE_ACCEPT_IMAGES}
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          if (event.target.files)
                            void ingestCreativeFiles(event.target.files, true);
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
                            void ingestCreativeFiles(event.target.files).finally(() =>
                              setReferenceVideoDialogOpen(false),
                            );
                          }
                          event.target.value = '';
                        }}
                      />
                <ReferenceVideoUploadDialog open={referenceVideoDialogOpen} returnFocusRef={referenceVideoTrigger} onClose={() => setReferenceVideoDialogOpen(false)} onChoose={() => fileInputRef.current?.click()} />
              </section>
              <CreativeDisclosure label="示例分镜"><VideoCreationStoryboard scenario={activeScenario} /></CreativeDisclosure>

              {videoEditingEnabled ? (
                <div className="relative z-10 mt-3 flex flex-col gap-3 rounded-[18px] border border-[var(--creative-line,#E9E1EA)] bg-[linear-gradient(120deg,#FFF9FB,#F7F8FF)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-[13px] font-semibold text-[var(--creative-ink,#332E37)]">
                      已有视频也能继续创作
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--creative-muted,#847B87)]">
                      原视频会保留，每次修改都生成新版本。
                    </div>
                  </div>
                  <input
                    ref={editingUploadRef}
                    type="file"
                    accept="video/*,.mp4,.mov,.webm"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadForEditing(file);
                      event.target.value = '';
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploadingForEditing}
                    onClick={() => editingUploadRef.current?.click()}
                    className="h-10 shrink-0 gap-2 rounded-[10px] border-[var(--creative-line,#DFCADA)] bg-[var(--creative-surface,#fff)] px-4 text-[var(--creative-muted,#7C4560)] hover:bg-[var(--creative-surface,#FFF5F8)] hover:text-[var(--creative-muted,#B72D5C)]"
                  >
                    {uploadingForEditing ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Scissors className="h-4 w-4" aria-hidden />
                    )}
                    {uploadingForEditing ? '正在导入…' : '上传视频，继续剪辑'}
                  </Button>
                </div>
              ) : (
                <div className="relative z-10 mt-3 flex items-center gap-3 rounded-[18px] border border-[var(--creative-line,#E8E1E7)] bg-[var(--creative-surface,#fff)] px-4 py-3 text-[var(--creative-muted,#6F6472)]">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[var(--creative-surface,#F4EDF3)] text-[var(--creative-muted,#A95170)]">
                    <Scissors className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-[var(--creative-ink,#443A47)]">
                      继续剪辑
                      <span className="rounded-full bg-[var(--creative-surface,#F5EFF4)] px-2 py-0.5 text-[10px] font-semibold text-[var(--creative-muted,#8A7080)]">
                        即将开放
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] leading-4 text-[var(--creative-muted,#877D89)]">
                      许可与稳定性验证完成后开放，当前生成结果和原视频都不会被覆盖。
                    </p>
                  </div>
                </div>
              )}

              {currentTaskPanel && videoTab === 'normal' ? (
                <div className="relative z-10 mt-6">{currentTaskPanel}</div>
              ) : null}
              {videoTab === 'normal' && <VideoHistory accent={accent} softBg={softBg} refreshKey={historyRefreshKey} />}
          </div>
        </div>
      </PageContainer>
    </main>
  );
}

function isCreativeReferenceVideo(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|mov)$/i.test(file.name);
}

function modelOptionFor(
  model: CreativeModelValue,
  options: ReadonlyArray<CreativeModelOption> = CREATIVE_MODEL_OPTIONS,
): CreativeModelOption {
  return (
    options.find((option) => option.value === model) ?? options[0] ?? CREATIVE_MODEL_OPTIONS[0]
  );
}

function modelOptionDisplayName(option: CreativeModelOption): string {
  return `${option.name} ${option.version}`;
}

export function creativeModelDisplayName(model: NormalVideoModel): string {
  return modelOptionDisplayName(modelOptionFor(model, CREATIVE_MODEL_OPTIONS));
}

export function modelPreviewSrc(model: CreativeModelValue): string {
  if (model === 'wanxiang' || model === 'wan_animate_std' || model === 'wan_animate_pro') {
    return '/video-style-previews/models/wanxiang.svg';
  }
  return `/video-style-previews/models/${model}.png`;
}

function styleOptionFor(
  group: CreativeStyleGroup,
  key: CreativeStyleKey,
): (typeof STYLE_OPTIONS_BY_GROUP)[CreativeStyleGroup][number] {
  return (
    STYLE_OPTIONS_BY_GROUP[group].find((option) => option.key === key) ??
    STYLE_OPTIONS_BY_GROUP[group][0]
  );
}

function stylePreviewSrc(
  group: CreativeStyleGroup,
  key: CreativeStyleKey,
  subject: CreativeStylePreviewSubject,
): string {
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
  const lines = [
    '复刻视频：使用单人照片替换参考视频中的单人主角，并保留参考视频的动作、镜头、节奏和音频。',
    '适配要求：主角照片与参考视频人物需取景和身体比例相近；当前模型不支持宠物、物体或多人替换。',
  ];
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
  const styleTrigger = React.useRef<HTMLButtonElement>(null);
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
    <div className="sm:col-span-2 xl:col-span-1">
      <div className="mb-2 text-[13px] font-semibold text-[var(--creative-muted,#ADADAD)]">风格样式</div>
      <button
        type="button"
        ref={styleTrigger}
        onClick={() => onOpenGroupChange('vibe')}
        className="flex h-11 w-full min-w-0 items-center gap-3 rounded-[10px] border border-[var(--creative-line,#DCDDDD)] bg-[var(--creative-surface,#fff)] px-3 text-left transition-colors hover:border-[#ADADAD] focus:border-[#FF0061] focus:outline-none"
      >
        <CreativeStyleIcon />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] leading-none text-[var(--creative-muted,#8B93A6)]">
            氛围 / 光感 / 色彩
          </span>
          <span className="block truncate text-[13px] font-semibold leading-5 text-[var(--creative-ink,#111827)]">
            {summary}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--creative-ink,#595757)]" />
      </button>
      {openGroup ? (
        <CreativeStyleDialog
          returnFocusRef={styleTrigger}
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
      <span
        className="absolute inset-0 bg-[radial-gradient(circle_at_24%_22%,rgba(255,255,255,0.78)_0%,rgba(255,255,255,0.18)_18%,rgba(255,255,255,0)_34%),linear-gradient(135deg,#1E9BFF_0%,#6F5BFF_38%,#FF0061_72%,#FFB23F_100%)]"
        aria-hidden
      />
      <span
        className="absolute -left-2 top-3 h-6 w-8 rotate-[-18deg] rounded-full bg-white/18 blur-[2px]"
        aria-hidden
      />
      <span
        className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full bg-white/22 blur-[1px]"
        aria-hidden
      />
    </span>
  );
}

function CreativeStyleDialog({
  returnFocusRef,
  activeGroup,
  values,
  onActiveGroupChange,
  onChange,
  onClose,
  accent,
  previewSubject,
}: {
  returnFocusRef: React.RefObject<HTMLButtonElement>;
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
    <Dialog.Root open onOpenChange={next => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[99] bg-black/35" />
        <Dialog.Content
          aria-label={`选择${title}`}
          onCloseAutoFocus={event => { event.preventDefault(); returnFocusRef.current?.focus(); }}
          className="fixed left-1/2 top-1/2 z-[100] flex max-h-[min(760px,calc(100dvh-32px))] w-[calc(100vw-32px)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[24px] border border-white/20 bg-[#151515] text-white shadow-[0_28px_80px_rgba(0,0,0,0.34)]"
        >
        <div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-3 pt-4">
          <div>
            <Dialog.Title className="text-[18px] font-semibold text-white">{title}</Dialog.Title>
            <Dialog.Description className="mt-1 text-[12px] text-white/55">
              选择会写进视频提示词；随机则交给模型自行判断。
            </Dialog.Description>
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
        <div className="grid shrink-0 grid-cols-3 px-5 pt-2">
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
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STYLE_OPTIONS_BY_GROUP[activeGroup].map((option) => {
              const active = option.key === values[activeGroup];
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={active}
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
                      <span
                        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-white"
                        style={{ backgroundColor: accent }}
                      >
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ReferenceVideoUploadDialog({ open, onClose, onChoose, returnFocusRef }: {
  open: boolean;
  onClose(): void;
  onChoose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement>;
}): JSX.Element {
  return <Dialog.Root open={open} onOpenChange={next => !next && onClose()}>
    <Dialog.Portal>
      <Dialog.Overlay className="hd-creative-overlay" />
      <Dialog.Content className="hd-inspiration-dialog hd-reference-video-dialog"
        onCloseAutoFocus={event => { event.preventDefault(); returnFocusRef.current?.focus(); }}>
        <Dialog.Title>添加参考视频</Dialog.Title>
        <Dialog.Description>用于参考动作、节奏、镜头或构图。</Dialog.Description>
        <Dialog.Close className="hd-dialog-close" title="关闭添加参考视频" aria-label="关闭添加参考视频"><X /></Dialog.Close>
        <div className="hd-reference-video-hint"><Clapperboard aria-hidden /><div><strong>参考视频文件</strong><p>支持 MP4 / MOV。建议上传清晰、较短的视频片段。</p><small>文件添加后，可继续调整创作要求。</small></div></div>
        <footer><Dialog.Close className="hd-glass-pill">取消</Dialog.Close><button type="button" className="hd-glass-pill" onClick={onChoose}>选择视频</button></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
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
      <div className="mb-2 text-[13px] font-semibold text-[var(--creative-muted,#ADADAD)]">{label}</div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex h-11 w-full items-center justify-between rounded-[10px] border bg-[var(--creative-surface,#fff)] px-4 text-left text-[14px] font-semibold text-[var(--creative-ink,#111827)] outline-none transition-colors',
          open ? 'border-[#FF0061]' : 'border-[var(--creative-line,#DCDDDD)] hover:border-[#ADADAD]',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{value === 'auto' ? 'Auto' : value}</span>
        <ChevronDown
          className={cn('h-4 w-4 text-[var(--creative-ink,#595757)] transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-[70] overflow-hidden rounded-[12px] border border-[var(--creative-line,#DCDDDD)] bg-[var(--creative-surface,#fff)] p-1 shadow-[0_18px_44px_rgba(17,24,39,0.14)]"
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
                  active ? 'bg-[#FF0061]/10 text-[var(--creative-muted,#FF0061)]' : 'text-[var(--creative-ink,#111827)] hover:bg-[var(--creative-surface,#F7F7F7)]',
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
      <div className="mb-2 text-[13px] font-semibold text-[var(--creative-muted,#ADADAD)]">{label}</div>
      <div className="flex h-11 w-full items-center gap-1 overflow-hidden rounded-[10px] bg-[var(--creative-surface,#EFEFEF)]/70 p-1">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={active}
              className={cn(
                'flex h-9 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-[8px] px-3 text-[14px] font-semibold leading-none transition-colors',
                compact && 'px-3',
                active
                  ? 'bg-[var(--creative-surface,#fff)] shadow-[0_1px_4px_rgba(15,23,42,0.08)]'
                  : 'text-[var(--creative-ink,#111827)] hover:bg-white/60',
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

function VideoHistory({
  accent = '#FF0061',
  softBg = 'bg-[#FF0061]/10',
  videoType = 'normal',
  refreshKey,
}: {
  accent?: string;
  softBg?: string;
  videoType?: VideoType;
  refreshKey?: string;
}): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const togglePin = useTaskStore((state) => state.togglePin);
  const unavailableFiles = useUnavailableFiles();
  const [{ rows, loading, error: loadError }, dispatchLoad] = React.useReducer(
    creativeHistoryLoadReducer,
    { rows: null, loading: false, error: false },
  );
  const [filter, setFilter] = React.useState<CreativeHistoryFilter>('all');
  const [pinningTaskId, setPinningTaskId] = React.useState<string | null>(null);
  const [nextCursor, setNextCursor] = React.useState<number | null>(null);
  const [visibleCount, setVisibleCount] = React.useState(CREATIVE_HISTORY_VISIBLE_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadMoreError, setLoadMoreError] = React.useState(false);
  const [videoEditingEnabled, setVideoEditingEnabled] = React.useState(false);
  const [editingTaskId, setEditingTaskId] = React.useState<string | null>(null);
  const mountedRef = React.useRef(true);
  const loadRequestRef = React.useRef(0);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    void trpc.videoEditing.capability.query().then(
      (result) => {
        if (active) setVideoEditingEnabled(result.enabled);
      },
      () => {
        if (active) setVideoEditingEnabled(false);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const loadHistory = React.useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    dispatchLoad({ type: 'start' });
    setLoadingMore(false);
    setLoadMoreError(false);
    try {
      let cursor: number | null = null;
      const list: VideoRow[] = [];
      let foundVisibleRow = false;
      for (
        let page = 0;
        !foundVisibleRow && page < CREATIVE_HISTORY_SCAN_PAGES_PER_CLICK;
        page += 1
      ) {
        const res = await trpc.tasks.list.query(
          creativeHistoryListInput(filter, cursor ?? undefined),
        );
        if (!mountedRef.current || requestId !== loadRequestRef.current) return;

        const pageRows = (res?.tasks ?? [])
          .map(toVideoRow)
          .filter((value): value is VideoRow => value != null);
        list.push(...pageRows);
        foundVisibleRow =
          filterCreativeHistoryRows(pageRows, {
            videoType,
            filter,
          }).length > 0;
        cursor = normalizeTaskHubCursor(res?.nextCursor);
        if (cursor === null) break;
      }

      dispatchLoad({ type: 'success', rows: list });
      setNextCursor(cursor);
      setVisibleCount(CREATIVE_HISTORY_VISIBLE_PAGE_SIZE);
    } catch {
      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      dispatchLoad({ type: 'failure' });
    }
  }, [filter, videoType]);

  React.useEffect(() => {
    dispatchLoad({ type: 'reset' });
    setNextCursor(null);
    setVisibleCount(CREATIVE_HISTORY_VISIBLE_PAGE_SIZE);
    setLoadingMore(false);
    setLoadMoreError(false);
  }, [filter, videoType]);

  React.useEffect(() => {
    void loadHistory();
  }, [loadHistory, refreshKey]);

  React.useEffect(() => {
    setVisibleCount(CREATIVE_HISTORY_VISIBLE_PAGE_SIZE);
    setLoadMoreError(false);
  }, [filter, videoType]);

  const visible = React.useMemo(() => {
    if (!rows) return rows;
    return filterCreativeHistoryRows(rows, { videoType, filter });
  }, [filter, rows, videoType]);

  React.useEffect(() => {
    if (!rows) return;
    rows.forEach((row) => {
      if (row.posterUnavailable && row.posterUrl) {
        markFileUnavailable(row.posterUrl);
      }
      const downloads = row.download ? [row.download] : [];
      downloads.forEach((download) => {
        if (download.unavailable) {
          markFileUnavailable({
            fileId: download.fileId,
            url: download.downloadUrl,
          });
        }
      });
    });
  }, [rows]);

  const unavailablePosterUrls = React.useMemo(() => {
    const urls = new Set<string>();
    rows?.forEach((row) => {
      if (row.posterUrl && isFileUnavailable(row.posterUrl, unavailableFiles)) {
        urls.add(row.posterUrl);
      }
    });
    return urls;
  }, [rows, unavailableFiles]);

  const emptyCopy =
    filter === 'pinned'
      ? '暂无置顶视频作品。'
      : filter === 'recent'
        ? '最近 7 天暂无视频作品。'
        : '暂无视频作品，先在上方创建一个。';

  const loadOlderHistory = React.useCallback(async () => {
    if (
      !canLoadOlderCreativeHistory({
        loading,
        loadingMore,
        nextCursor,
      })
    ) {
      return;
    }

    const requestId = ++loadRequestRef.current;
    let cursor: number | null = nextCursor;
    const collected: VideoRow[] = [];
    let foundVisibleRow = false;

    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      for (
        let page = 0;
        cursor !== null && !foundVisibleRow && page < CREATIVE_HISTORY_SCAN_PAGES_PER_CLICK;
        page += 1
      ) {
        const res = await trpc.tasks.list.query(creativeHistoryListInput(filter, cursor));
        if (!mountedRef.current || requestId !== loadRequestRef.current) return;

        const pageRows = (res?.tasks ?? [])
          .map(toVideoRow)
          .filter((value): value is VideoRow => value != null);
        collected.push(...pageRows);
        foundVisibleRow = filterCreativeHistoryRows(pageRows, { videoType, filter }).length > 0;
        cursor = normalizeTaskHubCursor(res?.nextCursor);
      }

      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      dispatchLoad({ type: 'append', rows: collected });
      setNextCursor(cursor);
      if (foundVisibleRow) {
        setVisibleCount((count) => count + CREATIVE_HISTORY_VISIBLE_PAGE_SIZE);
      }
    } catch {
      if (mountedRef.current && requestId === loadRequestRef.current) {
        setLoadMoreError(true);
      }
    } finally {
      if (mountedRef.current && requestId === loadRequestRef.current) {
        setLoadingMore(false);
      }
    }
  }, [filter, loading, loadingMore, nextCursor, videoType]);

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

  const handleContinueEditing = React.useCallback(
    async (row: VideoRow, fileId: string) => {
      if (editingTaskId) return;
      setEditingTaskId(row.taskId);
      try {
        const { projectId } = await createVideoEditingProject({
          sourceFileIds: [fileId],
          create: (input) => trpc.videoEditing.createProject.mutate(input),
        });
        navigate(`/video/edit/${encodeURIComponent(projectId)}`);
      } catch (error) {
        toast.show(error instanceof Error ? error.message : '暂时无法打开剪辑', 'error');
      } finally {
        if (mountedRef.current) setEditingTaskId(null);
      }
    },
    [editingTaskId, navigate, toast],
  );

  return (
    <section className="hd-media-history relative z-10 mt-10 rounded-[28px] border border-[var(--creative-line,#EFEFEF)] bg-[var(--creative-surface,#fff)] p-5 shadow-[0_16px_40px_rgba(17,24,39,0.04)]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-[15px] font-semibold text-[var(--creative-ink,#111827)]">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
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
              disabled={!canChangeCreativeHistoryFilter(pinningTaskId)}
              className={cn(
                'pb-2 text-[var(--creative-muted,#ADADAD)] transition-colors hover:text-[var(--creative-ink,#595757)] disabled:cursor-wait disabled:opacity-60',
                filter === tab.id && 'border-b-2',
              )}
              style={filter === tab.id ? { color: accent, borderColor: accent } : undefined}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {loadError && rows !== null ? (
        <div
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--creative-line,#F6D3DD)] bg-[var(--creative-surface,#FFF7F9)] px-4 py-3 text-[13px] text-[var(--creative-ink,#595757)]"
          role="status"
        >
          <span className="inline-flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-[var(--creative-muted,#FF0061)]" aria-hidden />
            未能同步最新作品，当前展示上次已加载的内容。
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void loadHistory()}
            disabled={loading}
            className="h-8 border-[#F1B8C8] bg-[var(--creative-surface,#fff)] text-[var(--creative-ink,#595757)] hover:bg-[var(--creative-surface,#fff)] hover:text-[var(--creative-muted,#FF0061)]"
          >
            {loading ? '重试中…' : '重新加载'}
          </Button>
        </div>
      ) : null}
      {visible === null ? (
        loadError ? (
          <div
            className="flex min-h-[260px] flex-col items-center justify-center rounded-[24px] border border-dashed border-[var(--creative-line,#DCDDDD)] bg-[var(--creative-surface,#fff)] p-8 text-center"
            role="alert"
          >
            <AlertCircle className="h-7 w-7 text-[var(--creative-muted,#FF0061)]" aria-hidden />
            <div className="mt-3 text-[14px] font-semibold text-[var(--creative-ink,#111827)]">
              历史生成暂时无法加载
            </div>
            <div className="mt-1 text-[13px] text-muted-foreground">
              请检查网络后重试，加载失败不会删除已有作品。
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void loadHistory()}
              disabled={loading}
              className="mt-4 border-[var(--creative-line,#DCDDDD)] bg-[var(--creative-surface,#fff)] text-[var(--creative-ink,#595757)] hover:bg-[var(--creative-surface,#fff)] hover:text-[var(--creative-muted,#FF0061)]"
            >
              {loading ? '重试中…' : '重新加载'}
            </Button>
          </div>
        ) : (
          <div className="flex min-h-[260px] items-center justify-center gap-2 rounded-[24px] border border-dashed border-[var(--creative-line,#DCDDDD)] bg-[var(--creative-surface,#fff)] p-8 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            历史加载中…
          </div>
        )
      ) : visible.length === 0 ? (
        <div className="flex min-h-[260px] items-center justify-center rounded-[24px] border border-dashed border-[var(--creative-line,#DCDDDD)] bg-[var(--creative-surface,#fff)] p-10 text-center text-[13px] text-muted-foreground">
          {emptyCopy}
        </div>
      ) : (
        <div className="space-y-5">
          {visible.slice(0, visibleCount).map((row) => {
            const downloads = row.download ? [row.download] : [];
            const availabilityAwareDownloads = downloads.map((download) =>
              isFileUnavailable(
                { fileId: download.fileId, url: download.downloadUrl },
                unavailableFiles,
              ) && !download.unavailable
                ? { ...download, unavailable: true }
                : download,
            );
            const download = availabilityAwareDownloads[0];
            if (!download) return null;
            const displayTitle = creativeHistoryDisplayTitle(row);
            const artifactUnavailable =
              creativeHistoryArtifactAvailability(download) === 'unavailable';
            const previewAvailability = creativeHistoryPreviewAvailability({
              download,
              posterUrl: row.posterUrl,
              posterUnavailable: row.posterUnavailable,
              unavailablePosterUrls,
            });
            const cardPresentation = creativeHistoryCardPresentation(previewAvailability);
            const artifactExpired = previewAvailability === 'expired';
            const previewUnavailable = previewAvailability === 'unavailable';
            const audioVerificationBadge = videoAudioVerificationBadge(row.qualityVerification);
            return (
              <article
                key={row.taskId}
                className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-5 rounded-[26px] bg-[var(--creative-surface,#fff)] p-4 shadow-[0_16px_40px_rgba(89,87,87,0.06)]"
              >
                <button
                  type="button"
                  onClick={() => navigate(creativeTaskPath('video', row.taskId))}
                  className={cn(
                    'relative overflow-hidden rounded-[18px] text-left',
                    cardPresentation.compact && 'self-start',
                    softBg,
                  )}
                  style={{ minHeight: cardPresentation.minHeight }}
                >
                  {artifactExpired ? (
                    <div className="flex h-full min-h-[112px] flex-col items-center justify-center px-5 text-center text-[var(--creative-muted,#8B93A6)]">
                      <Clock className="h-6 w-6" aria-hidden />
                      <span className="mt-3 text-[13px] font-semibold text-[var(--creative-ink,#595757)]">
                        文件已过期
                      </span>
                      <span className="mt-1 text-[11px] leading-5">
                        历史记录仍保留，预览与下载已停止。
                      </span>
                    </div>
                  ) : previewUnavailable ? (
                    <div className="flex h-full min-h-[112px] flex-col items-center justify-center px-5 text-center text-[var(--creative-muted,#8B93A6)]">
                      <CircleSlash className="h-6 w-6" aria-hidden />
                      <span className="mt-3 text-[13px] font-semibold text-[var(--creative-ink,#595757)]">
                        {artifactUnavailable ? '文件已失效' : '预览已失效'}
                      </span>
                      <span className="mt-1 text-[11px] leading-5">
                        {artifactUnavailable
                          ? '历史记录仍保留，预览与下载已停止。'
                          : '成片记录仍保留，可在右侧尝试下载。'}
                      </span>
                    </div>
                  ) : row.posterUrl ? (
                    <LazyPosterImg
                      posterUrl={row.posterUrl}
                      alt={displayTitle}
                      className="h-full w-full rounded-[22px] object-cover"
                    />
                  ) : (
                    <div className="flex h-full min-h-[184px] items-center justify-center text-[var(--creative-muted,#ADADAD)]">
                      <Clapperboard className="h-10 w-10" />
                    </div>
                  )}
                  {!artifactExpired && !previewUnavailable ? (
                    <span className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full bg-black/70 px-3 py-2 text-[12px] font-semibold text-white shadow-sm backdrop-blur-sm">
                      <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
                      播放成片
                    </span>
                  ) : null}
                </button>
                <div className="flex min-w-0 flex-col justify-between py-3 pr-3">
                  <div>
                    <div className="mb-5 flex items-center justify-end gap-2">
                      <span className="text-[13px] font-semibold text-[var(--creative-muted,#ADADAD)]">
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
                            ? 'border-[#FF0061]/30 bg-[#FF0061]/10 text-[var(--creative-muted,#FF0061)] focus-visible:ring-[#FF0061]/20'
                            : 'border-[var(--creative-line,#DCDDDD)] bg-[var(--creative-surface,#fff)] text-[var(--creative-muted,#ADADAD)] hover:border-[#FF0061]/30 hover:text-[var(--creative-muted,#FF0061)] focus-visible:ring-[#FF0061]/20',
                        )}
                      >
                        {pinningTaskId === row.taskId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Pin className={cn('h-3.5 w-3.5', row.starred && 'fill-current')} />
                        )}
                      </button>
                    </div>
                    <h2 className="line-clamp-3 text-[15px] font-semibold leading-7 text-[var(--creative-muted,#8B93A6)]">
                      {displayTitle}
                    </h2>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {row.status === 'partial_success' ? (
                        <span className="rounded-full bg-[#FFC910]/20 px-3 py-1 text-[11px] font-medium text-[#8A6A00]">
                          {videoTaskStatusLabel(row.status)}
                        </span>
                      ) : null}
                      {row.qualityVerification?.status === 'passed' ? (
                        <>
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-[#15A371]/10 px-3 py-1 text-[11px] font-medium text-[#0C7A55]"
                            title="已检查视频可播放与抽样画面质量"
                          >
                            <CheckCircle2 className="h-3 w-3" aria-hidden />
                            基础成片检查通过
                          </span>
                          {audioVerificationBadge ? (
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium',
                                audioVerificationBadge.label === '音画同步 AI 复核通过'
                                  ? 'bg-[#15A371]/10 text-[#0C7A55]'
                                  : 'bg-[#FFC910]/15 text-[#806500]',
                              )}
                              title={audioVerificationBadge.title}
                            >
                              {audioVerificationBadge.label === '音画同步 AI 复核通过' ? (
                                <CheckCircle2 className="h-3 w-3" aria-hidden />
                              ) : (
                                <Clock className="h-3 w-3" aria-hidden />
                              )}
                              {audioVerificationBadge.label}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--creative-surface,#F2F3F5)] px-3 py-1 text-[11px] font-medium text-[var(--creative-muted,#737B8C)]">
                          <Clock className="h-3 w-3" aria-hidden />
                          未记录当前基础检查
                        </span>
                      )}
                      {row.videoType ? (
                        <span className="rounded-full bg-[#FF0061]/10 px-3 py-1 text-[11px] font-medium text-[var(--creative-ink,#595757)]">
                          {videoTypeLabel(row.videoType)}
                        </span>
                      ) : null}
                      {download.filename ? (
                        <span
                          className="rounded-full px-3 py-1 text-[11px] font-medium text-[var(--creative-ink,#595757)]"
                          style={{ backgroundColor: `${accent}1A` }}
                        >
                          {fileKindLabel(download.filename)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-5 space-y-2">
                    {canContinueEditing({
                      capabilityEnabled: videoEditingEnabled,
                      artifact: {
                        fileId: download.fileId,
                        mimetype: row.mimetype ?? 'video/mp4',
                        availability: download.unavailable ? 'unavailable' : 'active',
                        expiresAt: download.expiresAt,
                      },
                      taskStatus: row.status,
                    }) ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={editingTaskId !== null}
                        onClick={() => void handleContinueEditing(row, download.fileId)}
                        className="h-9 w-full gap-2 border-[var(--creative-line,#E0D2DF)] bg-[var(--creative-surface,#fff)] text-[var(--creative-muted,#6E5667)] hover:bg-[var(--creative-surface,#FFF7FA)] hover:text-[var(--creative-muted,#C02B66)]"
                      >
                        {editingTaskId === row.taskId ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Scissors className="h-4 w-4" aria-hidden />
                        )}
                        {editingTaskId === row.taskId ? '正在打开…' : '继续剪辑'}
                      </Button>
                    ) : null}
                    {availabilityAwareDownloads.map((item) => (
                      <FileDownloadCard key={item.fileId} payload={item} showPreview={false} />
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {visible !== null &&
      (visibleCount < visible.length || nextCursor !== null || loadMoreError) ? (
        <div className="mt-6 flex flex-col items-center gap-3 border-t border-[var(--creative-line,#EFEFEF)] pt-5">
          {loadMoreError ? (
            <div className="inline-flex items-center gap-2 text-[13px] text-[var(--creative-muted,#8B93A6)]" role="alert">
              <AlertCircle className="h-4 w-4 text-[var(--creative-muted,#FF0061)]" aria-hidden />
              更早作品暂时无法加载，当前内容已保留。
            </div>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading || loadingMore}
            onClick={() => {
              if (visibleCount < visible.length) {
                setVisibleCount((count) =>
                  nextCreativeHistoryVisibleCount(
                    count,
                    visible.length,
                    CREATIVE_HISTORY_VISIBLE_PAGE_SIZE,
                  ),
                );
                return;
              }
              void loadOlderHistory();
            }}
            className="h-9 min-w-[148px] gap-2 rounded-[8px] border-[var(--creative-line,#DCDDDD)] bg-[var(--creative-surface,#fff)] px-4 text-[var(--creative-ink,#595757)] shadow-none hover:border-[#B8BBC2] hover:bg-[var(--creative-surface,#FAFAFA)] hover:text-[var(--creative-ink,#111827)]"
          >
            {loadingMore ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                正在查找…
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" aria-hidden />
                {visibleCount < visible.length
                  ? '显示更多作品'
                  : filter === 'pinned'
                    ? '查找更早置顶作品'
                    : '查找更早作品'}
              </>
            )}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function CurrentVideoTaskPanel({
  taskId,
  task,
}: {
  taskId: string;
  task: UiTask | null;
}): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const refreshTasks = useTaskStore((s) => s.refreshTasks);
  const progress = useTaskStore((s) => s.progressByTask[taskId]);
  const subStatus = useTaskStore((s) => s.subStatusByTask[taskId]?.subStatus);
  const streamingText = useTaskStore((s) => s.streamingByTask[taskId]);
  const awaiting = useTaskStore((s) => s.awaitingUserByTask[taskId]);
  const steps = useTaskStore(selectStepsFor(taskId));
  const selectTask = useTaskStore((s) => s.selectTask);
  const abortTask = useTaskStore((s) => s.abortTask);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [videoEditingEnabled, setVideoEditingEnabled] = React.useState(false);
  const [editingFileId, setEditingFileId] = React.useState<string | null>(null);
  const [actionGuard] = React.useState(createMediaActionGuard);
  const awaitingKind = resolveVideoAwaitingKind(task?.awaitingKind, awaiting?.awaitingKind);
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

  React.useEffect(() => {
    let active = true;
    void trpc.videoEditing.capability.query().then(
      (result) => {
        if (active) setVideoEditingEnabled(result.enabled);
      },
      () => {
        if (active) setVideoEditingEnabled(false);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function continueEditing(attachment: UiTerminalAttachment): Promise<void> {
    if (editingFileId) return;
    setEditingFileId(attachment.fileId);
    try {
      const { projectId } = await createVideoEditingProject({
        sourceFileIds: [attachment.fileId],
        create: (input) => trpc.videoEditing.createProject.mutate(input),
      });
      navigate(`/video/edit/${encodeURIComponent(projectId)}`);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : '暂时无法打开剪辑', 'error');
    } finally {
      setEditingFileId(null);
    }
  }

  async function confirmVideo(choice: 'confirm_video' | 'confirm_image' | 'cancel'): Promise<void> {
    if (!actionGuard.acquire()) return;
    setConfirming(choice);
    try {
      const result = await trpc.tasks.confirmVideo.mutate({ taskId, choice });
      await refreshTasks().catch(() => undefined);
      if (choice === 'cancel') {
        toast.show('已取消，未产生费用', 'info', 2000);
      } else {
        toast.show('已确认，开始制作', 'info', 2000);
        navigate(
          choice === 'confirm_image'
            ? creativeTaskPath('image', result.taskId)
            : creativeTaskPath('video', result.taskId),
        );
      }
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '操作失败，请重试', 'error');
    } finally {
      actionGuard.release();
      setConfirming(null);
    }
  }

  async function cancelTask(): Promise<void> {
    if (!actionGuard.acquire()) return;
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
      actionGuard.release();
      setConfirming(null);
    }
  }

  // A2 retry — re-open the form to re-submit. NOTE: a failed 成片 task does NOT
  // persist its original videoOptions (model/style/aspect) or the pet photo
  // fileId, so a one-click "same-params re-burn" isn't reconstructable from the
  // task alone. We send the user back to the form (cleared ?task=) where the
  // 报价卡→确认制作 flow is the inherent spend confirmation (防误点).
  function retryFailed(): void {
    navigate(creativeRetryPath('video'));
  }

  return (
    <Section
      title="当前制作"
      description="报价确认、制作进度和最终文件都留在本页，不需要跳回任务界面。"
      className="mb-6 rounded-[22px] border-[var(--creative-line,#EFEFEF)] bg-[var(--creative-surface,#fff)] shadow-[0_14px_34px_rgba(17,24,39,0.04)]"
    >
      {!task ? (
        <div className="flex flex-wrap items-center gap-3 py-2 text-[13px] text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-2">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            正在同步视频任务…
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => selectTask(taskId, 'url')}
          >
            重新同步任务
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <VideoStatusIcon status={task.status} />
            <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium text-foreground">
                  {currentMediaTaskTitle(task)}
                </span>
                <span className="rounded-full border border-[var(--creative-line,#DCDDDD)] bg-[var(--creative-surface,#fff)] px-2 py-0.5 text-[11px] text-muted-foreground">
                  {videoTaskStatusLabel(task.status)}
                </span>
              </div>
              {liveText && (
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--creative-ink,#595757)]">
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

          {task.status === 'awaiting_user' && awaitingKind === 'video_quote' && (
            <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[#FFC910]/55 bg-[var(--creative-surface,#fff)] px-3 py-3 text-[12px]">
              <span className="mr-auto text-muted-foreground">确认后才会开始制作并消耗额度。</span>
              <Button
                type="button"
                size="sm"
                onClick={() => void confirmVideo('confirm_video')}
                disabled={confirming !== null}
              >
                {confirming === 'confirm_video' ? '提交中…' : '确认制作'}
              </Button>
              {/* B2 — 真人换口型没法降级成静图，ip_person 不出「图片版」。 */}
              {showImageOption(task.videoType) && (
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
            awaitingKind !== 'video_quote' && (
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
            <div className="rounded-[8px] border border-[#FF0061]/30 bg-[#FF0061]/5 px-3 py-3 text-[12px]">
              <div className="text-[13px] font-medium text-[var(--creative-muted,#FF0061)]">生成失败</div>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed text-[var(--creative-ink,#595757)]">
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
            <div className="space-y-2 border-t border-[var(--creative-line,#DCDDDD)]/70 pt-3">
              <div className="text-[11px] font-medium text-muted-foreground">产出文件</div>
              {task.attachments.map((attachment) => {
                const showContinueEditing = canContinueEditing({
                  capabilityEnabled: videoEditingEnabled,
                  artifact: {
                    fileId: attachment.fileId,
                    mimetype: attachment.mimetype,
                    availability:
                      attachment.availability === 'unavailable' ? 'unavailable' : 'active',
                    expiresAt: attachment.expiresAt,
                  },
                  taskStatus: task.status,
                });
                return (
                  <div key={attachment.fileId} className="space-y-2">
                    <FileDownloadCard payload={currentMediaDownloadPayload(attachment)} />
                    {showContinueEditing ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={editingFileId !== null}
                        onClick={() => void continueEditing(attachment)}
                        className="h-9 gap-2 border-[var(--creative-line,#E0D2DF)] bg-[var(--creative-surface,#fff)] text-[var(--creative-muted,#6E5667)] hover:bg-[var(--creative-surface,#FFF7FA)] hover:text-[var(--creative-muted,#C02B66)]"
                      >
                        {editingFileId === attachment.fileId ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Scissors className="h-4 w-4" aria-hidden />
                        )}
                        {editingFileId === attachment.fileId ? '正在打开…' : '继续剪辑'}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
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
  { value: 'veo_fast', label: 'Veo 3.1 Fast', hint: '推荐 · 性价比' },
  { value: 'happyhorse', label: 'Happy Horse 1.1', hint: '自带音效' },
  { value: 'veo_standard', label: 'Veo 3.1 Standard', hint: '高质量' },
  { value: 'wanxiang', label: 'Wan 2.7', hint: '国内直连 · 低成本' },
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

export function NormalVideoForm({
  onTaskCreated,
}: { onTaskCreated: (taskId: string) => void }): JSX.Element {
  const toast = useToast();
  const createTask = useTaskStore((s) => s.createTask);

  const [prompt, setPrompt] = React.useState('');
  const [model, setModel] = React.useState<NormalVideoModel>('veo_fast');
  const mediaModels = useMediaModels();
  const modelOptions = React.useMemo(
    () => filterAvailableOptions(MODEL_OPTIONS, mediaModels?.video),
    [mediaModels],
  );
  React.useEffect(() => {
    const first = modelOptions[0];
    if (first && !modelOptions.some((option) => option.value === model)) setModel(first.value);
  }, [model, modelOptions]);
  const [style, setStyle] = React.useState<VideoStyleOption>('auto');
  const [aspectRatio, setAspectRatio] = React.useState<VideoAspect>('9:16');
  const [resolution, setResolution] = React.useState<VideoResolution>('1080p');
  const [durationSeconds, setDurationSeconds] = React.useState<VideoDuration>(8);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitGuard] = React.useState(createMediaActionGuard);

  const perSegCny = estimatePerSegmentCny({ model, resolution, durationSeconds });
  const estVideoCny = perSegCny * SEG_ESTIMATE;
  const estImageCny = Math.ceil(SEG_ESTIMATE * NB_USD_PER_IMG * USD_TO_CNY);

  async function handleSubmit(): Promise<void> {
    const intent = prompt.trim();
    if (intent.length < 4) {
      toast.show('请先写一段文案或想法(至少 4 个字)', 'error');
      return;
    }
    if (!submitGuard.acquire()) return;
    setSubmitting(true);
    const opts: VideoCreationOptions = {
      tab: 'normal',
      model,
      style,
      aspectRatio,
      resolution,
      durationSeconds,
    };
    try {
      const res = await createTask(
        intent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        opts,
      );
      if ('error' in res) {
        toast.show(res.error || '提交失败,请重试', 'error');
        return;
      }
      toast.show('已提交,请在本页确认报价后开始制作', 'info', 3500);
      onTaskCreated(res.taskId);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '提交失败,请重试', 'error');
    } finally {
      submitGuard.release();
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
          <SegGroup label="模型" value={model} options={modelOptions} onChange={setModel} />
          <SegGroup label="风格" value={style} options={STYLE_OPTIONS} onChange={setStyle} />
          <SegGroup
            label="尺寸"
            value={aspectRatio}
            options={ASPECT_OPTIONS}
            onChange={setAspectRatio}
          />
          <SegGroup
            label="画质"
            value={resolution}
            options={RES_OPTIONS}
            onChange={setResolution}
          />
          <SegGroup
            label="时长"
            value={durationSeconds}
            options={DURATION_OPTIONS}
            onChange={setDurationSeconds}
          />
        </div>
      </Section>

      <Section title="价格预览" className={CREATIVE_PRICE_SECTION_CLASS}>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <span className="text-2xl font-semibold text-[var(--creative-muted,#FF0061)]">约 ¥{estVideoCny}</span>
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
          <span className="font-medium text-[var(--creative-ink,#595757)]"> 提交后会先给精确报价,确认后才扣费。</span>
        </p>
      </Section>

      <div className="flex items-center justify-end gap-3">
        <span className="text-[12px] text-muted-foreground">提交后先报价,不会立即扣费</span>
        <Button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
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
  modelControl,
  projectAction,
}: {
  onTaskCreated: (taskId: string) => void;
  modelControl?: React.ReactNode;
  projectAction?: React.ReactNode;
  model: VideoModel;
}): JSX.Element {
  const toast = useToast();
  const createTask = useTaskStore((s) => s.createTask);

  const [prompt, setPrompt] = React.useState('');
  const [photo, setPhoto] = React.useState<{
    fileId: string;
    name: string;
    previewUrl: string;
  } | null>(null);
  const [referenceVideo, setReferenceVideo] = React.useState<{
    fileId: string;
    name: string;
    previewUrl: string;
    durationSeconds?: number;
  } | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = React.useState(false);
  const [uploadingVideo, setUploadingVideo] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitGuard] = React.useState(createMediaActionGuard);
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
    if (!submitGuard.acquire()) return;
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
      const res = await createTask(
        finalIntent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        opts,
      );
      if ('error' in res) {
        toast.show(res.error || '提交失败,请重试', 'error');
        return;
      }
      toast.show('已提交,请在本页确认报价后开始制作', 'info', 3500);
      onTaskCreated(res.taskId);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '提交失败,请重试', 'error');
    } finally {
      submitGuard.release();
      setSubmitting(false);
    }
  }

  return (
    <div className="hd-special-mode">
      <header className="hd-mode-intro"><h2>让主角，走进这段画面。</h2><p>动作、镜头、节奏与音频跟随参考视频。</p></header>
      <input ref={photoRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => void handlePickPhoto(e)} />
      <input ref={videoRef} type="file" accept={CREATIVE_ACCEPT_REFERENCE_VIDEO} className="hidden" onChange={e => void handlePickReferenceVideo(e)} />
      <div className="hd-required-assets">
        <div className="hd-asset-container">
          <button type="button" className="hd-asset-slot" onClick={()=>photoRef.current?.click()} disabled={uploadingPhoto || submitting} title="上传一位真人或写实虚构人物的清晰照片；当前模型仅支持单人换单人，取景和身体比例相近；暂不支持宠物、物体或多人替换。">
            {photo ? <img src={photo.previewUrl} alt="主角照片预览" /> : <ImagePlus />}
            <span><strong>{uploadingPhoto ? '上传中…' : photo ? '主角照片 · 已添加' : '主角照片'}</strong><small>{photo?.name ?? '单人清晰照片 · JPG / PNG / WebP'}</small></span>
          </button>
          {photo && <button type="button" className="hd-asset-remove" onClick={removePhoto} disabled={submitting} title="移除主角照片" aria-label="移除主角照片"><X /></button>}
        </div>
        <div className="hd-asset-container">
          <button type="button" className="hd-asset-slot" onClick={()=>videoRef.current?.click()} disabled={uploadingVideo || submitting}>
            <VideoIcon /><span><strong>{uploadingVideo ? '上传中…' : referenceVideo ? '参考视频 · 已添加' : '参考视频'}</strong><small>{referenceVideo?.name ?? '2–30秒 · MP4 / MOV · 不超过200MB'}</small></span>
          </button>
          {referenceVideo && <><button type="button" className="hd-asset-remove" onClick={removeReferenceVideo} disabled={submitting} title="移除参考视频" aria-label="移除参考视频"><X /></button><video className="hd-reference-video-preview" src={referenceVideo.previewUrl} controls playsInline onLoadedMetadata={event => {const duration=event.currentTarget.duration;setReferenceVideo(current=>current&&Number.isFinite(duration)?{...current,durationSeconds:duration}:current);}} /></>}
        </div>
      </div>
      {modelControl}
      <section className="hd-video-brief" aria-label="动作复刻创作要求" data-creative-composer>
        <div className="hd-composer-source">{projectAction}<span>动作与节奏跟随参考</span></div>
        <Textarea value={prompt} onChange={e=>setPrompt(e.target.value)} aria-label="动作复刻备注" placeholder="可以补充用途或备注，不会改变参考视频的动作与节奏…" className="hd-media-prompt" />
        <div className="hd-media-bottom"><div className="hd-media-tools">
          <button type="button" className="hd-glass-pill" onClick={()=>photoRef.current?.click()} disabled={uploadingPhoto || submitting}><ImagePlus />主角照片</button>
          <button type="button" className="hd-glass-pill" onClick={()=>videoRef.current?.click()} disabled={uploadingVideo || submitting}><VideoIcon />参考视频</button>
          <span className="hd-glass-pill">跟随参考 · 原始规格</span>
        </div><div className="hd-creative-generation-actions"><button type="button" className="hd-generate" disabled={submitting || uploadingPhoto || uploadingVideo} onClick={()=>void handleSubmit()}><span>{submitting ? '提交中…' : '准备生成'}</span></button><small className="hd-quote-hint" title={`${selectedCloneModel.name} ${selectedCloneModel.version} 基础估价；服务端检查声音后确认最终报价，确认后才开始生成。`}>{estCny === null ? '添加素材后估价' : `约 ¥${estCny} 起 · 确认后生成`}</small></div></div>
      </section>
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
      <div className="w-12 shrink-0 text-[13px] font-semibold text-[var(--creative-muted,#8B93A6)]">{label}</div>
      <div className="flex flex-wrap gap-1 rounded-[10px] bg-[var(--creative-surface,#EFEFEF)]/70 p-1">
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
                  ? 'bg-[var(--creative-surface,#fff)] text-[var(--creative-muted,#FF0061)] shadow-[0_1px_4px_rgba(15,23,42,0.08)]'
                  : 'text-[var(--creative-ink,#111827)] hover:bg-white/60 hover:text-[var(--creative-muted,#FF0061)]',
              )}
            >
              {o.label}
              {o.hint && (
                <span
                  className={cn(
                    'text-[11px]',
                    active ? 'text-[var(--creative-muted,#FF0061)]/70' : 'text-muted-foreground',
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
      <span className={cn(base, 'border-[#FF0061]/45 bg-[#FF0061]/10 text-[var(--creative-muted,#FF0061)]')}>
        <XCircle className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (iconKind === 'inactive') {
    return (
      <span className={cn(base, 'border-[var(--creative-line,#DCDDDD)] bg-[var(--creative-surface,#EFEFEF)]/45 text-muted-foreground')}>
        <CircleSlash className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (iconKind === 'success') {
    return (
      <span className={cn(base, 'border-[var(--creative-line,#DCDDDD)] bg-[var(--creative-surface,#fff)] text-[var(--creative-muted,#FF0061)]')}>
        <CheckCircle2 className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span className={cn(base, 'border-[var(--creative-line,#DCDDDD)] bg-[var(--creative-surface,#fff)] text-[var(--creative-ink,#595757)]')}>
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
// 两个必要前提:已获授权的声音(克隆) + 出镜底版。授权声明放在生成前确认。
// ---------------------------------------------------------------------------

export const IP_ASSET_AUTHORIZATION_COPY =
  '我确认：口播所用的声音和出镜底版属于本人、已获合法授权，或为我拥有使用权的虚构 AI 资产；勾选即表示同意';

interface OnboardingStatus {
  hasVoice: boolean;
  hasBaseVideo: boolean;
  authorized: boolean;
  baseVideoIssue: 'unavailable' | null;
}

export function IpOnboardingWizard({
  onTaskCreated,
  modelControl,
  projectAction,
}: {
  onTaskCreated: (taskId: string) => void;
  modelControl?: React.ReactNode;
  projectAction?: React.ReactNode;
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
  const loadRequestRef = React.useRef(0);

  const load = React.useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoadError(false);
    try {
      const s = await trpc.videoOnboarding.status.query();
      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      setStatus({
        hasVoice: s.hasVoice,
        hasBaseVideo: s.hasBaseVideo,
        authorized: s.authorized,
        baseVideoIssue: s.baseVideoIssue,
      });
    } catch {
      if (!mountedRef.current || requestId !== loadRequestRef.current) return;
      setLoadError(true);
      setStatus({
        hasVoice: false,
        hasBaseVideo: false,
        authorized: false,
        baseVideoIssue: null,
      });
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
    if (!file || clearing) return;
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
    if (!file || clearing) return;
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
    if (clearing || uploadingVoice || uploadingVideo) return;
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
    <div className="hd-special-mode">
      <header className="hd-mode-intro"><h2>让你的角色，开口表达。</h2><p>准备声音与出镜底版，再写下口播文案。</p></header>
      <input ref={voiceRef} type="file" accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4" className="hidden" onChange={e=>void handleVoice(e)} />
      <input ref={videoRef} type="file" accept=".mp4,.mov,video/mp4,video/quicktime" className="hidden" onChange={e=>void handleVideo(e)} />
      {loadError && <div role="status" className="hd-mode-help">素材状态同步失败，请重试后再生成。<button type="button" className="hd-glass-pill" onClick={()=>void load()}>重试同步</button></div>}
      <div className="hd-required-assets">
        <button type="button" className="hd-asset-slot" onClick={()=>voiceRef.current?.click()} disabled={uploadingVoice || clearing} title="上传声音样本；用完即弃，只保留声纹。已有声音时点击重新上传。"><Mic /><span><strong>{uploadingVoice ? '上传并克隆…' : status.hasVoice ? '声音素材 · 已就绪' : '声音素材'}</strong><small>10–20秒清晰人声 · WAV / MP3 / M4A</small></span>{status.hasVoice && <Check className="hd-asset-ready" />}</button>
        <button type="button" className="hd-asset-slot" onClick={()=>videoRef.current?.click()} disabled={uploadingVideo || clearing} title="上传出镜视频；正脸、单人、光线均匀、嘴部无遮挡。已有底版时点击重新上传。"><VideoIcon /><span><strong>{uploadingVideo ? '上传中…' : status.hasBaseVideo ? '出镜底版 · 已就绪' : '出镜底版'}</strong><small>{status.baseVideoIssue === 'unavailable' ? '原出镜底版不可用，请重新上传' : '10–60秒竖屏口播 · MP4 / MOV'}</small></span>{status.hasBaseVideo && <Check className="hd-asset-ready" />}</button>
      </div>
      {modelControl}
      <IpGenerateForm onTaskCreated={onTaskCreated} projectAction={projectAction} ready={ready && !loadError && !uploadingVoice && !uploadingVideo && !clearing} onPickVoice={()=>voiceRef.current?.click()} onPickVideo={()=>videoRef.current?.click()} />
      <details className="hd-asset-management"><summary>隐私与素材管理</summary><p>声音样本在克隆出声纹后即刻删除；出镜底版加密存储，仅用于已确认授权的视频。清除会删除云端声纹、底版和授权记录。</p><Button variant="outline" size="sm" onClick={()=>void handleClear()} disabled={!anyAsset || clearing || uploadingVoice || uploadingVideo}>{clearing ? '清除中…' : '清除全部 IP 素材'}</Button></details>
    </div>
  );
}

function IpGenerateForm({
  onTaskCreated, ready, onPickVoice, onPickVideo, projectAction,
}: {
  onTaskCreated: (taskId: string) => void;
  ready: boolean;
  projectAction?: React.ReactNode;
  onPickVoice: () => void;
  onPickVideo: () => void;
}): JSX.Element {
  const toast = useToast();
  const createTask = useTaskStore((s) => s.createTask);
  const [copy, setCopy] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [submitGuard] = React.useState(createMediaActionGuard);
  // ① 合规闸 — per-generate 授权确认。与 onboarding 的一次性 consent 双保险:
  // 每次生成都要重新勾(默认 false),不勾禁止提交。
  const [consent, setConsent] = React.useState(false);

  const est = estimateIpVideo(copy);

  async function handleSubmit(): Promise<void> {
    if (!ready) return;
    const intent = copy.trim();
    if (intent.length < 4) {
      toast.show('请先写一段要口播的文案(至少 4 个字)', 'error');
      return;
    }
    if (!consent) {
      toast.show('请先确认声音和出镜底版的使用授权', 'error');
      return;
    }
    if (!submitGuard.acquire()) return;
    setSubmitting(true);
    const finalIntent = buildIpVideoIntent(intent);
    const opts: VideoCreationOptions = {
      tab: 'ip_person',
      aspectRatio: IP_VIDEO_ASPECT_RATIO,
    };
    try {
      await trpc.videoOnboarding.authorize.mutate();
      const res = await createTask(
        finalIntent,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        opts,
      );
      if ('error' in res) {
        toast.show(res.error || '提交失败,请重试', 'error');
        return;
      }
      toast.show('已提交,请在本页确认报价后开始制作', 'info', 3500);
      setConsent(false);
      onTaskCreated(res.taskId);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '提交失败,请重试', 'error');
    } finally {
      submitGuard.release();
      setSubmitting(false);
    }
  }

  return (
    <div className="hd-ip-generation">
      <section className="hd-video-brief" aria-label="人物口播创作要求" data-creative-composer>
        <div className="hd-composer-source">{projectAction}<span>{ready ? '声音与出镜底版已就绪' : '先准备声音素材与出镜底版'}</span></div>
        <Textarea value={copy} onChange={e=>setCopy(e.target.value)} aria-label="口播文案" placeholder="写下希望角色说出的文案，语气、停顿也可以一起说明…" className="hd-media-prompt" />
        <div className="hd-media-bottom"><div className="hd-media-tools"><button type="button" className="hd-glass-pill" onClick={onPickVoice}><Mic />声音素材</button><button type="button" className="hd-glass-pill" onClick={onPickVideo}><VideoIcon />出镜底版</button><span className="hd-glass-pill">9:16 · 随文案 · 底版规格</span></div><div className="hd-creative-generation-actions"><button type="button" className="hd-generate" onClick={()=>void handleSubmit()} disabled={submitting || !consent || !ready}><span>{submitting ? '提交中…' : '准备生成'}</span></button><small className="hd-quote-hint">{copy.trim() ? `约 ¥${est.videoCny} · 确认后生成` : '添加文案后估价'}</small></div></div>
        {est.maybeTooLong && <p className="hd-mode-help" role="status">文案偏长，可能超过40秒上限；请适当截短。</p>}
      </section>
      <label className="hd-presenter-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} /><span>{IP_ASSET_AUTHORIZATION_COPY}<Link to="/terms" target="_blank">《服务条款》</Link>与<Link to="/privacy" target="_blank">《隐私政策》</Link>。</span></label>
    </div>
  );
}

export default VideoPage;
