// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VersionHistory } from './VersionHistory';
import type { VideoEditingVersion } from './video-editing-state';

const VERSIONS: VideoEditingVersion[] = [
  {
    id: 'vedv_2',
    revision: 2,
    document: { aspectRatio: '9:16', scenes: [] },
    sdkDocument: null,
    renderStatus: 'idle',
  },
  {
    id: 'vedv_1',
    revision: 1,
    document: { aspectRatio: '16:9', scenes: [] },
    sdkDocument: null,
    renderStatus: 'completed',
  },
];

describe('VersionHistory', () => {
  it('warns that restore creates a new version before restoring', () => {
    const onRestore = vi.fn();
    render(
      <VersionHistory
        versions={VERSIONS}
        currentVersionId="vedv_2"
        busy={false}
        onRestore={onRestore}
      />,
    );

    expect(screen.getByText('版本 2')).toBeTruthy();
    expect(screen.getByText('当前')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '恢复版本 1' }));
    expect(screen.getByText('恢复会创建一个新版本，原片与现有版本都会保留。')).toBeTruthy();
    expect(onRestore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认恢复版本 1' }));
    expect(onRestore).toHaveBeenCalledWith('vedv_1');
  });
});
