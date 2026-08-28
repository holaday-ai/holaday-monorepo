// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneStrip } from './SceneStrip';
import type { VideoEditingDocument } from './video-editing-state';

afterEach(cleanup);

const SCENES: VideoEditingDocument['scenes'] = [
  {
    id: 'scene_1',
    sourceFileId: 'file_video',
    sourceStartMs: 0,
    sourceEndMs: 4_500,
    order: 0,
    caption: '清晨开场',
    audioGain: 1,
    generationContext: { sourceTaskId: 'tsk_video' },
  },
  {
    id: 'scene_2',
    sourceFileId: 'file_video',
    sourceStartMs: 4_500,
    sourceEndMs: 8_000,
    order: 1,
    caption: '',
    audioGain: 1,
    generationContext: null,
  },
];

describe('SceneStrip', () => {
  it('shows thumbnail, duration, source, caption, selection, and operation state', () => {
    const onSelect = vi.fn();
    render(
      <SceneStrip
        scenes={SCENES}
        previewUrl="/video.mp4"
        selectedSceneId="scene_1"
        affectedSceneIds={['scene_2']}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByLabelText('第 1 段缩略预览').getAttribute('src')).toBe('/video.mp4#t=0.001');
    expect(screen.getByText('4.5 秒')).toBeTruthy();
    expect(screen.getByText('生成片段')).toBeTruthy();
    expect(screen.getByText('清晨开场')).toBeTruthy();
    expect(screen.getByText('原片素材')).toBeTruthy();
    expect(screen.getByText('将被修改')).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择第 1 段' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: '选择第 2 段' }));
    expect(onSelect).toHaveBeenCalledWith('scene_2');
  });

  it('uses the matching source preview for a multi-video scene', () => {
    const firstScene = SCENES.at(0);
    if (!firstScene) throw new Error('expected scene fixture');
    render(
      <SceneStrip
        scenes={[{ ...firstScene, sourceFileId: 'file_second' }]}
        previewUrl="/fallback.mp4"
        scenePreviews={{ file_second: { url: '/second.mp4' } }}
        selectedSceneId={null}
        onSelect={() => undefined}
      />,
    );

    expect(screen.getByLabelText('第 1 段缩略预览').getAttribute('src')).toBe(
      '/second.mp4#t=0.001',
    );
  });
});
