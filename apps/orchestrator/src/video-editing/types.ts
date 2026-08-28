export type VideoEditSourceKind = 'generated' | 'clone' | 'ip_person' | 'upload';
export type VideoEditProvider = 'cesdk';
export type VideoEditAspectRatio = '16:9' | '9:16' | '1:1';

export interface VideoEditGenerationContext {
  sourceTaskId?: string;
  prompt?: string;
  referenceFileIds?: string[];
  lockedSubjectFileId?: string;
}

export interface VideoEditScene {
  id: string;
  sourceFileId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  order: number;
  caption: string;
  audioGain: number;
  generationContext: VideoEditGenerationContext | null;
}

export interface VideoEditDocument {
  aspectRatio: VideoEditAspectRatio;
  scenes: VideoEditScene[];
}

export type VideoEditOperation =
  | { kind: 'trim'; sceneId: string; startMs: number; endMs: number }
  | { kind: 'reorder'; sceneIds: string[] }
  | { kind: 'caption'; sceneId: string; text: string }
  | { kind: 'aspect_ratio'; value: VideoEditAspectRatio }
  | {
      kind: 'remove_silence';
      sceneId: string;
      ranges: Array<{ startMs: number; endMs: number }>;
    }
  | { kind: 'regenerate_scene'; sceneId: string; prompt: string };

export interface VideoEditProjectRecord {
  id: number;
  externalId: string;
  userId: number;
  sourceKind: VideoEditSourceKind;
  provider: VideoEditProvider;
  status: 'active' | 'archived';
  currentVersionId: number | null;
}

export interface VideoEditVersionRecord {
  id: number;
  externalId: string;
  projectId: number;
  parentVersionId: number | null;
  revision: number;
  documentJson: VideoEditDocument;
  operationJson: VideoEditOperation[] | null;
  sdkDocument: string | null;
  outputFileId: number | null;
  renderStatus: 'idle' | 'rendering' | 'completed' | 'failed';
  createdAt: Date;
}
