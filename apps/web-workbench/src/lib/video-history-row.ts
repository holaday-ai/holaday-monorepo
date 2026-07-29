import type { FileDownloadPayload } from '@/components/FileDownloadCard';
import {
  type DownloadFileAvailability,
  downloadFileAvailability,
} from '@/lib/file-download-card-copy';

/**
 * Pure helpers for the /video 生成历史 list. Extracted from VideoPage so
 * the "only downloadable 成片 show up" filter is unit-testable without a DOM.
 */

/** Backend-stamped 成片 type (deriveVideoType in video-confirm-meta.ts). */
export type VideoType = 'normal' | 'pet' | 'ip_person';
const CURRENT_VIDEO_QUALITY_GATE_VERSION = 'video-final-v4';
const SUPPORTED_VIDEO_QUALITY_GATE_VERSIONS = new Set([
  'video-final-v3',
  CURRENT_VIDEO_QUALITY_GATE_VERSION,
]);
export type CreativeHistoryMode = 'video' | 'image';
export type CreativeHistoryFilter = 'all' | 'recent' | 'pinned';
export type CreativeHistoryTerminalStatus = 'completed' | 'partial_success';

export interface CreativeHistoryListInput {
  limit: number;
  cursor?: number;
  status: CreativeHistoryTerminalStatus[];
  starred?: true;
  dateFrom?: Date;
}

export function creativeHistoryListInput(
  filter: CreativeHistoryFilter,
  cursor?: number,
  now = Date.now(),
): CreativeHistoryListInput {
  return {
    limit: 50,
    ...(cursor === undefined ? {} : { cursor }),
    status: ['completed', 'partial_success'],
    ...(filter === 'pinned' ? { starred: true as const } : {}),
    ...(filter === 'recent' ? { dateFrom: new Date(now - 7 * 24 * 60 * 60 * 1000) } : {}),
  };
}

export interface VideoResultMeta {
  lane?: string;
  executionMode?: string;
  finalExecutionMode?: string;
  visualMode?: string;
  videoType?: string;
  qualityVerification?: {
    status?: string;
    gateVersion?: string;
    verifiedAt?: string;
    coverage?: {
      playableVideo?: string;
      sampledFrames?: string;
      audibleAudio?: string;
      audiovisualSync?: string;
      lipSyncProcessing?: string;
    };
    audiovisualSyncReview?: {
      model?: string;
      evidence?: ReadonlyArray<{
        startSeconds?: number;
        endSeconds?: number;
      }>;
    };
  };
  attachments?: ReadonlyArray<{
    fileId?: string;
    downloadUrl?: string;
    filename?: string;
    mimetype?: string;
    sizeBytes?: number;
    posterUrl?: string;
    expiresAt?: string;
    availability?: 'unavailable';
    posterAvailability?: 'unavailable';
  }>;
}

export interface VideoRow {
  taskId: string;
  intent: string;
  title: string | null;
  status: string;
  createdAt: string | number | Date;
  download?: FileDownloadPayload;
  /** Backend-stamped type — drives per-tab history isolation + the type chip. */
  videoType?: VideoType;
  /** First-frame poster (R2, Bearer-gated) — rendered as a lazy thumbnail. */
  posterUrl?: string;
  /** Server confirmed the separate poster file is no longer available. */
  posterUnavailable?: boolean;
  /** Server-persisted task pin state, reused by the creative history surface. */
  starred?: boolean;
  starredAt?: string | number | Date | null;
  /** Present only when the current final-video quality gate passed. */
  qualityVerification?: {
    status: 'passed';
    gateVersion: string;
    verifiedAt: string;
    coverage?: {
      playableVideo: 'verified';
      sampledFrames: 'verified';
      audibleAudio: 'verified' | 'not_verified';
      audiovisualSync: 'verified_ai' | 'not_verified' | 'not_applicable';
      lipSyncProcessing?: 'completed' | 'not_applicable';
    };
    audiovisualSyncReview?: {
      model: string;
      evidence: Array<{
        startSeconds: number;
        endSeconds: number;
      }>;
    };
  };
}

export interface VideoAudioVerificationBadge {
  label: '音画同步 AI 复核通过' | '口型已处理 · 准确度待确认' | '音画同步未验证';
  title: string;
}

export function videoAudioVerificationBadge(
  verification: VideoRow['qualityVerification'],
): VideoAudioVerificationBadge | null {
  const coverage = verification?.coverage;
  if (
    verification?.status === 'passed' &&
    coverage?.audibleAudio === 'verified' &&
    coverage.audiovisualSync === 'verified_ai' &&
    coverage.lipSyncProcessing === 'completed' &&
    verification.audiovisualSyncReview?.evidence.length
  ) {
    const windows =
      verification.audiovisualSyncReview?.evidence
        .map(({ startSeconds, endSeconds }) => `${startSeconds}–${endSeconds} 秒`)
        .join('、') ?? '';
    return {
      label: '音画同步 AI 复核通过',
      title: `独立多模态模型已检查声音和嘴部运动；证据时间窗：${windows}。这是自动复核，不替代人工逐帧验收`,
    };
  }
  if (
    verification?.status !== 'passed' ||
    coverage?.audibleAudio !== 'verified' ||
    coverage.audiovisualSync !== 'not_verified'
  ) {
    return null;
  }
  return coverage.lipSyncProcessing === 'completed'
    ? {
        label: '口型已处理 · 准确度待确认',
        title:
          '口型同步供应商已完成处理；当前自动检查确认了可听声音，但尚未独立验证声音与嘴形是否准确同步',
      }
    : {
        label: '音画同步未验证',
        title: '当前自动检查确认了可听声音，但尚未独立验证声音与嘴形同步',
      };
}

export function creativeHistoryArtifactAvailability(
  download: Pick<FileDownloadPayload, 'expiresAt' | 'unavailable'> | undefined,
  now = Date.now(),
): DownloadFileAvailability {
  if (download?.unavailable === true) return 'unavailable';
  return downloadFileAvailability(download?.expiresAt, now);
}

export type CreativeHistoryPreviewAvailability =
  | 'available'
  | 'expired'
  | 'unavailable'
  | 'missing';

export function creativeHistoryPreviewAvailability(options: {
  download: Pick<FileDownloadPayload, 'expiresAt' | 'unavailable'> | undefined;
  posterUrl?: string;
  posterUnavailable?: boolean;
  unavailablePosterUrls: ReadonlySet<string>;
  now?: number;
}): CreativeHistoryPreviewAvailability {
  const artifactAvailability = creativeHistoryArtifactAvailability(options.download, options.now);
  if (artifactAvailability === 'expired') {
    return 'expired';
  }
  if (artifactAvailability === 'unavailable') return 'unavailable';
  if (options.posterUnavailable === true) return 'unavailable';
  if (!options.posterUrl) return 'missing';
  return options.unavailablePosterUrls.has(options.posterUrl) ? 'unavailable' : 'available';
}

export interface CreativeHistoryLoadState {
  rows: VideoRow[] | null;
  loading: boolean;
  error: boolean;
}

export type CreativeHistoryLoadAction =
  | { type: 'reset' }
  | { type: 'start' }
  | { type: 'success'; rows: VideoRow[] }
  | { type: 'append'; rows: VideoRow[] }
  | { type: 'failure' }
  | {
      type: 'update_pin';
      taskId: string;
      starred: boolean;
      starredAt: VideoRow['starredAt'];
    };

export function creativeHistoryLoadReducer(
  state: CreativeHistoryLoadState,
  action: CreativeHistoryLoadAction,
): CreativeHistoryLoadState {
  switch (action.type) {
    case 'reset':
      return { rows: null, loading: false, error: false };
    case 'start':
      return { ...state, loading: true, error: false };
    case 'success':
      return { rows: action.rows, loading: false, error: false };
    case 'append':
      return {
        ...state,
        rows: mergeCreativeHistoryRows(state.rows ?? [], action.rows),
      };
    case 'failure':
      return { ...state, loading: false, error: true };
    case 'update_pin':
      return {
        ...state,
        rows:
          state.rows?.map((row) =>
            row.taskId === action.taskId
              ? {
                  ...row,
                  starred: action.starred,
                  starredAt: action.starredAt,
                }
              : row,
          ) ?? null,
      };
  }
}

export function mergeCreativeHistoryRows(
  current: readonly VideoRow[],
  incoming: readonly VideoRow[],
): VideoRow[] {
  const seen = new Set(current.map((row) => row.taskId));
  return [
    ...current,
    ...incoming.filter((row) => {
      if (seen.has(row.taskId)) return false;
      seen.add(row.taskId);
      return true;
    }),
  ];
}

export function nextCreativeHistoryVisibleCount(
  current: number,
  total: number,
  pageSize = 4,
): number {
  return Math.min(total, current + pageSize);
}

export function canChangeCreativeHistoryFilter(pinningTaskId: string | null): boolean {
  return pinningTaskId === null;
}

export function canLoadOlderCreativeHistory(options: {
  loading: boolean;
  loadingMore: boolean;
  nextCursor: number | null;
}): boolean {
  return !options.loading && !options.loadingMore && options.nextCursor !== null;
}

export function isVideoLane(lane: string | undefined): boolean {
  return typeof lane === 'string' && lane.startsWith('video_creation');
}

export function isImageLane(meta: VideoResultMeta | undefined): boolean {
  return meta?.executionMode === 'image' || meta?.finalExecutionMode === 'image';
}

/** Narrow an unknown metadata.videoType to the enum, else undefined. */
export function asVideoType(value: unknown): VideoType | undefined {
  return value === 'normal' || value === 'pet' || value === 'ip_person' ? value : undefined;
}

function asAudioVisualSyncReview(
  value: NonNullable<VideoResultMeta['qualityVerification']>['audiovisualSyncReview'],
): NonNullable<NonNullable<VideoRow['qualityVerification']>['audiovisualSyncReview']> | undefined {
  if (
    typeof value?.model !== 'string' ||
    value.model.length === 0 ||
    value.model.length > 100 ||
    !Array.isArray(value.evidence)
  ) {
    return undefined;
  }
  const evidence = value.evidence
    .map(({ startSeconds, endSeconds }) => ({ startSeconds, endSeconds }))
    .filter(
      (
        window,
      ): window is {
        startSeconds: number;
        endSeconds: number;
      } =>
        Number.isFinite(window.startSeconds) &&
        Number.isFinite(window.endSeconds) &&
        typeof window.startSeconds === 'number' &&
        typeof window.endSeconds === 'number' &&
        window.startSeconds >= 0 &&
        window.endSeconds > window.startSeconds,
    )
    .sort(
      (left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds,
    )
    .slice(0, 8);
  if (evidence.length === 0) return undefined;
  for (let index = 1; index < evidence.length; index += 1) {
    const previous = evidence[index - 1];
    const current = evidence[index];
    if (!previous || !current || current.startSeconds < previous.endSeconds) return undefined;
  }
  return { model: value.model, evidence };
}

function asPassedQualityVerification(
  value: VideoResultMeta['qualityVerification'],
): VideoRow['qualityVerification'] {
  if (
    value?.status !== 'passed' ||
    typeof value.gateVersion !== 'string' ||
    !SUPPORTED_VIDEO_QUALITY_GATE_VERSIONS.has(value.gateVersion) ||
    typeof value.verifiedAt !== 'string' ||
    value.verifiedAt.length === 0
  ) {
    return undefined;
  }
  const audibleAudio = value.coverage?.audibleAudio;
  const audiovisualSync = value.coverage?.audiovisualSync;
  const lipSyncProcessing = value.coverage?.lipSyncProcessing;
  const normalizedLipSyncProcessing =
    lipSyncProcessing === 'completed' || lipSyncProcessing === 'not_applicable'
      ? lipSyncProcessing
      : undefined;
  const audiovisualSyncReview = asAudioVisualSyncReview(value.audiovisualSyncReview);
  const hasLegalAudioCoverage =
    (value.gateVersion === CURRENT_VIDEO_QUALITY_GATE_VERSION &&
      audibleAudio === 'verified' &&
      audiovisualSync === 'verified_ai' &&
      lipSyncProcessing === 'completed' &&
      audiovisualSyncReview !== undefined) ||
    (audibleAudio === 'verified' &&
      audiovisualSync === 'not_verified' &&
      (lipSyncProcessing === undefined || lipSyncProcessing === 'completed')) ||
    (audibleAudio === 'not_verified' &&
      audiovisualSync === 'not_applicable' &&
      (lipSyncProcessing === undefined || lipSyncProcessing === 'not_applicable'));
  const coverage:
    | NonNullable<NonNullable<VideoRow['qualityVerification']>['coverage']>
    | undefined =
    value.coverage?.playableVideo === 'verified' &&
    value.coverage.sampledFrames === 'verified' &&
    hasLegalAudioCoverage
      ? {
          playableVideo: 'verified' as const,
          sampledFrames: 'verified' as const,
          audibleAudio: audibleAudio as 'verified' | 'not_verified',
          audiovisualSync: audiovisualSync as 'verified_ai' | 'not_verified' | 'not_applicable',
          ...(normalizedLipSyncProcessing
            ? { lipSyncProcessing: normalizedLipSyncProcessing }
            : {}),
        }
      : undefined;
  return {
    status: 'passed',
    gateVersion: value.gateVersion,
    verifiedAt: value.verifiedAt,
    ...(coverage ? { coverage } : {}),
    ...(coverage?.audiovisualSync === 'verified_ai' && audiovisualSyncReview
      ? { audiovisualSyncReview }
      : {}),
  };
}

const IP_ONBOARDING_COPY_MARKERS = [
  '声音样本在克隆出声纹后',
  '出镜底版加密存储',
  '云端声纹 + 出镜底版 + 授权记录',
] as const;

const CLONE_VIDEO_ROUTING_COPY =
  '复刻视频：使用上传照片替换参考视频中的主角，并保留参考视频的动作、镜头、节奏和音频。';
const CLONE_VIDEO_NOTE_PREFIX = '任务备注（仅用于记录，不改变本次模型输入）：';

function isIpOnboardingCopy(value: string): boolean {
  return IP_ONBOARDING_COPY_MARKERS.filter((marker) => value.includes(marker)).length >= 2;
}

function inferCreativeVideoType({
  explicitType,
  filename,
  intent,
  title,
}: {
  explicitType: unknown;
  filename: string;
  intent: string;
  title?: string | null;
}): VideoType | undefined {
  const explicit = asVideoType(explicitType);
  if (explicit) return explicit;
  if (/^holaday-ip-video\.mp4$/i.test(filename)) return 'ip_person';
  const visibleCopy = `${title ?? ''}\n${intent}`;
  if (isIpOnboardingCopy(visibleCopy)) return 'ip_person';
  if (visibleCopy.includes(CLONE_VIDEO_ROUTING_COPY)) return 'pet';
  return undefined;
}

/**
 * Whether the 「图片版」 (confirm_image) option should show on a video_quote
 * card (B2). Static image is meaningless for 真人换口型 (you can't lip-sync a
 * still), so hide it for ip_person only — normal/pet keep it. Unknown type
 * (legacy / not-yet-hydrated) defaults to showing it (safe: only IP hides).
 */
export function showImageOption(videoType: VideoType | undefined): boolean {
  return videoType !== 'ip_person';
}

/**
 * Map a tasks.list row to a 生成历史 entry, or null to drop it.
 *
 * 生成历史显示已经产出真实文件的成片任务：`completed` / `partial_success`
 * 且带一条可下载附件。其余一律 drop：失败 / 取消 / `awaiting_user`（报价卡
 * stub，lane `video_creation_consumed`）/ `executing`（生成中）。这样失败任务
 * （如人脸检测失败的那条）和报价 stub 不再混进历史列表，同时不把“需复核但
 * 已有产物”的任务藏起来。
 */
export function toVideoRow(raw: unknown): VideoRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as {
    taskId?: string;
    intent?: string;
    title?: string | null;
    status?: string;
    createdAt?: string | number | Date;
    starred?: boolean;
    starredAt?: string | number | Date | null;
    result?: { metadata?: VideoResultMeta } | null;
  };
  const meta = r.result?.metadata;
  if (!isVideoLane(meta?.lane)) return null;
  if (!r.taskId || !r.status) return null;
  if (!isDownloadableTerminalOutput(r.status)) return null;
  const att = meta?.attachments?.find(
    (a) => a.fileId && a.downloadUrl && a.filename && typeof a.sizeBytes === 'number',
  );
  if (!att?.fileId || !att.downloadUrl || !att.filename || typeof att.sizeBytes !== 'number') {
    return null;
  }
  const downloadUrl = normaliseAttachmentDownloadUrl(att.downloadUrl);
  if (!downloadUrl) return null;
  const videoType = inferCreativeVideoType({
    explicitType: meta?.videoType,
    filename: att.filename,
    intent: r.intent ?? '',
    title: r.title,
  });
  const posterUrl =
    typeof att.posterUrl === 'string' && att.posterUrl.length > 0
      ? (normaliseAttachmentDownloadUrl(att.posterUrl) ?? undefined)
      : undefined;
  const qualityVerification = asPassedQualityVerification(meta?.qualityVerification);
  return {
    taskId: r.taskId,
    intent: r.intent ?? '',
    title: r.title ?? null,
    status: r.status,
    createdAt: r.createdAt ?? new Date(),
    download: {
      fileId: att.fileId,
      downloadUrl,
      filename: att.filename,
      size: att.sizeBytes,
      ...(typeof att.expiresAt === 'string' ? { expiresAt: att.expiresAt } : {}),
      ...(att.availability === 'unavailable' ? { unavailable: true } : {}),
    },
    ...(videoType ? { videoType } : {}),
    ...(posterUrl ? { posterUrl } : {}),
    ...(att.posterAvailability === 'unavailable' ? { posterUnavailable: true } : {}),
    ...(qualityVerification ? { qualityVerification } : {}),
    starred: r.starred === true,
    starredAt: r.starredAt ?? null,
  };
}

export function toImageRow(raw: unknown): VideoRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as {
    taskId?: string;
    intent?: string;
    title?: string | null;
    status?: string;
    createdAt?: string | number | Date;
    starred?: boolean;
    starredAt?: string | number | Date | null;
    result?: { metadata?: VideoResultMeta } | null;
  };
  const meta = r.result?.metadata;
  if (!isImageLane(meta)) return null;
  if (!r.taskId || !r.status || !isDownloadableTerminalOutput(r.status)) return null;
  const att = meta?.attachments?.find((a) => {
    if (!a.fileId || !a.downloadUrl || !a.filename || typeof a.sizeBytes !== 'number') return false;
    if (typeof a.mimetype === 'string' && a.mimetype.startsWith('image/')) return true;
    return /\.(png|jpe?g|webp|gif)$/i.test(a.filename);
  });
  if (!att?.fileId || !att.downloadUrl || !att.filename || typeof att.sizeBytes !== 'number') {
    return null;
  }
  const downloadUrl = normaliseAttachmentDownloadUrl(att.downloadUrl);
  if (!downloadUrl) return null;
  return {
    taskId: r.taskId,
    intent: r.intent ?? '',
    title: r.title ?? null,
    status: r.status,
    createdAt: r.createdAt ?? new Date(),
    download: {
      fileId: att.fileId,
      downloadUrl,
      filename: att.filename,
      size: att.sizeBytes,
      ...(typeof att.expiresAt === 'string' ? { expiresAt: att.expiresAt } : {}),
      ...(att.availability === 'unavailable' ? { unavailable: true } : {}),
    },
    posterUrl: downloadUrl,
    starred: r.starred === true,
    starredAt: r.starredAt ?? null,
  };
}

export function filterCreativeHistoryRows(
  rows: readonly VideoRow[],
  {
    mode,
    videoType,
    filter,
    now = Date.now(),
  }: {
    mode: CreativeHistoryMode;
    videoType?: VideoType;
    filter: CreativeHistoryFilter;
    now?: number;
  },
): VideoRow[] {
  const scopedRows = rows.filter((row) => {
    const filename = row.download?.filename ?? '';
    const imageFile = /\.(png|jpe?g|webp|gif)$/i.test(filename);
    return mode === 'image' ? imageFile : !imageFile && (row.videoType ?? 'normal') === videoType;
  });
  if (filter === 'recent') {
    return scopedRows.filter((row) => isRecentCreativeHistoryRow(row.createdAt, now));
  }
  if (filter === 'pinned') return scopedRows.filter((row) => row.starred === true);
  return scopedRows;
}

export function creativeHistoryDisplayTitle(
  row: Pick<VideoRow, 'title' | 'intent' | 'videoType'>,
  mode: CreativeHistoryMode,
): string {
  const source = row.title?.trim() || row.intent.trim();
  if (mode !== 'image') {
    if (isIpOnboardingCopy(source)) {
      const intent = row.intent.trim();
      if (intent && intent !== source && !isIpOnboardingCopy(intent)) {
        return cleanVideoHistoryTitle(intent, row.videoType);
      }
      return videoHistoryFallbackTitle('ip_person');
    }
    return cleanVideoHistoryTitle(source, row.videoType);
  }
  const withoutInternalInstructions = source.split(/主体一致性要求[：:]/u, 1)[0]?.trim() ?? '';
  const withoutLanePrefix = withoutInternalInstructions
    .replace(/^生成(?:一张)?图片[：:]\s*/u, '')
    .trim();
  return withoutLanePrefix || '图片作品';
}

function cleanVideoHistoryTitle(source: string, videoType: VideoType | undefined): string {
  if (source.startsWith(CLONE_VIDEO_ROUTING_COPY)) {
    const note = source
      .slice(CLONE_VIDEO_ROUTING_COPY.length)
      .trim()
      .replace(new RegExp(`^${CLONE_VIDEO_NOTE_PREFIX}`, 'u'), '')
      .trim();
    return note || videoHistoryFallbackTitle('pet');
  }
  return source || videoHistoryFallbackTitle(videoType);
}

function videoHistoryFallbackTitle(videoType: VideoType | undefined): string {
  if (videoType === 'pet') return '复刻视频';
  if (videoType === 'ip_person') return 'IP人物视频';
  return '视频作品';
}

export function isLockedSubjectImageIntent(intent: string): boolean {
  return /主体一致性要求[：:]/u.test(intent);
}

function isDownloadableTerminalOutput(status: string): boolean {
  return status === 'completed' || status === 'partial_success';
}

function isRecentCreativeHistoryRow(value: string | number | Date, now: number): boolean {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return now - date.getTime() <= 7 * 24 * 60 * 60 * 1000;
}

function normaliseAttachmentDownloadUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\/api\/files\/[^/]+\/download(?:[?#].*)?$/.test(trimmed)) return trimmed;
  if (/^\/files\/[^/]+\/download(?:[?#].*)?$/.test(trimmed)) return `/api${trimmed}`;
  return null;
}
