import { describe, expect, it } from 'vitest';
import {
  type VideoEditingProjectData,
  initialVideoEditingState,
  isVideoEditingBusy,
  videoEditingReducer,
} from './video-editing-state';

const PROJECT: VideoEditingProjectData = {
  project: {
    id: 'vedp_project',
    sourceKind: 'generated',
    provider: 'cesdk',
    status: 'active',
  },
  currentVersion: {
    id: 'vedv_1',
    revision: 1,
    document: { aspectRatio: '16:9', scenes: [] },
    sdkDocument: null,
    renderStatus: 'idle',
  },
  versions: [],
  preview: { url: '/video.mp4' },
  editor: { license: 'browser-license' },
  capabilities: { sceneRegeneration: false },
};

describe('videoEditingReducer', () => {
  it('ignores a stale planning response', () => {
    const ready = videoEditingReducer(initialVideoEditingState, {
      type: 'load_succeeded',
      requestId: 1,
      data: PROJECT,
    });
    const planning = videoEditingReducer(ready, {
      type: 'request_started',
      requestId: 3,
      status: 'planning',
    });
    const stale = videoEditingReducer(planning, {
      type: 'plan_succeeded',
      requestId: 2,
      plan: {
        summary: '过期计划',
        affectedSceneIds: [],
        operations: [],
        requiresQuote: false,
      },
    });

    expect(stale).toEqual(planning);
  });

  it('retains the last usable project when a request fails', () => {
    const ready = videoEditingReducer(initialVideoEditingState, {
      type: 'load_succeeded',
      requestId: 1,
      data: PROJECT,
    });
    const planning = videoEditingReducer(ready, {
      type: 'request_started',
      requestId: 2,
      status: 'planning',
    });
    const failed = videoEditingReducer(planning, {
      type: 'request_failed',
      requestId: 2,
      error: 'planner_unavailable',
    });

    expect(failed.status).toBe('error');
    expect(failed.error).toBe('planner_unavailable');
    expect(failed.data?.currentVersion.id).toBe('vedv_1');
  });

  it.each([
    'planner_unavailable',
    'stale_version',
    'insufficient_balance',
    'scene_regeneration_unavailable',
    'render_failed',
    'source_unavailable',
  ] as const)('exposes the explicit %s failure state', (error) => {
    const state = videoEditingReducer(initialVideoEditingState, {
      type: 'request_failed',
      requestId: 0,
      error,
    });
    expect(state.error).toBe(error);
  });

  it.each(['planning', 'applying', 'rendering'] as const)(
    'blocks duplicate submits while %s',
    (status) => {
      expect(isVideoEditingBusy({ ...initialVideoEditingState, status })).toBe(true);
    },
  );

  it('promotes a successful child version without losing version history', () => {
    const ready = videoEditingReducer(initialVideoEditingState, {
      type: 'load_succeeded',
      requestId: 1,
      data: PROJECT,
    });
    const next = videoEditingReducer(ready, {
      type: 'version_succeeded',
      requestId: 1,
      version: { ...PROJECT.currentVersion, id: 'vedv_2', revision: 2 },
    });

    expect(next.status).toBe('ready');
    expect(next.data?.currentVersion.id).toBe('vedv_2');
    expect(next.data?.versions.map((version) => version.id)).toEqual(['vedv_2']);
  });
});
