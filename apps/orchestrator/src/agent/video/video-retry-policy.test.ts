import { describe, expect, it } from 'vitest';
import * as policy from './video-retry-policy.js';

describe('video rejection feedback', () => {
  it('prompts to change materials on the third rejection and says no further retry will be charged', () => {
    expect(policy.videoRejectionReason('质量不合格', 2, 3)).toBe(
      '质量不合格 同一制作要求已连续 3 次未通过质检，请修改素材或描述；不会继续扣费重试。',
    );
  });
  it('preserves earlier rejection reasons and applies the configured budget', () => {
    expect(policy.videoRejectionReason('质量不合格', 1, 3)).toBe('质量不合格');
    expect(policy.videoRejectionReason('质量不合格', 0, 1)).toContain('请修改素材或描述');
  });
});
