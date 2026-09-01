import { describe, expect, it } from 'vitest';
import { HOLADAY_SKILLS } from '@holaday/shared-types';
import {
  type SkillCategory,
  groupSkillsByCategory,
  matchSkillsForIntent,
  normalizeSkillRows,
  normalizeSkillToggleResponse,
  pickCapabilityShowcase,
  skillCardBadge,
  skillCardUsageHint,
  skillConnectorLabel,
  skillLimitBannerCopy,
  skillLimitMessage,
  skillLoadErrorCopy,
  skillSelectionFromTaskDraft,
  skillPageSummary,
  skillPlanLabel,
  skillStartDecision,
  skillTaskDraft,
} from './skills-page-state';

interface SkillFixture {
  category: SkillCategory;
  id: string;
}

const skills: readonly SkillFixture[] = [
  { id: 'analytics', category: '分析决策' },
  { id: 'content', category: '内容运营' },
  { id: 'management', category: '管理协作' },
];

describe('skills page state helpers', () => {
  it('groups skills in product category order', () => {
    const groups = groupSkillsByCategory(skills);

    expect(groups.map((group) => group.category)).toEqual(['内容运营', '分析决策', '管理协作']);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['content']);
  });

  it('labels known and unknown plans', () => {
    expect(skillPlanLabel('free')).toBe('体验版');
    expect(skillPlanLabel('basic')).toBe('基础版');
    expect(skillPlanLabel('pro')).toBe('专业版');
    expect(skillPlanLabel('enterprise')).toBe('当前套餐');
  });

  it('summarizes loading, failed, empty, capped, and uncapped states', () => {
    expect(
      skillPageSummary({
        loading: true,
        error: null,
        totalCount: 0,
        enabledCount: 0,
        cap: 0,
        planId: 'free',
      }),
    ).toBe('任务选项加载中…');
    expect(
      skillPageSummary({
        loading: false,
        error: 'offline',
        totalCount: 0,
        enabledCount: 0,
        cap: 0,
        planId: 'free',
      }),
    ).toBe('任务选项暂时无法加载');
    expect(
      skillPageSummary({
        loading: false,
        error: null,
        totalCount: 0,
        enabledCount: 0,
        cap: 0,
        planId: 'free',
      }),
    ).toBe('暂无可开始的任务');
    expect(
      skillPageSummary({
        loading: false,
        error: null,
        totalCount: 33,
        enabledCount: 2,
        cap: 5,
        planId: 'basic',
      }),
    ).toBe('常用能力 2 / 5 · 基础版');
    expect(
      skillPageSummary({
        loading: false,
        error: null,
        totalCount: 33,
        enabledCount: 11,
        cap: 5,
        planId: 'basic',
      }),
    ).toBe('已保留 11 项常用能力 · 基础版上限 5');
    expect(
      skillPageSummary({
        loading: false,
        error: null,
        totalCount: 33,
        enabledCount: 0,
        cap: 0,
        planId: 'free',
      }),
    ).toBe('体验版可查看任务示例');
  });

  it('builds plan-aware limit messages', () => {
    expect(skillLimitMessage({ cap: 0, planId: 'free' })).toBe('当前套餐暂不支持开始此任务');
    expect(skillLimitMessage({ cap: 33, planId: 'pro' })).toBe('当前套餐的常用能力已满（33 项）');
    expect(skillLimitMessage({ cap: 5, planId: 'basic' })).toBe(
      '常用能力已满（5 项）· 可先移除一项或升级套餐',
    );
  });

  it('explains over-limit skill states without implying a broken counter', () => {
    expect(skillLimitBannerCopy({ cap: 0, enabledCount: 0, planId: 'free' })).toEqual({
      title: '当前套餐可查看任务示例',
      body: '升级到基础版后即可选择并开始任务；专业版可使用全部 13 类任务。',
    });
    expect(skillLimitBannerCopy({ cap: 5, enabledCount: 11, planId: 'basic' })).toEqual({
      title: '当前已保留 11 项常用能力',
      body: '基础版最多保留 5 项。现有任务仍可使用；移除后才能添加新的常用能力。',
    });
    expect(skillLimitBannerCopy({ cap: 5, enabledCount: 5, planId: 'basic' })).toEqual({
      title: '常用能力已满（5 项）',
      body: '开始其他任务前，可先移除一项常用能力，或升级套餐。',
    });
  });

  it('formats skill load errors for user-facing surfaces', () => {
    expect(skillLoadErrorCopy('  offline  ')).toEqual({
      title: '任务选项暂时无法加载',
      body: 'offline',
    });
    expect(skillLoadErrorCopy('')).toEqual({
      title: '任务选项暂时无法加载',
      body: '请稍后重试，或刷新页面后再打开能力中心。',
    });
  });

  it('describes the card badge while saving', () => {
    expect(skillCardBadge({ enabled: false, pending: false })).toBe('加入常用');
    expect(skillCardBadge({ enabled: true, pending: false })).toBe('常用');
    expect(skillCardBadge({ enabled: true, pending: true })).toBe('保存中…');
    expect(skillCardBadge({ enabled: false, pending: false, limitBlocked: true, cap: 0 })).toBe(
      '暂不可用',
    );
    expect(skillCardBadge({ enabled: false, pending: false, limitBlocked: true })).toBe('已达上限');
  });

  it('explains how enabled skill cards affect new tasks', () => {
    expect(skillCardUsageHint({ enabled: true, pending: false })).toBe('已加入常用');
    expect(skillCardUsageHint({ enabled: false, pending: false })).toBe('可加入常用');
    expect(skillCardUsageHint({ enabled: false, pending: true })).toBe('正在保存');
    expect(skillCardUsageHint({ enabled: true, pending: false, cap: 0 })).toBe(
      '当前套餐暂不可使用',
    );
    expect(skillCardUsageHint({ enabled: false, pending: false, limitBlocked: true, cap: 0 })).toBe(
      '当前套餐暂不可使用',
    );
    expect(skillCardUsageHint({ enabled: false, pending: false, limitBlocked: true })).toBe(
      '先移除一项常用能力',
    );
  });

  it('builds an editable skill task draft from a skill card', () => {
    expect(
      skillTaskDraft({
        id: ' douyin-live-ops ',
        name: ' 抖音直播与运营 ',
        description: ' 直播复盘 ',
      }),
    ).toEqual({
      skillId: 'douyin-live-ops',
      skillName: '抖音直播与运营',
      skillSource: 'manual',
      prompt: '@抖音直播与运营 ',
    });
    expect(skillTaskDraft({ id: '', name: '', description: '' })).toEqual({
      skillId: '',
      skillName: '技能',
      skillSource: 'manual',
      prompt: '@技能 ',
    });
    expect(
      skillTaskDraft(
        {
          id: 'data-report-insight',
          name: '数据报表解读',
          description: '表格分析',
        },
        ' 分析这份周报并找出异常 ',
      ),
    ).toEqual({
      skillId: 'data-report-insight',
      skillName: '数据报表解读',
      skillSource: 'manual',
      prompt: '@数据报表解读 分析这份周报并找出异常',
    });
    expect(
      skillTaskDraft(
        {
          id: 'data-report-insight',
          name: '数据报表解读',
          description: '表格分析',
        },
        ' 帮我分析销售数据 ',
        'suggested',
      ),
    ).toEqual({
      skillId: 'data-report-insight',
      skillName: '数据报表解读',
      skillSource: 'suggested',
      prompt: '帮我分析销售数据',
    });
  });

  it('keeps suggested matches non-authoritative when the composer hydrates a draft', () => {
    expect(
      skillSelectionFromTaskDraft({
        skillId: 'data-report-insight',
        skillName: '数据报表解读',
        skillSource: 'suggested',
      }),
    ).toBeNull();
    expect(
      skillSelectionFromTaskDraft({
        skillId: 'data-report-insight',
        skillName: '数据报表解读',
        skillSource: 'manual',
      }),
    ).toEqual({
      skillId: 'data-report-insight',
      skillName: '数据报表解读',
      skillSource: 'manual',
    });
    expect(
      skillSelectionFromTaskDraft({
        skillId: 'legacy-skill',
        skillName: '历史能力',
      }),
    ).toEqual({
      skillId: 'legacy-skill',
      skillName: '历史能力',
      skillSource: 'manual',
    });
  });

  it('decides whether a capability can start immediately, must enable first, or is blocked', () => {
    expect(skillStartDecision({ enabled: true, enabledCount: 5, cap: 5 })).toBe('start');
    expect(skillStartDecision({ enabled: false, enabledCount: 4, cap: 5 })).toBe(
      'enable-and-start',
    );
    expect(skillStartDecision({ enabled: false, enabledCount: 5, cap: 5 })).toBe('blocked');
    expect(skillStartDecision({ enabled: false, enabledCount: 0, cap: 0 })).toBe('blocked');
  });

  it('selects the preferred showcase capabilities without depending on server ordering', () => {
    const showcase = pickCapabilityShowcase([
      { id: 'contract-risk-review' },
      { id: 'douyin-live-ops' },
      { id: 'data-report-insight' },
      { id: 'social-media-strategy' },
    ]);

    expect(showcase.map((skill) => skill.id)).toEqual([
      'data-report-insight',
      'social-media-strategy',
      'contract-risk-review',
    ]);
  });

  it('ranks a natural-language task by the capability users actually need', () => {
    const intentSkills = normalizeSkillRows([
      {
        id: 'data-report-insight',
        name: '数据报表解读',
        category: '分析决策',
        description: '表格分析、指标归因、异常发现',
        aliases: ['数据', '报表', '复购率'],
        experience: {
          starterPrompts: ['分析这份周报，找出异常和最值得关注的变化'],
          requiredInputs: ['销售数据'],
          deliverables: ['关键发现与异常清单'],
          exampleSummary: '找出复购率下降原因',
        },
      },
      {
        id: 'contract-risk-review',
        name: '合同风险审查',
        category: '分析决策',
        description: '条款风险与修改建议',
        aliases: ['合同', '条款'],
        experience: {
          starterPrompts: ['审查这份合同'],
          requiredInputs: ['合同文件'],
          deliverables: ['风险清单'],
          exampleSummary: '标出高风险条款',
        },
      },
      {
        id: 'social-media-strategy',
        name: '社交媒体策略',
        category: '内容运营',
        description: '内容矩阵与发布节奏',
        aliases: ['社媒', '内容规划'],
        experience: {
          starterPrompts: ['规划新品发布内容'],
          requiredInputs: ['品牌目标'],
          deliverables: ['发布计划'],
          exampleSummary: '生成一周内容节奏',
        },
      },
    ]);
    const result = matchSkillsForIntent(
      intentSkills,
      '帮我分析这份销售数据，找出复购率下降的原因',
    );

    expect(result.confidence).toBe('strong');
    expect(result.matches.map((match) => match.skill.id)).toEqual([
      'data-report-insight',
      'contract-risk-review',
      'social-media-strategy',
    ]);
  });

  it('does not pretend a vague request has a reliable capability match', () => {
    const intentSkills = normalizeSkillRows([
      {
        id: 'data-report-insight',
        name: '数据报表解读',
        category: '分析决策',
        description: '表格分析',
        aliases: ['数据', '报表'],
      },
      {
        id: 'contract-risk-review',
        name: '合同风险审查',
        category: '分析决策',
        description: '条款风险',
        aliases: ['合同', '条款'],
      },
    ]);
    expect(matchSkillsForIntent(intentSkills, '帮我处理一下').confidence).toBe('low');
  });

  it.each(['帮我看看风险', '找出问题', '评估一下', '做个方案', '系统异常怎么处理'])(
    'keeps generic cross-domain intent low-confidence: %s',
    (intent) => {
      const result = matchSkillsForIntent(normalizeSkillRows(HOLADAY_SKILLS), intent);

      expect(result.confidence).toBe('low');
    },
  );

  it('still identifies an explicit domain request in the real capability catalogue', () => {
    const result = matchSkillsForIntent(normalizeSkillRows(HOLADAY_SKILLS), '帮我审查这份合同');

    expect(result.confidence).toBe('strong');
    expect(result.matches[0]?.skill.id).toBe('contract-risk-review');
  });

  it.each(['帮我做竞品分析', '对比竞品定位'])(
    'recognizes a concise but explicit competitor-research request: %s',
    (intent) => {
      const result = matchSkillsForIntent(normalizeSkillRows(HOLADAY_SKILLS), intent);

      expect(result.confidence).toBe('strong');
      expect(result.matches[0]?.skill.id).toBe('market-competitor-insight');
    },
  );

  it.each([
    ['推荐一只股票', 'a-share-market-briefing'],
    ['这只股票能不能买', 'a-share-market-briefing'],
    ['帮我选一只股票', 'a-share-market-briefing'],
    ['帮我挑几只个股', 'a-share-market-briefing'],
    ['把这只股票卖掉', 'a-share-market-briefing'],
    ['买哪只股票', 'a-share-market-briefing'],
    ['帮我把这只股票清仓', 'a-share-market-briefing'],
    ['替我交易这只股票', 'a-share-market-briefing'],
    ['先分析这只股票的风险并为我执行交易', 'a-share-market-briefing'],
    ['先看一下这只股票再为我交易', 'a-share-market-briefing'],
    ['分析完后买入这只股票', 'a-share-market-briefing'],
    ['清仓这只股票', 'a-share-market-briefing'],
    ['加仓这只股票', 'a-share-market-briefing'],
    ['减仓这只股票', 'a-share-market-briefing'],
    ['建仓这只股票', 'a-share-market-briefing'],
    ['卖掉这只股票', 'a-share-market-briefing'],
    ['交易这只股票', 'a-share-market-briefing'],
    ['购买这只股票', 'a-share-market-briefing'],
    ['购入这只股票', 'a-share-market-briefing'],
    ['把这只股票抛掉', 'a-share-market-briefing'],
    ['下单买这只股票', 'a-share-market-briefing'],
    ['录用候选人', 'resume-search-screening'],
    ['淘汰这份简历', 'resume-search-screening'],
    ['拒绝这份简历', 'resume-search-screening'],
    ['给我决定录用哪个候选人', 'resume-search-screening'],
    ['帮我选一位候选人录用', 'resume-search-screening'],
    ['解释原因后直接录用这个候选人', 'resume-search-screening'],
    ['分析为什么候选人被拒绝，然后直接录用他', 'resume-search-screening'],
    ['分析为什么应该录用这个候选人并替我直接录用他', 'resume-search-screening'],
    ['录用候选人并解释原因', 'resume-search-screening'],
    ['先分析候选人的经历，再决定是否录用', 'resume-search-screening'],
    ['分析候选人后帮我做录用决定', 'resume-search-screening'],
    ['比较候选人然后选出最终录用人选', 'resume-search-screening'],
    ['替我做招聘决定', 'resume-search-screening'],
    ['基于性别筛选候选人', 'resume-search-screening'],
    ['只招男性候选人', 'resume-search-screening'],
    ['不要女候选人', 'resume-search-screening'],
    ['不要录用女性候选人', 'resume-search-screening'],
    ['不要选择女性候选人', 'resume-search-screening'],
    ['不要筛选出女性候选人', 'resume-search-screening'],
    ['不要筛选通过女性候选人', 'resume-search-screening'],
    ['禁止过滤录用女性候选人', 'resume-search-screening'],
    ['只筛选30岁以下的候选人', 'resume-search-screening'],
    ['筛掉已婚候选人', 'resume-search-screening'],
    ['按出生地筛选候选人', 'resume-search-screening'],
    ['优先录用男候选人', 'resume-search-screening'],
    ['帮我发布公众号文章', 'wechat-article-ops'],
    ['发布这篇小红书笔记', 'xiaohongshu-seeding-ops'],
    ['替我投放抖音广告', 'douyin-live-ops'],
    ['自动发布全平台内容', 'social-media-strategy'],
    ['保证小红书流量', 'xiaohongshu-seeding-ops'],
    ['保证不低于十万小红书流量', 'xiaohongshu-seeding-ops'],
    ['保证不少于十万小红书流量', 'xiaohongshu-seeding-ops'],
    ['保证不会低于十万小红书流量', 'xiaohongshu-seeding-ops'],
    ['保证不能低于十万小红书流量', 'xiaohongshu-seeding-ops'],
    ['保证不能少于十万小红书流量', 'xiaohongshu-seeding-ops'],
    ['不得不保证小红书流量', 'xiaohongshu-seeding-ops'],
    ['不能不保证小红书流量', 'xiaohongshu-seeding-ops'],
    ['不会不保证小红书流量', 'xiaohongshu-seeding-ops'],
    ['不是不保证小红书流量', 'xiaohongshu-seeding-ops'],
    ['并非不保证小红书流量', 'xiaohongshu-seeding-ops'],
    ['帮我把这篇公众号文章发出去', 'wechat-article-ops'],
    ['把这篇小红书笔记发布出去', 'xiaohongshu-seeding-ops'],
    ['在公众号上发布这篇文章', 'wechat-article-ops'],
    ['将这条视频上传到抖音', 'douyin-live-ops'],
    ['一键发布全平台内容', 'social-media-strategy'],
    ['给这条抖音视频投流', 'douyin-live-ops'],
    ['保证这篇笔记成为爆款', 'xiaohongshu-seeding-ops'],
    ['帮我把这篇文章发到公众号', 'wechat-article-ops'],
    ['发一下这篇公众号文章', 'wechat-article-ops'],
    ['推送这篇公众号文章', 'wechat-article-ops'],
    ['写一篇公众号文章并发布', 'wechat-article-ops'],
    ['投放这条抖音广告', 'douyin-live-ops'],
    ['把这篇笔记投薯条', 'xiaohongshu-seeding-ops'],
    ['先说明不能保证小红书流量然后保证销量', 'xiaohongshu-seeding-ops'],
    ['虽然不能保证抖音流量但确保播放量', 'douyin-live-ops'],
    ['不能承诺流量但保证这篇小红书笔记成为爆款', 'xiaohongshu-seeding-ops'],
    ['筛选女性候选人', 'resume-search-screening'],
    ['女性候选人不要', 'resume-search-screening'],
    ['男候选人优先', 'resume-search-screening'],
    ['优先考虑男性候选人', 'resume-search-screening'],
    ['只录用未婚候选人', 'resume-search-screening'],
    ['保证用 Midjourney 完全复现这张图片', 'image-prompt-reverse'],
    ['用这张未授权图片直接商用', 'image-prompt-reverse'],
    ['基于这份合同替我出具正式法律意见', 'contract-risk-review'],
    ['审查这份合同并出具正式法律意见', 'contract-risk-review'],
    ['竞品数据无法核实也直接写成事实', 'market-competitor-insight'],
    ['分析这份报表并把相关性直接写成因果结论', 'data-report-insight'],
    ['自动批准这个产品需求', 'product-plan-drafting'],
    ['替研发确认这个产品方案技术可行', 'product-plan-drafting'],
    ['未经授权自动指派项目负责人', 'project-delivery-management'],
    ['替团队承诺项目最终排期', 'project-delivery-management'],
    ['替我做绩效决定', 'performance-review-design'],
    ['根据绩效直接决定员工涨薪', 'performance-review-design'],
    ['一键推送这条抖音视频并分析效果', 'douyin-live-ops'],
    ['发布这篇小红书笔记并分析效果', 'xiaohongshu-seeding-ops'],
    ['小红书笔记保底十万流量', 'xiaohongshu-seeding-ops'],
    ['一键推送这篇公众号文章', 'wechat-article-ops'],
    ['一键发布全平台内容并给出规划方案', 'social-media-strategy'],
    ['保证生成的图片和原图一模一样', 'image-prompt-reverse'],
    ['这张图片未经许可但拿去商用', 'image-prompt-reverse'],
    ['把这只股票出掉', 'a-share-market-briefing'],
    ['替我炒这只股票', 'a-share-market-briefing'],
    ['审完合同后出具正式法律意见', 'contract-risk-review'],
    ['竞品调研数据没法验证也不要标注待确认', 'market-competitor-insight'],
    ['根据报表相关性断定因果关系', 'data-report-insight'],
    ['看完产品需求后替我拍板通过', 'product-plan-drafting'],
    ['直接认定这个产品方案技术可行', 'product-plan-drafting'],
    ['替我向客户承诺这个项目的最终排期', 'project-delivery-management'],
    ['自动把项目任务负责人改成张三', 'project-delivery-management'],
    ['分析招聘规则然后只招男性候选人', 'resume-search-screening'],
    ['检查招聘规则后筛选女性候选人', 'resume-search-screening'],
    ['看完绩效后决定给员工涨薪', 'performance-review-design'],
    ['按照绩效给员工涨薪', 'performance-review-design'],
    ['说明不能保证图片完全复现，然后保证生成图和原图一模一样', 'image-prompt-reverse'],
    ['分析这份合同为什么不能替代律师，然后出具正式法律意见', 'contract-risk-review'],
    ['检查未经核实的竞品信息是否写成事实，然后不要标注待确认', 'market-competitor-insight'],
    ['说明相关性不能证明因果，然后根据报表相关性断定因果', 'data-report-insight'],
    ['说明不能自动批准需求，然后自动批准这个产品需求', 'product-plan-drafting'],
    ['说明不能替团队承诺排期，然后替团队承诺最终排期', 'project-delivery-management'],
    ['分析不能根据绩效决定涨薪，然后按照绩效给员工涨薪', 'performance-review-design'],
    ['规划发布节奏后再一键推送公众号文章', 'wechat-article-ops'],
    ['分析效果后仍然发布这篇小红书笔记', 'xiaohongshu-seeding-ops'],
    ['检查歧视风险后优先面试男性候选人', 'resume-search-screening'],
    ['把合同审查结果当成律师正式意见', 'contract-risk-review'],
    ['给这个产品需求盖章放行', 'product-plan-drafting'],
    ['看绩效后把员工开了', 'performance-review-design'],
    ['检查招聘要求是否存在性别歧视，然后筛掉女性候选人', 'resume-search-screening'],
    ['检查招聘要求是否存在性别歧视并筛掉女性候选人', 'resume-search-screening'],
    ['检查招聘要求是否存在性别歧视并把女性候选人筛掉', 'resume-search-screening'],
    ['检查招聘要求是否存在性别歧视并将女性候选人过滤掉', 'resume-search-screening'],
    ['按照绩效辞退员工', 'performance-review-design'],
    ['按绩效辞退员工', 'performance-review-design'],
    ['依据考核给员工涨薪', 'performance-review-design'],
    ['把这张图片用于商业但没有授权', 'image-prompt-reverse'],
    ['只招汉族候选人', 'resume-search-screening'],
    ['只招回族候选人', 'resume-search-screening'],
    ['检查招聘要求是否存在性别歧视。筛掉女性候选人', 'resume-search-screening'],
    ['只招同性恋候选人', 'resume-search-screening'],
    ['只招黑人候选人', 'resume-search-screening'],
    ['只招白人候选人', 'resume-search-screening'],
    ['只招基督徒候选人', 'resume-search-screening'],
    ['只招穆斯林候选人', 'resume-search-screening'],
    ['只招佛教徒候选人', 'resume-search-screening'],
    ['只招东正教徒候选人', 'resume-search-screening'],
    ['只招新教徒候选人', 'resume-search-screening'],
    ['买入贵州茅台股票', 'a-share-market-briefing'],
    ['卖出宁德时代股票', 'a-share-market-briefing'],
    ['买进贵州茅台股票', 'a-share-market-briefing'],
    ['购买比亚迪股票', 'a-share-market-briefing'],
    ['抛售宁德时代股票', 'a-share-market-briefing'],
    ['请购入贵州茅台股票', 'a-share-market-briefing'],
    ['帮我买进贵州茅台股票', 'a-share-market-briefing'],
    ['购进贵州茅台股票', 'a-share-market-briefing'],
    ['推荐贵州茅台股票', 'a-share-market-briefing'],
    ['建仓贵州茅台股票', 'a-share-market-briefing'],
    ['清仓贵州茅台股票', 'a-share-market-briefing'],
    ['加仓宁德时代股票', 'a-share-market-briefing'],
    ['减仓比亚迪股票', 'a-share-market-briefing'],
    ['这只股票应该继续持有吗', 'a-share-market-briefing'],
    ['这只股票值得投资吗', 'a-share-market-briefing'],
    ['是否值得投资这只股票', 'a-share-market-briefing'],
    ['这只股票适合长期投资吗', 'a-share-market-briefing'],
    ['建议投资贵州茅台股票', 'a-share-market-briefing'],
    ['分析这份报表并把相关性解释为因果关系', 'data-report-insight'],
    ['把报表相关关系表述为因果结论', 'data-report-insight'],
    ['把报表相关性解释成因果关系', 'data-report-insight'],
    ['只招中国籍候选人', 'resume-search-screening'],
    ['只招外国人候选人', 'resume-search-screening'],
    ['只招美国籍候选人', 'resume-search-screening'],
    ['只招外籍候选人', 'resume-search-screening'],
    ['只招党员候选人', 'resume-search-screening'],
    ['只招群众候选人', 'resume-search-screening'],
    ['只招无党派候选人', 'resume-search-screening'],
    ['只招没有乙肝的候选人', 'resume-search-screening'],
    ['从这些简历里挑一个入职', 'resume-search-screening'],
    ['建议录用哪位候选人', 'resume-search-screening'],
    ['建议哪位候选人入职', 'resume-search-screening'],
    ['哪个候选人应该录用', 'resume-search-screening'],
    ['哪位候选人最适合入职', 'resume-search-screening'],
    ['这几个候选人谁最适合录用', 'resume-search-screening'],
    ['检查招聘要求是否存在性别歧视\n筛掉女性候选人', 'resume-search-screening'],
    ['检查招聘要求是否存在性别歧视以及筛掉女性候选人', 'resume-search-screening'],
    ['分析只招女性候选人的歧视风险接着只招女性候选人', 'resume-search-screening'],
    ['保证公众号文章阅读量十万', 'wechat-article-ops'],
    ['保证这篇小红书笔记点赞过万', 'xiaohongshu-seeding-ops'],
    ['保证抖音视频曝光百万', 'douyin-live-ops'],
    ['确保公众号文章打开率达到50%', 'wechat-article-ops'],
    ['不保证流量但承诺这篇笔记点赞过万', 'xiaohongshu-seeding-ops'],
    ['用报表相关性证明因果关系', 'data-report-insight'],
    ['根据这份报表相关性推导出因果关系', 'data-report-insight'],
    ['绝非不保证小红书流量', 'xiaohongshu-seeding-ops'],
    ['没有不保证抖音视频流量', 'douyin-live-ops'],
    ['审查合同条款然后保证小红书流量', 'contract-risk-review'],
    ['审查合同条款最终保证小红书流量', 'contract-risk-review'],
    ['审查合同条款以后保证小红书流量', 'contract-risk-review'],
    ['审查合同条款还要保证小红书流量', 'contract-risk-review'],
    ['审查合同条款接下来保证小红书流量', 'contract-risk-review'],
    ['审查这份合同条款另外保证小红书流量', 'contract-risk-review'],
    ['审查合同条款后保证小红书流量顺便修改条款', 'contract-risk-review'],
    ['审查合同条款以后保证小红书流量以及修改条款', 'contract-risk-review'],
    ['审查合同条款涉及的风险处理后保证小红书流量', 'contract-risk-review'],
    ['审查合同条款涉及风险还要保证小红书流量', 'contract-risk-review'],
    ['审查合同条款提到风险以后保证小红书流量', 'contract-risk-review'],
    ['审查合同条款后保证小红书流量并签合同', 'contract-risk-review'],
    ['审查合同条款以后保证小红书流量并签合同', 'contract-risk-review'],
    ['审查合同条款最终保证小红书流量并签订合同', 'contract-risk-review'],
    ['审查合同条款还要保证小红书流量并签协议', 'contract-risk-review'],
    ['审查合同条款接下来保证小红书流量并签合同', 'contract-risk-review'],
    ['审查合同并撰写正式法律意见书', 'contract-risk-review'],
    ['审查合同并生成正式法律意见书', 'contract-risk-review'],
    ['审查合同并起草正式法律意见书', 'contract-risk-review'],
    ['把项目任务自动分配给张三', 'project-delivery-management'],
    ['把项目负责人自动改成张三', 'project-delivery-management'],
    ['自动删除项目任务', 'project-delivery-management'],
    ['把这个项目任务自动移除', 'project-delivery-management'],
    ['项目任务自动分配给张三', 'project-delivery-management'],
    ['项目任务自动删除', 'project-delivery-management'],
    ['做竞品调研时不用标记未经核实的信息', 'market-competitor-insight'],
    ['把这篇文章发公众号', 'wechat-article-ops'],
    ['按绩效扣员工奖金', 'performance-review-design'],
    ['依据考核扣除奖金', 'performance-review-design'],
    ['根据绩效降低员工薪资', 'performance-review-design'],
    ['按绩效调整员工薪资', 'performance-review-design'],
    ['员工绩效不达标就扣奖金', 'performance-review-design'],
    ['扣除绩效不佳员工的奖金', 'performance-review-design'],
    ['请批准这个产品需求', 'product-plan-drafting'],
    ['请确认这个产品方案技术可行', 'product-plan-drafting'],
    ['这个产品需求请批准', 'product-plan-drafting'],
    ['确认技术上可行的产品方案', 'product-plan-drafting'],
  ])('does not strongly match a request that conflicts with %s capability boundaries', (intent, skillId) => {
    const result = matchSkillsForIntent(normalizeSkillRows(HOLADAY_SKILLS), intent);

    expect(result.matches[0]?.skill.id).toBe(skillId);
    expect(result.confidence).toBe('low');
  });

  it.each([
    ['分析这只股票最近的异动', 'a-share-market-briefing'],
    ['分析为什么机构买入这只股票', 'a-share-market-briefing'],
    ['解释这只股票出现买入信号的原因', 'a-share-market-briefing'],
    ['分析买入后这只股票的走势', 'a-share-market-briefing'],
    ['分析股票买入卖出成交数据', 'a-share-market-briefing'],
    ['分析股票交易量数据', 'a-share-market-briefing'],
    ['帮我进行股票交易复盘', 'a-share-market-briefing'],
    ['帮我进行股票交易的历史数据分析', 'a-share-market-briefing'],
    ['根据 JD 筛选候选人', 'resume-search-screening'],
    ['分析为什么这个候选人被拒绝', 'resume-search-screening'],
    ['解释候选人被拒绝后的改进方向', 'resume-search-screening'],
    ['解释为什么公司决定录用这个候选人', 'resume-search-screening'],
    ['检查招聘要求是否存在性别歧视', 'resume-search-screening'],
    ['不要基于性别筛选候选人', 'resume-search-screening'],
    ['不要基于性别筛选候选人。', 'resume-search-screening'],
    ['不要筛选女性候选人', 'resume-search-screening'],
    ['不要过滤掉女性候选人', 'resume-search-screening'],
    ['禁止按照年龄过滤简历', 'resume-search-screening'],
    ['禁止按照年龄过滤简历！', 'resume-search-screening'],
    ['帮我写一篇公众号文章', 'wechat-article-ops'],
    ['规划小红书发布节奏', 'xiaohongshu-seeding-ops'],
    ['分析抖音投流数据', 'douyin-live-ops'],
    ['帮我分析抖音投流数据', 'douyin-live-ops'],
    ['制定社交媒体广告投放方案', 'social-media-strategy'],
    ['发布节奏怎么规划', 'social-media-strategy'],
    ['分析为什么无法保证小红书流量', 'xiaohongshu-seeding-ops'],
    ['不能保证小红书流量的说明', 'xiaohongshu-seeding-ops'],
    ['不要遗漏女性候选人', 'resume-search-screening'],
    ['优先分析女性候选人的经历', 'resume-search-screening'],
    ['发布内容怎么规划', 'social-media-strategy'],
    ['无法百分百保证小红书流量', 'xiaohongshu-seeding-ops'],
    ['分析为什么保证不了小红书流量', 'xiaohongshu-seeding-ops'],
    ['分析为什么保证不到小红书流量', 'xiaohongshu-seeding-ops'],
    ['分析为什么保证不能达到十万小红书流量', 'xiaohongshu-seeding-ops'],
    ['不保证小红书流量', 'xiaohongshu-seeding-ops'],
    ['以后不再保证小红书流量', 'xiaohongshu-seeding-ops'],
    ['必须不保证小红书流量', 'xiaohongshu-seeding-ops'],
    ['小红书运营不会保证流量', 'xiaohongshu-seeding-ops'],
    ['我们不会承诺抖音播放量', 'douyin-live-ops'],
    ['分析为什么公司不招女性候选人', 'resume-search-screening'],
    ['检查只招男性候选人的要求是否歧视', 'resume-search-screening'],
    ['分析这张图片的风格并给出提示词', 'image-prompt-reverse'],
    ['审查合同并标出风险', 'contract-risk-review'],
    ['审查保证销量条款的合同', 'contract-risk-review'],
    ['审查一份包含保证小红书流量的合同条款', 'contract-risk-review'],
    ['审查保证小红书流量的合同条款', 'contract-risk-review'],
    ['审查协议中承诺阅读量的约定', 'contract-risk-review'],
    ['审查合同条款涉及保证小红书流量的约定', 'contract-risk-review'],
    ['审查合同内容中的保证销量条款', 'contract-risk-review'],
    ['根据公开信息做竞品分析并标记待确认', 'market-competitor-insight'],
    ['分析报表的相关性并说明不能证明因果', 'data-report-insight'],
    ['整理产品需求并生成 PRD 初稿', 'product-plan-drafting'],
    ['拆解项目里程碑并给出负责人建议', 'project-delivery-management'],
    ['设计绩效评估表和评分规则', 'performance-review-design'],
    ['不保证用 Midjourney 完全复现这张图片', 'image-prompt-reverse'],
    ['说明为什么这份合同审查不能替代律师意见', 'contract-risk-review'],
    ['检查未经核实的竞品调研信息是否被写成事实', 'market-competitor-insight'],
    ['说明报表相关性不能直接证明因果', 'data-report-insight'],
    ['说明为什么不能自动批准这个产品需求', 'product-plan-drafting'],
    ['说明为什么不能替团队承诺项目最终排期', 'project-delivery-management'],
    ['分析为什么不能根据绩效直接决定员工涨薪', 'performance-review-design'],
    ['分析保证完全还原图片会有什么风险', 'image-prompt-reverse'],
    ['分析保证完全还原图片会有什么后果', 'image-prompt-reverse'],
    ['分析合并图片后保证完全还原会有什么后果', 'image-prompt-reverse'],
    ['评估出具正式法律意见是否超出合同审查范围', 'contract-risk-review'],
    ['分析自动批准产品需求为什么有风险', 'product-plan-drafting'],
    ['评估根据绩效直接决定涨薪的合规风险', 'performance-review-design'],
    ['评估按绩效辞退员工的合规风险', 'performance-review-design'],
    ['分析为什么不能把女性候选人筛掉', 'resume-search-screening'],
    ['分析把女性候选人筛掉会有什么风险', 'resume-search-screening'],
    ['评估把女性候选人筛掉的歧视风险', 'resume-search-screening'],
    ['分析只招白人候选人的歧视风险', 'resume-search-screening'],
    ['分析为什么公司只招基督徒候选人', 'resume-search-screening'],
    ['分析只招中国籍候选人的歧视风险', 'resume-search-screening'],
    ['分析为什么不能把相关性解释为因果关系', 'data-report-insight'],
    ['说明为什么不能把报表相关性表述成因果关系', 'data-report-insight'],
    ['买入贵州茅台股票的历史收益分析', 'a-share-market-briefing'],
    ['卖出宁德时代股票的历史交易记录分析', 'a-share-market-briefing'],
    ['买入贵州茅台股票后的最大回撤分析', 'a-share-market-briefing'],
    ['卖出宁德时代股票后的机会成本分析', 'a-share-market-briefing'],
    ['分析为什么不能根据相关性推导因果', 'data-report-insight'],
    ['分析在公众号上发布文章的效果', 'wechat-article-ops'],
    ['复盘在抖音上发布视频的数据', 'douyin-live-ops'],
    ['帮我分析在公众号上发布文章的效果', 'wechat-article-ops'],
    ['请复盘在抖音上发布视频的数据', 'douyin-live-ops'],
    ['筛选女装设计师候选人', 'resume-search-screening'],
  ])('keeps a supported %s request strongly matched', (intent, skillId) => {
    const result = matchSkillsForIntent(normalizeSkillRows(HOLADAY_SKILLS), intent);

    expect(result.confidence).toBe('strong');
    expect(result.matches[0]?.skill.id).toBe(skillId);
  });

  it('does not offer switchable matches when any relevant candidate conflicts with its boundary', () => {
    const result = matchSkillsForIntent(
      normalizeSkillRows(HOLADAY_SKILLS),
      '分析 A 股股票行情异动，另外审查合同并出具正式法律意见',
    );
    expect(result.matches[0]?.skill.id).toBe('a-share-market-briefing');
    expect(result.matches.find((match) => match.skill.id === 'contract-risk-review')?.score).toBeGreaterThanOrEqual(9);
    expect(result.confidence).toBe('low');
  });

  it.each([
    ['微信登录异常怎么处理', 'wechat-article-ops'],
    ['Sora登录异常怎么处理', 'image-prompt-reverse'],
    ['Midjourney账号登不上', 'image-prompt-reverse'],
    ['Boss直聘登录异常怎么处理', 'resume-search-screening'],
  ])('does not promote a broad platform or tool name without task evidence: %s', (intent, skillId) => {
    const result = matchSkillsForIntent(normalizeSkillRows(HOLADAY_SKILLS), intent);

    expect(result.matches[0]?.skill.id).toBe(skillId);
    expect(result.confidence).toBe('low');
  });

  it.each([
    '设计绩效评估表和评分规则然后出具正式法律意见',
    '设计绩效评估表和评分规则，然后把未经核实的竞品数据直接当成事实',
  ])('checks boundary conflicts even when their candidate score is low: %s', (intent) => {
    expect(matchSkillsForIntent(normalizeSkillRows(HOLADAY_SKILLS), intent).confidence).toBe(
      'low',
    );
  });

  it('falls back to available capabilities when preferred showcase entries are missing', () => {
    expect(
      pickCapabilityShowcase([{ id: 'first' }, { id: 'second' }]).map((skill) => skill.id),
    ).toEqual(['first', 'second']);
  });

  it('uses honest connector labels without implying account connection state', () => {
    expect(skillConnectorLabel('browser')).toBe('浏览器');
    expect(skillConnectorLabel('spreadsheet')).toBe('表格');
    expect(skillConnectorLabel('new-connector')).toBe('new-connector');
  });

  it('normalizes skill list payloads before rendering', () => {
    expect(
      normalizeSkillRows([
        {
          id: ' content ',
          name: ' 内容助手 ',
          logoId: ' social-media-strategy ',
          category: '内容运营',
          description: ' 写作 ',
          aliases: [' 社媒 ', ''],
          maturity: 'workflow',
          connectors: [' browser ', ''],
          experience: {
            starterPrompts: [' 示例一 ', '示例二', '示例三', '超出上限'],
            requiredInputs: [' 文件 ', ''],
            deliverables: [' 报告 ', ''],
            boundary: ' 需要人工确认 ',
            exampleSummary: ' 示例摘要 ',
          },
          enabled: true,
        },
        {
          id: 'loose',
          name: '',
          category: 'bad',
          description: null,
          aliases: 'bad',
          maturity: 'bad',
          connectors: null,
          enabled: 'yes',
        },
        { id: 'content', name: 'duplicate', category: '内容运营' },
        { id: '', name: 'empty' },
        null,
      ]),
    ).toEqual([
      {
        id: 'content',
        name: '内容助手',
        logoId: 'social-media-strategy',
        category: '内容运营',
        description: '写作',
        aliases: ['社媒'],
        maturity: 'workflow',
        connectors: ['browser'],
        experience: {
          starterPrompts: ['示例一', '示例二', '示例三'],
          requiredInputs: ['文件'],
          deliverables: ['报告'],
          boundary: '需要人工确认',
          exampleSummary: '示例摘要',
        },
        enabled: true,
      },
      {
        id: 'loose',
        name: 'loose',
        logoId: 'loose',
        category: '内容运营',
        description: '暂未提供说明',
        aliases: [],
        maturity: 'template',
        connectors: [],
        experience: {
          starterPrompts: [],
          requiredInputs: [],
          deliverables: [],
          boundary: '执行前请确认输入材料、授权范围和最终用途。',
          exampleSummary: '暂无示例说明',
        },
        enabled: false,
      },
    ]);
  });

  it('normalizes malformed skill list payloads to empty', () => {
    expect(normalizeSkillRows(null)).toEqual([]);
    expect(normalizeSkillRows({ id: 'skill' })).toEqual([]);
  });

  it('normalizes toggle responses with an optimistic fallback', () => {
    expect(normalizeSkillToggleResponse({ enabled: false }, true)).toEqual({
      enabled: false,
    });
    expect(normalizeSkillToggleResponse({ enabled: 'bad' }, true)).toEqual({
      enabled: true,
    });
    expect(normalizeSkillToggleResponse(null, false)).toEqual({
      enabled: false,
    });
  });
});
