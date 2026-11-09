// FIX-61 P1: leftovers from DEPLOY-60.
import { instructionPart, replyPlan, requestLanguage } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';

describe('FIX-61 P1-1: the talk language comes from the instruction, not pasted text', () => {
  it('a pasted paragraph after a colon does not decide the language', () => {
    expect(
      requestLanguage(
        'Polish this Chinese paragraph: 我们的产品很好用，客户都说方便，价格也合理。',
      ),
    ).toBe('en');
    expect(
      requestLanguage('帮我把这段改得更礼貌：Dear John, send me the file now, I need it today.'),
    ).toBe('zh');
    expect(
      requestLanguage('总结一下这段：The quick brown fox jumps over the lazy dog many times.'),
    ).toBe('zh');
    expect(
      replyPlan('Summarize this for me: 今天开会讨论了第三季度的销售目标和新产品的上市时间。', 'cn')
        .language,
    ).toBe('en');
  });

  it('colons in links, e-mail addresses and times are not a pasted-text boundary', () => {
    expect(instructionPart('Open https://example.com/a and tell me the title')).toBe(
      'Open https://example.com/a and tell me the title',
    );
    expect(instructionPart('明天 15:00 开会，帮我写个提醒')).toBe('明天 15:00 开会，帮我写个提醒');
    expect(
      requestLanguage(
        'Open https://gs.ctrip.com/html5/you/sight/hangzhou14/49894.html and tell me the opening hours',
      ),
    ).toBe('en');
  });

  it('a short label before the colon is not an instruction of its own', () => {
    expect(instructionPart('问题：What is the capital of France?')).toBe(
      '问题：What is the capital of France?',
    );
    expect(instructionPart('Q: 故宫门票多少钱')).toBe('Q: 故宫门票多少钱');
  });
});

describe('FIX-61 P1-2: the 未核实 line follows the task language', async () => {
  const { unverifiedNote, UNVERIFIED_LEAD_EN } = await import(
    './browser-tools/completion-fields.js'
  );
  it('an English task gets an English note; Chinese stays the default', () => {
    const en = unverifiedNote(['Release date「17y ago」', 'Price「S$8.21」'], { english: true });
    expect(en).toBe(`${UNVERIFIED_LEAD_EN}Release date「17y ago」; Price「S$8.21」`);
    expect(en).not.toMatch(/未核实|以下内容/);
    expect(unverifiedNote(['价格「S$8.21」'])).toBe(
      '未核实：以下内容未能在已读页面中逐字找到，请自行确认——价格「S$8.21」',
    );
  });
});

describe('FIX-61 P1-5/P1-6: the checker does not push a correct or honest answer into a wrong price', async () => {
  const { assessCompletionFacts, sameSource, absentExplainedByPage } = await import(
    './browser-tools/completion-fields.js'
  );
  const { wrongVariantPrices } = await import('./browser-tools/variant-price.js');
  const DETAIL_URL = 'https://www.amazon.sg/Belkin-Eco-Friendly-Braided-USB-C-Cable/dp/B0F838M628/';
  // The product page as DEPLOY-60 read it (opened from the results, so with the list's ref tail).
  const detail = [
    '- heading "Belkin Eco-Friendly Braided USB-A to USB-C Cable (6.6ft, 15W) - Soft and Flexible Fast Charging Cable" [level=1]',
    '- link "Brand: Belkin"',
    '- text: "Colour Name: White"',
    '- radio "Black S$6.86 S$15.81"',
    '- radio "White 2 options from S$8.21" [checked]',
    '- text: "Size Name: 200 centimeters"',
    '- button "See All Buying Options"',
  ].join('\n');
  const detailPage = {
    text: detail,
    sourceURL: `${DETAIL_URL}ref=sr_1_3?dib=abc&keywords=usb+c+cable&qid=1&sr=8-3`,
  };

  it('new-amazon-sg: the page opened from the results is the page the answer cites', () => {
    expect(sameSource(detailPage.sourceURL, DETAIL_URL)).toBe(true);
    expect(sameSource('https://www.amazon.sg/x/dp/B0AAAAAAAA/ref=sr_1_1', DETAIL_URL)).toBe(false);
    const facts = assessCompletionFacts({
      summary:
        '3. Belkin Eco-Friendly Braided USB-A to USB-C Cable — 这款没有主推价，有 2 个卖家报价 S$8.21（White / 200 centimeters 显示“2 options from S$8.21”）',
      fields: [{ name: '商品3价格', value: '2 options from S$8.21', sourceURL: DETAIL_URL }],
      intent: '在亚马逊新加坡站搜 usb c cable，列出前三个的名称和价格',
      pages: [detailPage],
    });
    expect(facts.contradictions.filter((c) => c.includes('未成功读取'))).toEqual([]);
    expect(facts.contradictions.filter((c) => c.includes('S$8.21'))).toEqual([]);
  });

  it('reg-new-amazon-sg: Black’s S$6.86 said to be White is sent back', () => {
    const wrong =
      '3. Belkin Eco-Friendly Braided USB-A to USB-C Cable… — S$6.86（详情页当前选中规格为 White / 200 centimeters）';
    const out = wrongVariantPrices(wrong, [detail]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/S\$6\.86.*white.*black/);
    expect(
      assessCompletionFacts({
        summary: wrong,
        intent: '在亚马逊新加坡站搜 usb c cable，列出前三个的名称和价格',
        pages: [detailPage],
      }).contradictions.some((c) => c.includes('S$6.86') && c.includes('black')),
    ).toBe(true);
    // The variant's own price, or the black one named as black, is fine.
    expect(wrongVariantPrices('3. Belkin … — 黑色款 S$6.86', [detail])).toEqual([]);
    expect(wrongVariantPrices('3. Belkin … — White：2 options from S$8.21', [detail])).toEqual([]);
  });

  it('reg-new-amazon-sg: an honest 「未获取到」 quoting the page is not sent back for a second look', () => {
    const honest =
      '3. Belkin Eco-Friendly Braided USB-A to USB-C Cable — 未获取到（详情页当前选中规格为 White / 200 centimeters，显示 "2 options from S$8.21"，无单一主推价）';
    expect(absentExplainedByPage(honest, [detail])).toBe(true);
    // A gap with no page words behind it (a login popup over the author) still gets its look.
    expect(absentExplainedByPage('作者：页面未显示', [detail])).toBe(false);
    expect(absentExplainedByPage('价格：未获取到（页面写着「Only 3 left」）', [detail])).toBe(
      false,
    );
  });
});

describe('FIX-61: the rescue lead says 「你给的」 only for a page the request named', async () => {
  const { requestNamesSite } = await import('./browser-tools/unified-browser-loop.js');
  it('names the site only when the request does', () => {
    expect(
      requestNamesSite(
        '打开 https://item.jd.com/100142621606.html 读价格',
        'https://item.jd.com/1.html',
      ),
    ).toBe(true);
    expect(
      requestNamesSite('iPhone 16 Pro Max 256GB 多少钱', 'https://www.jd.com/jiage/1.html'),
    ).toBe(false);
  });
});

describe('FIX-61: named counts the browser answer leaves out are not 完成', async () => {
  const { missingAskedFields } = await import('./browser-tools/completion-fields.js');
  it('the local dy-1 answer misses comments, favourites and shares', () => {
    const intent =
      '打开 https://www.douyin.com/video/7507106798919601427 读视频标题、作者，以及点赞数、评论数、收藏数、分享数（不播放）';
    const answer =
      '已打开抖音视频页，读到公开信息如下：\n\n- 视频标题：仙桥洞 真的好美\n- 作者：利利的旅行盲盒\n- 点赞数：20';
    const left = missingAskedFields(intent, answer).filter(
      (f) => /数$/.test(f) && !answer.includes(f.replace(/数$/, '')),
    );
    expect(left.sort()).toEqual(['分享数', '收藏数', '评论数'].sort());
  });
});
