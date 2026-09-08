import { describe, expect, it } from 'vitest';
import { buildContract, classifyIntentForOutputRequirement } from './execution-contract.js';

describe('classifyIntentForOutputRequirement — output scope', () => {
  it('keeps a finite default for an unrepresentable requested product count', () => {
    const intent = `列出京东${'9'.repeat(309)}款商品的价格和链接`;
    expect(classifyIntentForOutputRequirement(intent).requirement).toEqual({
      kind: 'ecommerce',
      minItems: 5,
      sortOrder: null,
    });
  });
  it.each([
    '电商内容策划，生成3个选题',
    '围绕电商价格话题生成3个标题',
    '给京东写5条广告文案',
    '为商品价格栏目生成3个标题',
    '为软件产品设计3款图标方案，只写创意说明',
    '为京东设计3款海报，只写创意说明',
    '生成3个小红书选题。\n\n[用户补充]\n抖音直播复盘与电商罗盘只作为背景词，不切换技能。\n\n[用户补充]\n确认',
  ])('does not impose product rows on content requests: %s', (intent) => {
    expect(classifyIntentForOutputRequirement(intent)).toEqual({
      kind: 'general',
      requirement: null,
    });
    const contract = buildContract({
      taskId: 'synthetic_content',
      intent,
      executionMode: 'generate',
      expertWorkflowId: 'content-topic',
    });
    expect(
      contract.successCriteria.some(
        (c) => c.type === 'result_count' || c.type === 'ecommerce_rows',
      ),
    ).toBe(false);
  });

  it.each([
    ['列出京东前5款商品的名称、价格和链接', 5],
    ['生成3个选题，另列5款京东商品的名称、价格和链接', 5],
    ['生成3个选题并列出5款京东商品的名称、价格和链接', 5],
    ['列出5款京东商品的名称价格和链接并为它们写3个标题', 5],
    ['不采购，只整理3款商品的价格和链接', 3],
    ['写3个选题。查询京东手机价格，列前5个结果及链接', 5],
    ['生成3个选题，再对比京东、天猫两家平台的手机价格', 2],
    ['List top 3 products on Amazon with prices and links', 3],
    ['手机销量排行榜前5名，请给名称、价格、链接', 5],
    ['列出京东5款用于海报设计的显示器价格和链接', 5],
    ['写3个标题并推荐5款京东商品的名称价格和链接', 5],
    ['为3名同事推荐京东5款耳机，附价格和链接', 5],
    ['Find top 3 laptops on Amazon with prices and links', 3],
    ['生成京东3款商品的标题、价格和链接清单', 3],
    ['请写出京东3款商品的标题、价格和链接', 3],
    ['生成京东3款商品的标题和价格清单', 3],
    ['请写出京东3款商品的标题，价格和链接', 3],
    ['列出3个京东商品', 3],
    ['生成3个京东商品的标题和价格清单', 3],
    ['给出京东排名前3的结果，候选是10款商品', 3],
  ])('keeps quantities attached to requested products: %s', (intent, minItems) => {
    expect(classifyIntentForOutputRequirement(intent)).toEqual({
      kind: 'ecommerce_listing',
      requirement: { kind: 'ecommerce', minItems, sortOrder: null },
    });
  });

  it('retains search, count and ordering across sentences', () => {
    expect(classifyIntentForOutputRequirement('去京东搜手机。按价格升序给前3个结果和链接')).toEqual(
      {
        kind: 'ecommerce_listing',
        requirement: { kind: 'ecommerce', minItems: 3, sortOrder: 'asc' },
      },
    );
  });
});
