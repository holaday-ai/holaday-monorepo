import { describe, expect, it } from 'vitest';

import { matchExpertWorkflow } from './expert-workflow-registry.js';

describe('matchExpertWorkflow — douyin-review', () => {
  it('matches on full intent (抖音 + 直播 + 复盘)', () => {
    const w = matchExpertWorkflow({ intent: '复盘抖音直播数据' });
    expect(w?.workflowId).toBe('douyin-review');
  });

  it('matches the BOSS-default phrasing', () => {
    const w = matchExpertWorkflow({
      intent: '复盘抖音直播，GMV 100000 UV 20000 订单 1250 客单价 80 转化率 6.25%',
    });
    expect(w?.workflowId).toBe('douyin-review');
  });

  it('role_id alone is NOT enough — intent keywords still required', () => {
    // Earlier the matcher fired on `douyin-strategist` even with a
    // terse intent like "帮我看看数据". Eval bypass user has that
    // role configured by default, so the fast-path was forcing
    // every contradiction-style P0 case through the workflow gate.
    // Now the intent must mention 抖音 + 直播 + 复盘 buckets even
    // when an explicit douyin role is selected.
    expect(
      matchExpertWorkflow({ intent: '帮我看看数据', roleId: 'douyin-strategist' }),
    ).toBeNull();
    expect(
      matchExpertWorkflow({ intent: '随便', roleId: 'douyin-operator' }),
    ).toBeNull();
  });

  it('explicit douyin role + workflow-shaped intent → still matches', () => {
    // The role doesn't fire the matcher itself, but intent keywords
    // do — and a douyin-strategist who actually types a review
    // intent still gets the workflow.
    const w = matchExpertWorkflow({
      intent: '复盘抖音直播 GMV 100000',
      roleId: 'douyin-strategist',
    });
    expect(w?.workflowId).toBe('douyin-review');
  });

  it('does NOT match if role_id is unrelated AND keywords incomplete', () => {
    const w = matchExpertWorkflow({
      intent: '复盘一下',
      roleId: 'content-creator',
    });
    expect(w).toBeNull();
  });

  it('requires ALL THREE buckets — analytic 抖音 mention does not trigger', () => {
    // "分析抖音的内容生态" mentions 抖音 + 分析 but no 直播 surface.
    const w = matchExpertWorkflow({ intent: '分析抖音的内容生态' });
    expect(w).toBeNull();
  });

  it('two-of-three keyword does not trigger', () => {
    expect(matchExpertWorkflow({ intent: '直播复盘怎么做' })).toBeNull(); // no douyin
    expect(matchExpertWorkflow({ intent: '抖音直播好不好做' })).toBeNull(); // no review
    expect(matchExpertWorkflow({ intent: '抖音复盘需要哪些数据' })).toBeNull(); // no live surface
  });

  it('English tiktok / TikTok also matches (alias for 抖音)', () => {
    const w = matchExpertWorkflow({
      intent: 'TikTok 直播复盘 GMV 50000',
    });
    expect(w?.workflowId).toBe('douyin-review');
  });

  it('returns null for unrelated intent', () => {
    expect(matchExpertWorkflow({ intent: '翻译这句话' })).toBeNull();
    expect(matchExpertWorkflow({ intent: '搜索小红书装备' })).toBeNull();
  });

  it('returns null for empty intent + no role', () => {
    expect(matchExpertWorkflow({ intent: '' })).toBeNull();
  });
});
