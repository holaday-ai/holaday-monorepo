import { describe, expect, it } from 'vitest';

import {
  getExpertWorkflowById,
  matchExpertWorkflow,
  resolveExpertWorkflowDispatch,
  shouldAllowSpecializedLaneOverride,
} from './expert-workflow-registry.js';

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

describe('matchExpertWorkflow — content-topic', () => {
  it('matches 选题 + 平台名', () => {
    expect(
      matchExpertWorkflow({ intent: '小红书 美妆选题' })?.workflowId,
    ).toBe('content-topic');
    expect(
      matchExpertWorkflow({ intent: '抖音爆款选题怎么做' })?.workflowId,
    ).toBe('content-topic');
    expect(
      matchExpertWorkflow({ intent: '帮我做 B站 内容策划' })?.workflowId,
    ).toBe('content-topic');
  });

  it('matches 标题 / 内容方向 / 种草 task variants', () => {
    expect(
      matchExpertWorkflow({ intent: '小红书 标题策划' })?.workflowId,
    ).toBe('content-topic');
    expect(
      matchExpertWorkflow({ intent: '抖音 内容方向规划' })?.workflowId,
    ).toBe('content-topic');
    expect(
      matchExpertWorkflow({ intent: '小红书种草笔记选题' })?.workflowId,
    ).toBe('content-topic');
  });

  it('does NOT match without a platform term', () => {
    expect(matchExpertWorkflow({ intent: '帮我想几个爆款选题' })).toBeNull();
    expect(matchExpertWorkflow({ intent: '起标题' })).toBeNull();
  });

  it('does NOT match without a task term', () => {
    expect(matchExpertWorkflow({ intent: '小红书账号涨粉' })).toBeNull();
    expect(matchExpertWorkflow({ intent: '抖音 GMV 做不动' })).toBeNull();
  });

  it('precedence: 抖音 + 直播 + 复盘 → douyin-review wins (not content-topic)', () => {
    // Intent that would trigger BOTH if precedence were wrong.
    // douyin-review is first in WORKFLOWS so it wins. content-topic
    // is for pre-creation; douyin-review is for post-stream review.
    const w = matchExpertWorkflow({
      intent: '复盘抖音直播：选题方向是不是有问题',
    });
    expect(w?.workflowId).toBe('douyin-review');
  });

  it('English platform aliases (xiaohongshu / bilibili) match', () => {
    expect(
      matchExpertWorkflow({ intent: 'xiaohongshu 选题策划' })?.workflowId,
    ).toBe('content-topic');
    expect(
      matchExpertWorkflow({ intent: 'bilibili 爆款标题' })?.workflowId,
    ).toBe('content-topic');
  });
});

describe('matchExpertWorkflow — ecom-daily', () => {
  it('matches 日报 + ECOM term', () => {
    expect(
      matchExpertWorkflow({ intent: '电商日报' })?.workflowId,
    ).toBe('ecom-daily');
    expect(
      matchExpertWorkflow({ intent: '帮我做日报，营收 30万' })?.workflowId,
    ).toBe('ecom-daily');
    expect(
      matchExpertWorkflow({ intent: '昨日营收 50万 订单 1500' })?.workflowId,
    ).toBe('ecom-daily');
  });

  it('matches relative time + 销售/店铺', () => {
    expect(
      matchExpertWorkflow({ intent: '昨日 销售额 100万' })?.workflowId,
    ).toBe('ecom-daily');
    expect(
      matchExpertWorkflow({ intent: '今天店铺数据复盘' })?.workflowId,
    ).toBe('ecom-daily');
  });

  it('does NOT match without time term', () => {
    expect(matchExpertWorkflow({ intent: '电商营收要怎么提升' })).toBeNull();
    expect(matchExpertWorkflow({ intent: 'GMV 100万 怎么样' })).toBeNull();
  });

  it('does NOT match without ECOM term', () => {
    expect(matchExpertWorkflow({ intent: '昨天天气好' })).toBeNull();
    expect(matchExpertWorkflow({ intent: '今日要做的事' })).toBeNull();
  });

  it('precedence: 抖音直播 + 复盘 → douyin-review wins, not ecom-daily', () => {
    // "昨日 抖音直播复盘" — has TIME (昨日) + ECOM-adjacent term but
    // also 抖音/直播/复盘 → douyin-review wins (first in WORKFLOWS).
    const w = matchExpertWorkflow({
      intent: '复盘抖音直播 昨日营收 100万',
    });
    expect(w?.workflowId).toBe('douyin-review');
  });

  it('precedence: content-topic-shaped intent → content-topic wins, not ecom-daily', () => {
    // "昨日小红书选题" — TIME (昨日) + content-topic terms (小红书 + 选题).
    // No ECOM term so ecom-daily doesn't fire anyway, content-topic does.
    const w = matchExpertWorkflow({ intent: '昨日 小红书 选题策划' });
    expect(w?.workflowId).toBe('content-topic');
  });

  it('English aliases (yesterday / today) work', () => {
    expect(
      matchExpertWorkflow({ intent: 'yesterday 销售额 100万' })?.workflowId,
    ).toBe('ecom-daily');
  });
});

describe('resolveExpertWorkflowDispatch — new follow-up tasks', () => {
  const contentTopic = getExpertWorkflowById('content-topic');
  const ecomDaily = getExpertWorkflowById('ecom-daily');

  it('uses an initial matched workflow for both report generation and routing', () => {
    const resolved = resolveExpertWorkflowDispatch({
      matchedWorkflow: contentTopic,
      parentWorkflow: null,
      isFollowUp: false,
    });

    expect(resolved.reportWorkflow?.workflowId).toBe('content-topic');
    expect(resolved.routingWorkflow?.workflowId).toBe('content-topic');
  });

  it('keeps a matched typed workflow ahead of keyword-based specialized lanes', () => {
    const resolved = resolveExpertWorkflowDispatch({
      matchedWorkflow: ecomDaily,
      parentWorkflow: null,
      isFollowUp: false,
    });

    expect(shouldAllowSpecializedLaneOverride(resolved.routingWorkflow)).toBe(false);
    expect(shouldAllowSpecializedLaneOverride(null)).toBe(true);
  });

  it('inherits only generate routing from the parent for a follow-up action', () => {
    const resolved = resolveExpertWorkflowDispatch({
      matchedWorkflow: null,
      parentWorkflow: contentTopic,
      isFollowUp: true,
    });

    expect(resolved.reportWorkflow).toBeNull();
    expect(resolved.routingWorkflow?.workflowId).toBe('content-topic');
  });

  it('treats an explicitly matched follow-up as a new workflow report', () => {
    const resolved = resolveExpertWorkflowDispatch({
      matchedWorkflow: ecomDaily,
      parentWorkflow: contentTopic,
      isFollowUp: true,
    });

    expect(resolved.reportWorkflow?.workflowId).toBe('ecom-daily');
    expect(resolved.routingWorkflow?.workflowId).toBe('ecom-daily');
  });

  it.each([
    {
      workflowId: 'content-topic',
      intent:
        '基于这次小红书选题策划的方向，帮我排一份 30 天的发布日历：每条内容的选题、发布时段、所属系列、复用素材标记。',
    },
    {
      workflowId: 'ecom-daily',
      intent:
        '基于这次电商日报的诊断和明日重点，帮我生成一份完整的明日运营 SOP：开店前准备、上架顺序、活动页改动、投放配置、客服话术。',
    },
    {
      workflowId: 'douyin-review',
      intent:
        '基于这次抖音直播复盘的诊断和优化建议，帮我生成一份详细的下场直播 SOP，包含开播前准备、节奏节点、话术框架。',
    },
  ])('does not reuse the $workflowId report schema for its derived action', ({
    workflowId,
    intent,
  }) => {
    const parentWorkflow = getExpertWorkflowById(workflowId);
    const matchedWorkflow = matchExpertWorkflow({ intent });
    expect(matchedWorkflow?.workflowId).toBe(workflowId);

    const resolved = resolveExpertWorkflowDispatch({
      matchedWorkflow,
      parentWorkflow,
      isFollowUp: true,
      followUpIntent: intent,
    });

    expect(resolved.reportWorkflow).toBeNull();
    expect(resolved.routingWorkflow?.workflowId).toBe(workflowId);
  });
});
