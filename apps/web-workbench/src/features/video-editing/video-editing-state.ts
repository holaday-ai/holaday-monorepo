import type { FileDownloadPayload } from '@/components/FileDownloadCard';

export type VideoEditingStatus =
  | 'loading'
  | 'ready'
  | 'planning'
  | 'plan_ready'
  | 'applying'
  | 'rendering'
  | 'error';

export type VideoEditingFailure =
  | 'planner_unavailable'
  | 'stale_version'
  | 'insufficient_balance'
  | 'scene_regeneration_unavailable'
  | 'render_failed'
  | 'source_unavailable';

export type VideoEditOperation =
  | { kind: 'trim'; sceneId: string; startMs: number; endMs: number }
  | { kind: 'reorder'; sceneIds: string[] }
  | { kind: 'caption'; sceneId: string; text: string }
  | { kind: 'aspect_ratio'; value: '16:9' | '9:16' | '1:1' }
  | {
      kind: 'remove_silence';
      sceneId: string;
      ranges: Array<{ startMs: number; endMs: number }>;
    }
  | { kind: 'regenerate_scene'; sceneId: string; prompt: string };

export interface VideoEditingDocument {
  aspectRatio: '16:9' | '9:16' | '1:1';
  scenes: Array<{
    id: string;
    sourceFileId: string;
    sourceStartMs: number;
    sourceEndMs: number;
    order: number;
    caption: string;
    audioGain: number;
    generationContext: {
      sourceTaskId?: string;
      prompt?: string;
      referenceFileIds?: string[];
      lockedSubjectFileId?: string;
    } | null;
  }>;
}

export interface VideoEditingVersion {
  id: string;
  revision: number;
  document: VideoEditingDocument;
  operations?: VideoEditOperation[] | null;
  sdkDocument: string | null;
  renderStatus: 'idle' | 'rendering' | 'completed' | 'failed';
  createdAt?: Date | string;
}

export interface VideoEditingPlan {
  summary: string;
  affectedSceneIds: string[];
  operations: VideoEditOperation[];
  requiresQuote: boolean;
}

export interface VideoEditingProjectData {
  project: {
    id: string;
    sourceKind: 'generated' | 'clone' | 'ip_person' | 'upload';
    provider: 'cesdk';
    status: 'active' | 'archived';
    createdAt?: Date | string;
    updatedAt?: Date | string;
  };
  currentVersion: VideoEditingVersion;
  versions: VideoEditingVersion[];
  preview: { url: string; expiresAt?: Date | string };
  scenePreviews?: Record<string, { url: string; expiresAt?: Date | string }>;
  output?: FileDownloadPayload | null;
  editor: { license: string };
  capabilities: { sceneRegeneration: boolean };
}

export interface VideoEditingState {
  status: VideoEditingStatus;
  requestId: number;
  data: VideoEditingProjectData | null;
  plan: VideoEditingPlan | null;
  error: VideoEditingFailure | null;
}

export const initialVideoEditingState: VideoEditingState = {
  status: 'loading',
  requestId: 0,
  data: null,
  plan: null,
  error: null,
};

export type VideoEditingAction =
  | { type: 'load_started'; requestId: number }
  | { type: 'load_succeeded'; requestId: number; data: VideoEditingProjectData }
  | {
      type: 'request_started';
      requestId: number;
      status: Extract<VideoEditingStatus, 'planning' | 'applying' | 'rendering'>;
    }
  | { type: 'plan_succeeded'; requestId: number; plan: VideoEditingPlan }
  | { type: 'version_succeeded'; requestId: number; version: VideoEditingVersion }
  | { type: 'request_failed'; requestId: number; error: VideoEditingFailure }
  | { type: 'dismiss_error' };

function isStale(state: VideoEditingState, requestId: number): boolean {
  return requestId < state.requestId;
}

export function videoEditingReducer(
  state: VideoEditingState,
  action: VideoEditingAction,
): VideoEditingState {
  if ('requestId' in action && isStale(state, action.requestId)) return state;
  switch (action.type) {
    case 'load_started':
      return { ...state, status: 'loading', requestId: action.requestId, error: null };
    case 'load_succeeded':
      return {
        status: 'ready',
        requestId: action.requestId,
        data: action.data,
        plan: null,
        error: null,
      };
    case 'request_started':
      return {
        ...state,
        status: action.status,
        requestId: action.requestId,
        error: null,
      };
    case 'plan_succeeded':
      return {
        ...state,
        status: 'plan_ready',
        requestId: action.requestId,
        plan: action.plan,
        error: null,
      };
    case 'version_succeeded': {
      if (!state.data) return state;
      const versions = [
        action.version,
        ...state.data.versions.filter((version) => version.id !== action.version.id),
      ];
      return {
        ...state,
        status: 'ready',
        requestId: action.requestId,
        data: { ...state.data, currentVersion: action.version, versions },
        plan: null,
        error: null,
      };
    }
    case 'request_failed':
      return {
        ...state,
        status: 'error',
        requestId: action.requestId,
        error: action.error,
      };
    case 'dismiss_error':
      return { ...state, status: state.data ? 'ready' : 'loading', error: null };
  }
}

export function isVideoEditingBusy(state: VideoEditingState): boolean {
  return ['loading', 'planning', 'applying', 'rendering'].includes(state.status);
}
