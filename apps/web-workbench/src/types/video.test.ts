import { describe, expect, it } from 'vitest';
import {
  cloneModeFromVideoModel,
  estimateCloneCny,
  normalVideoModelFromSelection,
  type VideoModel,
} from './video';

describe('clone video model contract', () => {
  it('maps only the two visible Wan Animate choices to backend service modes', () => {
    expect(cloneModeFromVideoModel('wan_animate_std')).toBe('wan-std');
    expect(cloneModeFromVideoModel('wan_animate_pro')).toBe('wan-pro');
    for (const unsupported of ['veo_fast', 'veo_standard', 'happyhorse', 'wanxiang'] as VideoModel[]) {
      expect(cloneModeFromVideoModel(unsupported)).toBeNull();
    }
  });

  it('mirrors the official Singapore output-duration price for Standard and Pro', () => {
    expect(estimateCloneCny({ mode: 'wan-std', durationSeconds: 8.2 })).toBe(
      Math.ceil(8.2 * 0.18 * 7.3),
    );
    expect(estimateCloneCny({ mode: 'wan-pro', durationSeconds: 8.2 })).toBe(
      Math.ceil(8.2 * 0.26 * 7.3),
    );
  });

  it('never leaks a clone-only model into the normal video contract', () => {
    expect(normalVideoModelFromSelection('veo_standard')).toBe('veo_standard');
    expect(normalVideoModelFromSelection('wan_animate_std')).toBe('veo_fast');
    expect(normalVideoModelFromSelection('wan_animate_pro')).toBe('veo_fast');
  });
});
