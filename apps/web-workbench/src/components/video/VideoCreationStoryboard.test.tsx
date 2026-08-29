// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VideoCreationStoryboard } from './VideoCreationStoryboard';
import { videoCreationScenario } from './video-creation-scenarios';

afterEach(cleanup);

describe('VideoCreationStoryboard', () => {
  it('turns the selected outcome into three concise, ordered beats', () => {
    render(<VideoCreationStoryboard scenario={videoCreationScenario('product_highlight')} />);

    expect(screen.getByRole('heading', { name: '向 HOLA DAY 描述你的产品高光短片' })).toBeTruthy();
    expect(screen.getAllByRole('figure')).toHaveLength(3);
    expect(screen.getByText('开场')).toBeTruthy();
    expect(screen.getByText('产品特写')).toBeTruthy();
    expect(screen.getByText('收尾')).toBeTruthy();
    expect(screen.getByText('AI 会根据你的素材和重点调整镜头顺序')).toBeTruthy();
  });
});
