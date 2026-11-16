import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { COUNTER_LEAD } from './completion-fields.js';
import { engagementClaims, engagementFindings, settleUnpairedCounts } from './engagement-counts.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import {
  misattributedPrices,
  settleMisattributedPrices,
  tabSections,
} from './section-attribution.js';
import { withSelectedTabs } from './selected-tabs.js';
import { settledAnswer } from './unified-browser-loop.js';

vi.mock('./browser-replay-service.js', () => ({ browserReplayStore: {} }));

/**
 * GOAL2 H1 — a count, a price or a ticket type goes out only when the page pairs it with its own
 * icon, label or tab; otherwise 「未能核实」, never another number.
 *
 * XHS: the note's bar (like-wrapper 1584 / collect-wrapper 1827 / chat-wrapper 24, as on
 * rednote.com 2026-11-16) comes after a long comment list whose every comment has its own
 * like-wrapper — G6 r5 marked a comment's 「1」 as 点赞 and pushed the answer onto it.
 */
const comment = (n: number) =>
  `<div class="comment-item"><div class="comment-inner-container"><div class="right"><div class="content">评论 ${n}</div><div class="info"><div class="interactions"><div class="like"><span class="like-wrapper"><svg></svg><span class="count">${(n % 3) + 1}</span></span></div><div class="reply icon-container"><svg></svg><span class="count">${n % 2 ? 2 : 1}</span></div></div></div></div></div></div>`;
const XHS = `<!doctype html><meta charset="utf-8"><title>📍杭州｜西湖一日游攻略 - rednote</title>
<div class="note-container">
  <div class="interaction-container">
    <div id="detail-title">📍杭州｜西湖一日游攻略（保姆级不费腿版）</div>
    <div class="author"><span class="username">Clara</span></div>
    <div class="comments-el"><div class="comments-container">${Array.from({ length: 30 }, (_, i) => comment(i)).join('')}</div></div>
    <div class="engage-bar"><div class="input-box"><div class="interact-container"><div class="buttons engage-bar-style"><div class="left">
      <span class="like-wrapper like-active"><svg></svg><span class="count">1584</span></span>
      <span class="collect-wrapper"><svg></svg><span class="count">1827</span></span>
      <span class="chat-wrapper"><svg></svg><span class="count">24</span></span>
    </div></div></div></div></div>
  </div>
</div>`;

/** 故宫 Visit.html (2026-11-16): two plain-span tabs over one list with no heading of its own. */
const GUGONG = `<!doctype html><meta charset="utf-8"><title>导览 - 故宫博物院</title>
<h2>票价及优惠政策</h2>
<p>每年4月1日至10月31日为旺季，大门票60元/人； 每年11月1日至次年3月31日为淡季，大门票40元/人； 珍宝馆门票：10元/人； 钟表馆门票：10元/人；</p>
<div class="lyc_tabs"><span class="s1 now" onclick="pick(0)">大门票优惠政策</span><span class="s2" onclick="pick(1)">钟表馆、珍宝馆票价优惠政策</span></div>
<div id="panel0"><p>1.未满18周岁的中国公民免费参观，但须预约。</p><p>2.18周岁以上、本科及以下学历，可购学生票，淡旺季均为20元/人。</p><p>3.60周岁以上老年人门票半价优惠。即旺季30元/人；淡季20元/人。</p></div>
<div id="panel1" style="display:none"><p>1.未满18周岁的中国公民免费参观，但须预约。</p><p>2.18周岁以上、本科及以下学历，可购学生票，淡旺季均为5元/人。</p><p>3.60周岁以上老年人门票半价优惠，即5元/人。</p></div>
<script>function pick(i){document.querySelectorAll('.lyc_tabs span').forEach(function(s,j){s.className=(j?'s2':'s1')+(j===i?' now':'')});document.getElementById('panel0').style.display=i?'none':'';document.getElementById('panel1').style.display=i?'':'none';}</script>`;

let server: Server;
let base: string;
let browser: Browser;
beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.url?.startsWith('/gugong') ? GUGONG : XHS);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
});

async function reads(path: string, intent: string, click?: string) {
  const page = await browser.newPage();
  try {
    const tools = createPlaywrightUnifiedExecutor(page, {
      observationV2: true,
      taskIntent: intent,
    });
    await tools.execute({ tool: 'navigate', url: `${base}${path}` } as never);
    if (click) await page.getByText(click, { exact: true }).click();
    const snapshot = (await tools.execute({ tool: 'snapshot' } as never)).text ?? '';
    const text = (await tools.execute({ tool: 'get_page_text' } as never)).text ?? '';
    return {
      snapshot,
      tree: (JSON.parse(snapshot) as { tree: string }).tree,
      text: (JSON.parse(text) as { text: string }).text,
    };
  } finally {
    await page.close();
  }
}

describe('H1 · the page’s own counters, not a comment’s', () => {
  it('snapshot and page text lead with the note’s bar; no comment counter among them', async () => {
    const { tree, text } = await reads('/xhs', '读这篇笔记的标题、作者和点赞数');
    for (const read of [tree, text]) {
      const block = read.split('\n').filter((line) => line.startsWith('- 计数 [互动='));
      expect(block).toEqual([
        '- 计数 [互动=点赞]: "1584"',
        '- 计数 [互动=收藏]: "1827"',
        '- 计数 [互动=评论]: "24"',
      ]);
    }
    // A comment's own like counter, where the snapshot marks it, is another item's.
    expect(tree).not.toMatch(/\[互动=点赞\]: "[123]"/);
  });

  it('a comment’s 「1」 given as the note’s like count is another item’s; 1584 passes', async () => {
    const { snapshot, text } = await reads('/xhs', '读这篇笔记的标题、作者和点赞数');
    const pages = [snapshot, text];
    expect(engagementFindings('点赞数：1584', pages).contradictions).toEqual([]);
    const marked = '- generic [ref=e9] [互动=点赞·其他条目]: "1"';
    const [why] = engagementFindings('点赞数：1', [...pages, marked]).contradictions;
    expect(why).toContain('是评论或推荐里其他条目的点赞数，不是这一项的');
  });
});

describe('H1 · delivery: an unpaired count is written 未能核实, never another number', () => {
  const pages = ['- 计数 [互动=点赞]: "1584"\n- 计数 [互动=收藏]: "1827"'];
  it('a guessed number (r5a1 217 / 3052) is settled; the paired one is kept', () => {
    const { answer, settled } = settleUnpairedCounts(
      '- 标题：西湖\n- 点赞数：1,584\n- 评论数：217\n- 收藏数：3052',
      pages,
    );
    expect(answer).toBe('- 标题：西湖\n- 点赞数：1,584\n- 评论数：未能核实\n- 收藏数：未能核实');
    expect(settled).toEqual(['评论', '收藏']);
  });
  it('the 收藏 count given as 点赞 (local g7x3) is settled, not swapped for 1584', () => {
    expect(settleUnpairedCounts('点赞数：1827', pages).answer).toBe('点赞数：未能核实');
  });
  it('a table cell is a claim too (r5a1 「| 点赞数 | 1,584 |」)', () => {
    expect(engagementClaims('| 点赞数 | 1,584 |')).toMatchObject([{ kind: '点赞', value: '1584' }]);
    expect(settleUnpairedCounts('| 点赞数 | 9,999 |', pages).answer).toBe('| 点赞数 | 未能核实 |');
  });
  it('「1584 个赞」 reads 「点赞数未能核实」 when unpaired', () => {
    expect(settleUnpairedCounts('这篇有 2000 个赞', pages).answer).toBe('这篇有 点赞数未能核实');
  });
  it('a page marking no counters keeps a number the check leaves alone (「1,234 ratings」)', () => {
    const page = ['4.5 out of 5 stars\n1,234 ratings'];
    expect(settleUnpairedCounts('评论数：1234', page).answer).toBe('评论数：1234');
    // Only what the loop's check flags is settled (复审 #7): a bare icon number is.
    expect(settleUnpairedCounts('评论数：88', ['评论\n88']).answer).toBe('评论数：未能核实');
  });
  it('复审 #2–#4, #8, #9: every writing, bold values, whole numbers only, ids are no numbers', () => {
    const pages = ['- 计数 [互动=点赞]: "1584"', '- link "笔记" [ref=e217]'];
    expect(settleUnpairedCounts('点赞数：217。总结：这篇笔记收获了 217 个赞', pages).answer).toBe(
      '点赞数：未能核实。总结：这篇笔记收获了 点赞数未能核实',
    );
    expect(settleUnpairedCounts('点赞数：**217**', pages).answer).toBe('点赞数：**未能核实**');
    expect(settleUnpairedCounts('| 点赞数 | **217** |', pages).answer).toBe(
      '| 点赞数 | **未能核实** |',
    );
    expect(settleUnpairedCounts('点赞数：1584；评论点赞数：1', pages).answer).toBe(
      '点赞数：1584；评论点赞数：未能核实',
    );
    expect(settleUnpairedCounts('The note has 217 likes.', pages, { english: true }).answer).toBe(
      'The note has like count not verified.',
    );
    expect(engagementClaims('以下是点赞最高的 3 个评论；前 5 条评论')).toEqual([]);
  });
  it('复审 #5: a request about several items pairs their own counters', () => {
    const pages = ['- generic [ref=e9] [互动=点赞·其他条目]: "1.2万"\n- 计数 [互动=点赞]: "1584"'];
    expect(settleUnpairedCounts('1. 笔记A：点赞 1.2万', pages).answer).toBe(
      '1. 笔记A：点赞 未能核实',
    );
    expect(settleUnpairedCounts('1. 笔记A：点赞 1.2万', pages, { manyItems: true }).answer).toBe(
      '1. 笔记A：点赞 1.2万',
    );
    // A search list with no counter of its own pairs its cards' counters.
    expect(settleUnpairedCounts('点赞 1.2万', [pages[0]!.split('\n')[0]!]).answer).toBe(
      '点赞 1.2万',
    );
  });
  it('settledAnswer drops the G7 未核实 counter line and says what it settled', () => {
    const out = settledAnswer(
      `点赞数：1,234\n\n${COUNTER_LEAD}点赞数「1,234」（页面上另有标为点赞的数字）`,
      pages,
    );
    expect(out).toBe(
      '点赞数：未能核实\n\n未能核实：点赞数——页面上没有找到和这一项的图标 / 标签直接相邻、能确认属于它的数字，所以没写数字。',
    );
    expect(settledAnswer('点赞数：1584', pages)).toBe('点赞数：1584');
  });
});

describe('H1 · a ticket price belongs to the tab it is shown under', () => {
  it('the snapshot says which plain-span tab is selected, after a click too', async () => {
    const first = await reads('/gugong', '故宫门票多少钱？有哪些票种');
    expect(first.tree).toContain('当前选中的标签：大门票优惠政策');
    const second = await reads(
      '/gugong',
      '故宫门票多少钱？有哪些票种',
      '钟表馆、珍宝馆票价优惠政策',
    );
    expect(second.tree).toContain('当前选中的标签：钟表馆、珍宝馆票价优惠政策');
    expect(tabSections(second.tree)[0]!.map((tab) => [tab.title, /5元/.test(tab.text)])).toEqual([
      ['大门票优惠政策', false],
      ['钟表馆、珍宝馆票价优惠政策', true],
    ]);
  });

  it('r5a1: the halls’ 学生票 5 元 under 大门票 is caught on the selected-tab read, and settled', async () => {
    const { tree } = await reads(
      '/gugong',
      '故宫门票多少钱？有哪些票种',
      '钟表馆、珍宝馆票价优惠政策',
    );
    const answer =
      '**主要票种及优惠政策（大门票）**\n2. 学生票：淡旺季均为5元/人。\n3. 老年人优惠票：门票半价优惠，即5元/人。\n\n注：钟表馆、珍宝馆学生票5元/人。';
    const [why] = misattributedPrices(answer, [tree]);
    expect(why).toContain('属于「钟表馆、珍宝馆票价优惠政策」这一栏');
    const settled = settleMisattributedPrices(answer, [tree]);
    expect(settled.summary).toBe(
      '**主要票种及优惠政策（大门票）**\n2. 学生票：淡旺季均为未能核实。\n3. 老年人优惠票：门票半价优惠，即未能核实。\n\n注：钟表馆、珍宝馆学生票5元/人。',
    );
    expect(settled.settled).toEqual(['5元']);
  });

  it('the real snapshot (2026-11-16): tab names one per line, a carousel button, a copied list', () => {
    const list = (ref: number, student: string, elder: string) =>
      [
        `                  - generic [ref=e${ref}]: 1.未满18周岁的中国公民免费参观，但须预约。`,
        `                  - generic [ref=e${ref + 1}]: 2.18周岁以上、本科及以下学历，可购学生票，淡旺季均为${student}/人。`,
        `                  - generic [ref=e${ref + 2}]: 3.60周岁以上老年人门票半价优惠，${elder}。`,
      ].join('\n');
    const tree = [
      '            - generic [ref=e256]: 票价及优惠政策',
      '              - generic [ref=e276] [cursor=pointer]: 大门票优惠政策',
      '              - generic [ref=e277] [cursor=pointer]: 钟表馆、珍宝馆票价优惠政策',
      '            - generic [ref=e278]:',
      '              - button "上一项"',
      '              - generic [ref=e280]:',
      list(285, '5元', '即5元/人'),
      list(299, '20元', '即旺季30元/人；淡季20元/人'),
      list(313, '5元', '即5元/人'),
      '              - button "下一项"',
    ].join('\n');
    const marked = withSelectedTabs(tree, [
      { names: ['大门票优惠政策', '钟表馆、珍宝馆票价优惠政策'], selected: '大门票优惠政策' },
    ]);
    expect(marked).toContain(
      '钟表馆、珍宝馆票价优惠政策\n              - text: 当前选中的标签：大门票优惠政策（大门票优惠政策｜钟表馆、珍宝馆票价优惠政策）\n',
    );
    // 复审 #6: the heading above the names is not a tab; the main ticket's 20 元 is the main ticket's.
    const hidden = withSelectedTabs(
      [
        '- generic [ref=e1]: 票价及优惠政策',
        '- generic [ref=e2] [cursor=pointer]: 大门票优惠政策',
        '- generic [ref=e3] [cursor=pointer]: 钟表馆、珍宝馆票价优惠政策',
        list(10, '20元', '即旺季30元/人；淡季20元/人'),
      ].join('\n'),
      [{ names: ['大门票优惠政策', '钟表馆、珍宝馆票价优惠政策'], selected: '大门票优惠政策' }],
    );
    expect(misattributedPrices('故宫学生票 20 元/人；老年人旺季 30 元/人', [hidden])).toEqual([]);
    expect(misattributedPrices('钟表馆学生票 20元/人', [hidden])[0]).toContain(
      '属于「大门票优惠政策」',
    );
    for (const read of [tree, marked]) {
      const [why] = misattributedPrices('大门票：学生票淡旺季均为5元/人', [read]);
      expect(why).toContain('属于「钟表馆、珍宝馆票价优惠政策」这一栏');
      expect(
        misattributedPrices('大门票：学生票20元/人；钟表馆、珍宝馆学生票5元/人', [read]),
      ).toEqual([]);
    }
  });

  it('withSelectedTabs only marks a line that is exactly the group’s names', () => {
    const groups = [{ names: ['甲栏', '乙栏'], selected: '乙栏' }];
    expect(withSelectedTabs('- text: 甲栏 乙栏\n- text: 甲栏 乙栏 丙', groups)).toBe(
      '- text: 甲栏 乙栏\n- text: 当前选中的标签：乙栏（甲栏｜乙栏）\n- text: 甲栏 乙栏 丙',
    );
  });
});
