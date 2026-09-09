import { describe, expect, it } from 'vitest';
import { matchExpertWorkflow, resolveFixedExpertWorkflow } from './expert-workflows.js';

describe('expert workflow matching', () => {
  it('uses actual pasted metrics on first creation even when their source mentions a platform', () => {
    const match = matchExpertWorkflow('复盘昨天的抖音直播，数据来自电商罗盘\nGMV: 100\nUV: 200');
    expect(match?.missingInputs).toEqual([]);
    expect(match?.routeOverride).toBe('generate');
    expect(match?.promptPreamble).toContain('用户已在消息中提供结构化数据');
  });
  it.each(['稍后上传 GMV 和 UV', 'GMV: 100\nGMV: 200'])(
    'does not infer a data source from a promise or duplicate metric: %s',
    (text) => {
      const match = matchExpertWorkflow(`复盘昨天的抖音直播\n${text}`);
      expect(match?.missingInputs).toEqual(['dataSource']);
    },
  );
  it('resolves an already-selected lineage without rematching later topic words', () => {
    const match = resolveFixedExpertWorkflow(
      'douyin-livestream-review',
      '昨天，附件里是这场数据。也参考小红书观点。',
      { hasAttachments: true },
    );
    expect(match?.id).toBe('douyin-livestream-review');
    expect(match?.missingInputs).toEqual([]);
    expect(match?.routeOverride).toBe('generate');
    expect(resolveFixedExpertWorkflow('unknown', '抖音直播复盘')).toBeNull();
  });
  it('matches douyin livestream review and asks for missing intake inputs', () => {
    const match = matchExpertWorkflow('帮我复盘一场抖音直播数据，做总结和优化策略');

    expect(match?.id).toBe('douyin-livestream-review');
    // Intake-only park: route to `generate` so the dispatcher does
    // NOT allocate a Brave just to ask the user for the live session
    // + data source. The reply path re-evaluates and either continues
    // in generate (manual data) or hands off to browser (platform).
    expect(match?.routeOverride).toBe('generate');
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
