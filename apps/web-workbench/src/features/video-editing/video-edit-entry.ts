export interface VideoEditingEntryArtifact {
  fileId: string;
  mimetype: string;
  availability?: 'active' | 'unavailable';
  expiresAt?: string | null;
  durationMs?: number;
  codec?: string;
}

interface ContinueEditingInput {
  capabilityEnabled: boolean;
  artifact: VideoEditingEntryArtifact;
  taskStatus?: string;
  now?: number;
}

const TERMINAL_VIDEO_STATUSES = new Set(['completed', 'partial_success']);

export function canContinueEditing({
  capabilityEnabled,
  artifact,
  taskStatus,
  now = Date.now(),
}: ContinueEditingInput): boolean {
  if (!capabilityEnabled || !artifact.fileId || !artifact.mimetype.startsWith('video/')) return false;
  if (artifact.availability === 'unavailable') return false;
  if (taskStatus !== undefined && !TERMINAL_VIDEO_STATUSES.has(taskStatus)) return false;
  if (artifact.expiresAt) {
    const expiresAt = Date.parse(artifact.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt <= now) return false;
  }
  return artifact.codec !== 'unsupported';
}

export interface VideoCombinationResult {
  compatible: boolean;
  sourceFileIds: string[];
  reason: string | null;
}

export function canCombineVideoRows(
  rows: readonly VideoEditingEntryArtifact[],
): VideoCombinationResult {
  const sourceFileIds = rows.map((row) => row.fileId);
  if (rows.length < 2) {
    return { compatible: false, sourceFileIds, reason: '至少选择 2 段视频' };
  }
  if (new Set(sourceFileIds).size !== sourceFileIds.length) {
    return { compatible: false, sourceFileIds, reason: '不能重复选择同一段视频' };
  }
  if (rows.some((row) => !row.mimetype.startsWith('video/'))) {
    return { compatible: false, sourceFileIds, reason: '所选内容中包含非视频文件' };
  }
  if (rows.some((row) => row.availability === 'unavailable')) {
    return { compatible: false, sourceFileIds, reason: '所选视频中有文件已失效' };
  }
  if (rows.some((row) => row.codec === 'unsupported')) {
    return { compatible: false, sourceFileIds, reason: '所选视频包含暂不支持的编码' };
  }
  if (rows.some((row) => row.durationMs !== undefined && row.durationMs <= 0)) {
    return { compatible: false, sourceFileIds, reason: '所选视频的时长信息无效' };
  }
  return { compatible: true, sourceFileIds, reason: null };
}

export async function createVideoEditingProject({
  sourceFileIds,
  create,
}: {
  sourceFileIds: string[];
  create(input: { sourceFileIds: string[] }): Promise<{ project: { id: string } }>;
}): Promise<{ projectId: string }> {
  if (sourceFileIds.length === 0 || new Set(sourceFileIds).size !== sourceFileIds.length) {
    throw new Error('视频来源无效');
  }
  const result = await create({ sourceFileIds });
  return { projectId: result.project.id };
}
