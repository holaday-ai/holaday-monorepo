/** FIX-57 协调方第 2 次代体验 + 复审 #5 (web side). */
import { describe, expect, it } from 'vitest';
import {
  failureTurn,
  hasInternalRef,
  liveStatusText,
  partialLoginStep,
  stripInternalRefs,
} from './assistant-turn';

const JD_INTENT =
  '请使用云端浏览器，打开 https://item.jd.com/100142621606.html 读商品标题和页面显示的价格';

describe('协调方第 2 次代体验 · 京东 partial offers 「你登录，我帮你读」', () => {
  it('a masked price behind a login: the login step comes first', () => {
    const step = partialLoginStep({
      text: '价格显示为 ¥7??9，因为没登录被京东打了码，完整价格需要登录后才能看到。',
      intent: JD_INTENT,
      finalUrl: 'https://item.m.jd.com/product/100142621606.html',
    });
    expect(step?.label).toBe('你在浏览器里登录京东，我帮你读准确价格');
    expect(step?.prompt).toContain('我会在浏览器里自己登录京东');
    expect(step?.prompt).toContain(JD_INTENT);
  });

  it('nothing about a login, or no task: no step', () => {
    expect(
      partialLoginStep({ text: '第 3 款没找到价格。', intent: JD_INTENT, finalUrl: null }),
    ).toBeNull();
    expect(partialLoginStep({ text: '要登录才显示', intent: '', finalUrl: null })).toBeNull();
  });

  it('not a price task: 「完整内容」', () => {
    expect(
      partialLoginStep({
        text: '回答要登录才显示全文。',
        intent: '打开 https://www.zhihu.com/question/22045646 读第一个回答',
        finalUrl: null,
      })?.label,
    ).toBe('你在浏览器里登录知乎，我帮你读完整内容');
  });
});

describe('协调方第 2 次代体验 · data-source names never shown', () => {
  it.each([
    ['上证 3,689.91（来源 akshare:stock_zh_index_spot_sina · 抓取 08:55）', '上证 3,689.91'],
    ['数据来源 AkShare', '数据来源公开行情数据'],
    ['走 sina 接口拿的', '走新浪财经拿的'],
  ])('%s', (text, out) => {
    expect(stripInternalRefs(text)).toBe(out);
  });

  it('a suggestion naming the interface is dropped', () => {
    expect(hasInternalRef('再用 stock_zh_index_spot_sina 拉一次？')).toBe(true);
  });
});

describe('协调方第 3 次代体验 · generate-lane failure reads like talk', () => {
  it('亚马逊新加坡站 USB C 线价格 (generate, 质量校验未通过): no internal words; open the site first', () => {
    const turn = failureTurn({
      status: 'failed',
      errorText: '质量校验未通过：没有通过格式或数据规则检查',
      intent: '亚马逊新加坡站 USB C 线价格',
      executionMode: 'generate',
      canRetry: true,
    });
    expect(turn.lead).toBe('这次没拿到亚马逊新加坡站的实时价格。');
    expect(`${turn.lead}${turn.why}`).not.toMatch(/质量校验|格式或数据规则|说得更具体/);
    expect(turn.options[0]).toEqual({
      kind: 'prompt',
      label: '打开亚马逊新加坡站帮你实时查',
      prompt: '请使用云端浏览器，亚马逊新加坡站 USB C 线价格',
    });
    expect(turn.options[1]).toEqual({ kind: 'retry', label: '再试一次' });
  });

  it('an internal check failure without a named site: plain words, never the check name', () => {
    const turn = failureTurn({
      status: 'failed',
      errorText: '质量校验未通过：没有通过格式或数据规则检查',
      intent: '帮我写一份周报提纲',
      executionMode: 'generate',
      canRetry: true,
    });
    expect(turn.lead).toBe('这次没拿到你要的结果：答案没通过我自己的核对，所以没交给你。');
    expect(`${turn.lead}${turn.why}`).not.toMatch(/质量校验|格式或数据规则|说得更具体/);
  });

  it('already in the browser: no 「打开…」 offer again', () => {
    const turn = failureTurn({
      status: 'failed',
      errorText: '质量校验未通过：没有通过格式或数据规则检查',
      intent: '请使用云端浏览器，在亚马逊新加坡站搜 usb c cable 看价格',
      executionMode: 'browser',
      canRetry: true,
    });
    expect(turn.lead).toBe('这次没拿到亚马逊新加坡站的实时价格。');
    expect(turn.options.map((o) => o.label)).toEqual(['再试一次']);
  });
});

describe('复审 #6 · the status line never quotes a role name', () => {
  const click = (actionSummary: string) =>
    liveStatusText({
      steps: [{ stepId: 's1', status: 'running', actionKind: 'click', actionSummary } as never],
    });
  it.each(['点击 generic', '点击 「generic」', '点击 div', '点击 img', '点击 link', '点击 button'])(
    '%s → a plain sentence',
    (summary) => {
      expect(click(summary)).toBe('正在点页面上的一个选项…');
    },
  );
  it('readable text is quoted, its role word dropped', () => {
    expect(click('点击 button 搜索')).toBe('正在点「搜索」…');
    expect(click('点击 加入购物车')).toBe('正在点「加入购物车」…');
  });
});
