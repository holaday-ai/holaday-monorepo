import { describe, expect, it } from 'vitest';
import { matchExpertWorkflow } from './expert-workflows.js';

describe('expert workflow matching', () => {
  it('matches douyin livestream review and asks for missing intake inputs', () => {
    const match = matchExpertWorkflow('帮我复盘一场抖音直播数据，做总结和优化策略');

    expect(match?.id).toBe('douyin-livestream-review');
    expect(match?.routeOverride).toBe('browser');
    expect(match?.missingInputs).toEqual(['liveSession', 'dataSource']);
    expect(match?.promptPreamble).toContain('专家技能工作流：抖音直播复盘');
    expect(match?.promptPreamble).toContain('先不要调用任何工具');
  });

  it('uses uploaded data without forcing a browser session', () => {
    const match = matchExpertWorkflow('用我上传的表格复盘昨天的抖音直播，输出下场优化策略', {
      hasAttachments: true,
    });

    expect(match?.id).toBe('douyin-livestream-review');
    expect(match?.missingInputs).toEqual([]);
    expect(match?.routeOverride).toBe('generate');
    expect(match?.promptPreamble).toContain('优先分析附件内容');
  });

  it('uses browser mode when the source is a logged-in douyin backend', () => {
    const match = matchExpertWorkflow('打开抖音电商罗盘，复盘昨天直播间的 GMV 和 GPM');

    expect(match?.id).toBe('douyin-livestream-review');
    expect(match?.missingInputs).toEqual([]);
    expect(match?.routeOverride).toBe('browser');
    expect(match?.promptPreamble).toContain('遇到登录页先请用户登录后继续');
  });

  it('does not match generic douyin tasks without livestream review intent', () => {
    expect(matchExpertWorkflow('帮我搜一下抖音今天的热门音乐')).toBeNull();
  });
});
