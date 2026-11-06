/** FIX-57 协调方第 2 次代体验 + 复审 #5 (web side). */
import { describe, expect, it } from 'vitest';
import {
  failureTurn,
  hasInternalRef,
  liveStatusText,
  partialLead,
  partialLoginStep,
  splitUnverifiedNote,
  stripInternalRefs,
} from './assistant-turn';
import { optionLabelFor, rememberOptionLabel, resetOptionLabels } from './sent-option-labels';

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
    expect(turn.lead).toBe('周报提纲这次没写好，我再写一次？');
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

describe("复审 #7 · failures say what was not done, in the task's language", () => {
  const fail = (errorText: string, intent: string, executionMode = 'generate') =>
    failureTurn({ status: 'failed', errorText, intent, executionMode, canRetry: true });

  it.each([
    ['写一份周报', '质量门禁未通过', '周报这次没写好，我再写一次？'],
    ['把这段话翻译成英文', '结果复核未通过', '这段翻译这次没做好，我再翻一次？'],
    [
      '整理会议纪要',
      '质量校验未通过：没有通过格式或数据规则检查',
      '会议纪要这次没整理好，我再整理一次？',
    ],
    ['帮我做一个旅行清单', '质量门禁未通过', '旅行清单这次没做好，我再做一次？'],
    ['你好呀', '结果复核未通过', '这次没做好，我再试一次？'],
  ])('%s + %s', (intent, errorText, lead) => {
    const turn = fail(errorText, intent);
    expect(turn.lead).toBe(lead);
    expect(`${turn.lead}${turn.why}`).not.toMatch(/核对|校验|门禁|复核|规则/);
  });

  it.each(['verifier 拦截了答案', '任务执行失败：质量校验拦截：数据规则检查未通过'])(
    'an internal check that 「拦截」 is not a login wall: %s',
    (errorText) => {
      const turn = fail(errorText, '写一份周报');
      expect(turn.lead).toBe('周报这次没写好，我再写一次？');
      expect(turn.lead).not.toMatch(/拦下|登录|验证/);
      expect(turn.options.map((o) => o.label)).toEqual(['再试一次']);
    },
  );

  it('English task: English lead and buttons; Amazon Singapore, not amazon.sg', () => {
    const turn = fail(
      '质量校验未通过：没有通过格式或数据规则检查',
      'usb c cable prices on amazon.sg',
    );
    expect(turn.lead).toBe("I couldn't get the live prices from Amazon Singapore this time.");
    expect(turn.options[0]).toEqual({
      kind: 'prompt',
      label: 'Open Amazon Singapore and check it live',
      prompt: 'Use the cloud browser: usb c cable prices on amazon.sg',
    });
    expect(turn.options[1]).toEqual({ kind: 'retry', label: 'Try again' });
    expect(JSON.stringify(turn)).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('English login wall and English internal check', () => {
    const wall = fail(
      '页面要求登录后才能查看',
      'open https://item.jd.com/100142621606.html and read the title and price',
      'browser',
    );
    expect(JSON.stringify(wall)).not.toMatch(/[\u4e00-\u9fff]/);
    expect(wall.options[0]?.label).toBe("Log in to JD.com in the browser and I'll pick it up");
    expect(fail('质量门禁未通过', 'write a weekly report for my team').lead).toBe(
      "The weekly report didn't come out right this time — want me to try again?",
    );
  });

  it('Chinese task scraping amazon.sg names the site in Chinese', () => {
    expect(fail('质量校验未通过', '查 amazon.sg 上 usb c 线的价格', 'scrape').lead).toBe(
      '这次没拿到亚马逊新加坡站的实时价格。',
    );
  });
});

describe('复审 #7 · partial lead, English login step, role words, bubble label', () => {
  it('a link with 「?」 in it does not hide 「只拿到了一部分」 (no second lead)', () => {
    const body =
      '部分完成：这是从[京东手机版](https://item.m.jd.com/product/100142621606.html?ad_od=3)查到的（你给的京东页面要登录），只拿到了一部分：\n\n商品标题是…';
    expect(partialLead(body).lead).toBe('');
  });

  it('English partial without a said gap gets the English lead', () => {
    expect(partialLead('部分完成：Here are the first two items.', true).lead).toBe(
      "I only got part of it — what's missing is below.",
    );
  });

  it('English login step', () => {
    expect(
      partialLoginStep({
        text: 'The price is masked until you log in.',
        intent: 'open https://item.jd.com/100142621606.html and read the price',
      })?.label,
    ).toBe("Log in to JD.com in the browser and I'll read the exact price");
  });

  it('「Main Street 店」 keeps its words; a lowercase role word still goes', () => {
    const click = (actionSummary: string) =>
      liveStatusText({
        steps: [{ stepId: 's1', status: 'running', actionKind: 'click', actionSummary } as never],
      });
    expect(click('点击 Main Street 店')).toBe('正在点「Main Street 店」…');
    expect(click('点击 link "Belkin cable"')).toBe('正在点「Belkin cable」…');
    expect(click('点击 Link 店')).toBe('正在点「Link 店」…');
  });

  it('the bubble shows the clicked label; what is sent is unchanged', () => {
    resetOptionLabels();
    rememberOptionLabel(
      '请使用云端浏览器，亚马逊新加坡站 USB C 线价格',
      '打开亚马逊新加坡站帮你实时查',
    );
    expect(optionLabelFor('请使用云端浏览器，亚马逊新加坡站 USB C 线价格')).toBe(
      '打开亚马逊新加坡站帮你实时查',
    );
    expect(optionLabelFor('别的话')).toBeNull();
  });
});

describe('DEPLOY-57 第 0 步 · web', () => {
  it('a lone 「Menu」 is a role word', () => {
    expect(
      liveStatusText({
        steps: [
          {
            stepId: 's1',
            status: 'running',
            actionKind: 'click',
            actionSummary: '点击 Menu',
          } as never,
        ],
      }),
    ).toBe('正在点页面上的一个选项…');
  });

  it('a partial answer does not repeat 「没能逐字核对」 after its lead', () => {
    const text =
      '标题 A，价格 ¥7??9。\n\n未核实：以下内容未能在已读页面中逐字找到，请自行确认——价格「¥7??9」';
    const partial = splitUnverifiedNote(text, { partial: true });
    expect(partial.body).toBe('标题 A，价格 ¥7??9。');
    expect(partial.unverified).toBe('价格「¥7??9」');
    expect(splitUnverifiedNote(text).body).toContain('有些内容我没能在页面上逐字核对到');
  });
});
