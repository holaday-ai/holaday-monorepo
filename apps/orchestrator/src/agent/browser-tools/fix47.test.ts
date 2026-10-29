import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { answerNotObtained } from '../scrape-answer-check.js';
import { scrapePartialAnswer } from '../scrape-runner.js';
import { normalizeResults } from '../search-fallback/search-provider.js';
import { searchResultsHtml } from '../search-fallback/search-results-page.js';
import { humanizeToolMentions } from '../text-sanitizer.js';
import {
  assessCompletionFacts,
  declaredAbsentFields,
  unverifiedNote,
} from './completion-fields.js';

const DY1_INTENT =
  '打开 https://www.douyin.com/video/7507106798919601427 读视频标题、作者，以及点赞数、评论数、收藏数、分享数（不播放）';
/** Deploy-47 dy-1, verbatim (tsk_VuJjHrJBKJ6qWVwWr9a2T). */
const DY1_ANSWER =
  '**视频标题**：#真实生活分享计划 仙桥洞的美貌非常依赖天气。晴天和阴天的景色可以说是天差地别，想拍出"丁达尔光"大片，一定要挑个大晴天去。#释放压力的秘境 #避世秘境 #藏在山野里的小众秘境 #隐藏仙境\n\n**作者**：[利利的旅行盲盒](https://www.douyin.com/video/7507106798919601427)（粉丝 449，获赞 652）\n\n**互动数据**：页面上显示了 20、2、10、97 这几个数字，但没有标签能确认它们分别对应点赞、评论、收藏还是分享，无法确认各项具体数值。\n\n发布时间：2025-05-21 23:28，来源 [抖音](https://www.douyin.com/video/7507106798919601427)。';
const COUNTS = ['点赞数', '评论数', '收藏数', '分享数'];

describe('FIX-47 #1 · the named counts all 「无法确认」 is not a completed answer', () => {
  it('Deploy-47 dy-1: the four counts are not obtained, so the scrape hands the page to the browser', () => {
    expect(declaredAbsentFields(DY1_INTENT, DY1_ANSWER)).toEqual(COUNTS);
    expect(answerNotObtained(DY1_ANSWER, DY1_INTENT)).toBe(true);
  });

  it('still not obtained after the browser: 部分完成, title and author found, four counts missing', () => {
    expect(scrapePartialAnswer(DY1_ANSWER, DY1_INTENT)).toMatchObject({
      missing: COUNTS,
      found: 2,
      wanted: 6,
    });
  });

  it('a count written as 「无法确认」 on its own line is missing too', () => {
    expect(
      declaredAbsentFields(
        DY1_INTENT,
        '- 标题：仙桥洞\n- 作者：利利的旅行盲盒\n- 点赞数：20\n- 收藏数：无法确认（只有图标数字）',
      ),
    ).toEqual(['收藏数']);
  });

  it('reverse: counts given with their numbers are answered (Deploy-47 reg-dy-2, verbatim)', () => {
    const regDy2 =
      '已在 https://www.douyin.com/video/7377304298310389027 页面读取到该视频信息：标题为「第52集 | 柠檬巴巴露亚」，作者为「小喵麻麻」。互动数据分别为：点赞 4741、评论 215、收藏 4369、分享 1652。页面未登录状态下即可读取上述公开信息，未触发播放操作。';
    expect(declaredAbsentFields(DY1_INTENT, regDy2)).toEqual([]);
  });

  it('reverse: only the count without a number is missing; something else unsure is no count', () => {
    expect(
      declaredAbsentFields(
        DY1_INTENT,
        '标题：仙桥洞。作者：利利的旅行盲盒。点赞 20，收藏 10，分享 97，评论数无法确认。',
      ),
    ).toEqual(['评论数']);
    expect(
      declaredAbsentFields(
        '打开知乎问题读问题标题和回答数',
        '标题：如何评价西湖？回答数：1234。无法确认回答者的身份。',
      ),
    ).toEqual([]);
  });
});

describe('PR #311 review', () => {
  it('a count in Chinese numerals is answered; the unsure phrase is about its own clause', () => {
    expect(declaredAbsentFields('读取点赞数和评论数', '点赞数为一万，评论数无法确认。')).toEqual([
      '评论数',
    ]);
    expect(declaredAbsentFields('读取点赞数和评论数', '无法确认点赞数；评论数为215。')).toEqual([
      '点赞数',
    ]);
  });

  it('a labelled name on an English page is still checked as written', () => {
    const page = `Author: 李四\n${'This article explains how search engines rank pages and why relevance matters for readers. '.repeat(4)}`;
    expect(
      assessCompletionFacts({ summary: '- 作者：张三', pages: [{ text: page }] }).unverified,
    ).toEqual(['作者「张三」']);
  });
});

describe('FIX-47 #2 · the outline read and its continuation point read as words', () => {
  it('Deploy-47 core-06, verbatim', () => {
    const out = humanizeToolMentions(
      '已使用云端浏览器打开维基百科长页面「Artificial intelligence」，通过 sections 定位到第3节（章节标题为 Applications），并分两次调用 读取正文 完整读取该节正文（首次读取约8000字符后继续以 cursor 续读至末尾）。',
    );
    expect(out).not.toMatch(/\bsections\b|\bcursor\b/);
    expect(out).toContain('通过章节目录定位到第3节');
    expect(out).toContain('继续以断点续读至末尾');
  });

  it('reverse: other uses of the words stay as written', () => {
    for (const text of [
      'CSS 的 cursor 属性决定鼠标指针的样式。',
      'The article has sections on history and ethics.',
      '在代码 `sections` 里列出了目录。',
      '鼠标 cursor 变成手形时可以点击。',
    ])
      expect(humanizeToolMentions(text)).toBe(text);
  });
});

describe('FIX-47 #3 · three 「未核实」 notes that were not', () => {
  it('Deploy-47 core-06: Chinese words for an English page are noted as a rendering, not as 未核实', () => {
    const summary =
      '第3节「Applications」总结：\n8. **其他行业应用**：法律行业中生成式AI辅助研究导致大量“AI幻觉案例”，截至2026年已有法官对提交虚假判例引用的律师实施制裁。';
    const page =
      'Applications\nAI and machine learning technology is used in most of the essential applications of the 2020s, including search engines, targeting online advertisements, recommendation systems, driving internet traffic, targeted advertising, virtual assistants, autonomous vehicles and automatic language translation.\nGenerative AI used in legal research has produced a wave of AI hallucination cases, in which lawyers cited fictitious case law; by 2026 judges had sanctioned lawyers for it.\nLanguages: 中文 Español Deutsch';
    // DEPLOY-48 复审 #1: written in quotes it is still noted, as 译述.
    const facts = assessCompletionFacts({ summary, pages: [{ text: page }] });
    expect(unverifiedNote(facts.unverified)).toBe(
      '译述，未逐字核对：以下内容是对英文页面的中文转述，页面上没有这些字，请自行确认——条目「AI幻觉案例」',
    );
  });

  it('reverse: on an English page, a value with a number is still checked', () => {
    const page =
      'Applications\nAI and machine learning technology is used in most of the essential applications of the 2020s, including search engines, targeting online advertisements, recommendation systems, driving internet traffic, targeted advertising, virtual assistants, autonomous vehicles and automatic language translation.';
    expect(
      assessCompletionFacts({
        summary: '总结：\n1. 页面提到“2031年的统计”。',
        pages: [{ text: page }],
      }).unverified,
    ).toEqual(['条目「2031年的统计」']);
  });

  it('reverse: on a Chinese page, Chinese words it does not show are still 未核实', () => {
    const summary = '总结：\n1. 页面提到了“湖心亭夜游”。';
    const page = `西湖位于浙江省杭州市西湖区龙井路1号，是中国大陆首批国家重点风景名胜区和中国十大风景名胜之一。${'西湖景区面积广阔，四季景色各异。'.repeat(4)}`;
    expect(assessCompletionFacts({ summary, pages: [{ text: page }] }).unverified).toEqual([
      '条目「湖心亭夜游」',
    ]);
  });

  const B_P02 =
    '已在 amazon.com 搜索 "usb c cable"，读取搜索结果页前3个商品的名称与价格（页面因定位新加坡显示 SGD/S$）：\n\n1. Anker USB C to USB C Cable, 100W Fast Charging Cable (2-Pack, 6 ft, Black) — SGD 12.81\n2. LISEN USB C to USB C Cable, 240W Fast Charging Type C Charger Cord (6.6FT) — SGD 11.50\n3. Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 3.3 ft, Black) — S$12.81（从该商品详情页读取）';
  const results = [
    '- link "Anker USB C to USB C Cable, 100W Fast Charging Cable (2-Pack, 6 ft, Black)" [ref=e10]',
    '- text: SGD 12.81',
    '- link "LISEN USB C to USB C Cable, 240W Fast Charging Type C Charger Cord (6.6FT)" [ref=e20]',
    '- text: SGD 11.50',
    '- link "Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 3.3 ft, Black)" [ref=e30]',
    '- text: See options',
  ].join('\n');
  const detail = (price: string) =>
    `- heading "Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 3.3 ft, Black)" [level=1] [ref=e2]\n- text: ${price}`;

  it('Deploy-47 b-p02: a price with a note of where it was read is still a name and a price', () => {
    const facts = assessCompletionFacts({
      summary: B_P02,
      pages: [{ text: results }, { text: detail('S$12.81') }],
    });
    expect(facts.unverified).toEqual([]);
    expect(facts.contradictions).toEqual([]);
  });

  it('reverse: that price not on any read page is still reported', () => {
    const facts = assessCompletionFacts({
      summary: B_P02.replace('S$12.81（', 'S$13.49（'),
      pages: [{ text: results }, { text: detail('S$12.81') }],
    });
    expect([...facts.unverified, ...facts.contradictions].join('\n')).toContain('13.49');
  });

  it('Deploy-47 reg-new-google: the search API text is decoded, so the page shows what Brave meant', () => {
    expect(
      normalizeResults(
        [
          {
            title: 'Claude',
            url: 'https://claude.ai/login',
            snippet:
              '<strong>Claude</strong> is Anthropic&#x27;s AI, built for problem solvers. Tackle complex challenges, analyze data, write code, and think through your hardest work.',
          },
        ],
        5,
      )[0]?.snippet,
    ).toBe(
      "Claude is Anthropic's AI, built for problem solvers. Tackle complex challenges, analyze data, write code, and think through your hardest work.",
    );
    // No tag is made from an escaped one: the page escapes again.
    expect(
      normalizeResults(
        [{ title: 'a &amp; b', url: 'https://x.test/', snippet: '&lt;b&gt;x' }],
        5,
      )[0],
    ).toMatchObject({ title: 'a & b', snippet: '&lt;b&gt;x' });
  });

  describe('on the rendered results page', () => {
    let browser: Browser;
    beforeAll(async () => {
      browser = await chromium.launch({ headless: true });
    }, 60_000);
    afterAll(async () => {
      await browser?.close();
    });
    const SNIPPET =
      "Claude is Anthropic's AI, built for problem solvers. Tackle complex challenges, analyze data, write code, and think through your hardest work.";
    const read = async (raw: string) => {
      const page = await browser.newPage();
      await page.setContent(
        searchResultsHtml({
          query: 'Claude',
          label: 'Brave 搜索接口',
          results: normalizeResults(
            [{ title: 'Claude', url: 'https://claude.ai/login', snippet: raw }],
            5,
          ),
        }),
      );
      const text = await page.locator('body').ariaSnapshot({ mode: 'ai' } as never);
      await page.close();
      return text;
    };

    it('the snippet field is found on the page (Deploy-47 reg-new-google, verbatim value)', async () => {
      const text = await read(
        '<strong>Claude</strong> is Anthropic&#x27;s AI, built for problem solvers. Tackle complex challenges, analyze data, write code, and think through your hardest work.',
      );
      expect(text).not.toContain('&#x27;');
      const facts = assessCompletionFacts({
        summary: `第一条搜索结果总结：标题为「Claude」。\n\n- snippet：${SNIPPET}`,
        fields: [{ name: 'snippet', value: SNIPPET }],
        pages: [{ text }],
      });
      expect(facts.unverified).toEqual([]);
    });

    it('reverse: a snippet the page does not show is still 未核实', async () => {
      const text = await read('Claude is an AI assistant made by Anthropic.');
      const facts = assessCompletionFacts({
        summary: `- snippet：${SNIPPET}`,
        fields: [{ name: 'snippet', value: SNIPPET }],
        pages: [{ text }],
      });
      expect(facts.unverified).toHaveLength(1);
    });
  });
});

describe('DEPLOY-48 复审 #1 #2 #4 #5 (fixtures fix-47/review1-fixtures/p311*.mjs)', () => {
  const EN = `Applications\n${'AI and machine learning technology is used in most of the essential applications of the 2020s, including search engines, targeting online advertisements, recommendation systems, driving internet traffic, targeted advertising, virtual assistants. '.repeat(2)}`;
  const CN = '西湖位于浙江省杭州市西湖区龙井路1号，是中国大陆首批国家重点风景名胜区。'.repeat(4);
  const note = (summary: string, text: string) =>
    unverifiedNote(assessCompletionFacts({ summary, pages: [{ text }] }).unverified);

  it('#1: a made-up quote on an English page is noted as a rendering, not let through', () => {
    expect(note('总结：\n1. 页面提到“量子意识算法”。', EN)).toBe(
      '译述，未逐字核对：以下内容是对英文页面的中文转述，页面上没有这些字，请自行确认——条目「量子意识算法」',
    );
    expect(note('总结：\n1. 页面提到“九成用户”。', EN)).toContain('「九成用户」');
  });

  it("#1: only a plain listed term, not written as the page's words, goes unnoted", () => {
    expect(note('1. 量子意识算法', EN)).toBe('');
  });

  it('#1 reverse: on a Chinese page the same quote is plainly 未核实', () => {
    expect(note('总结：\n1. 页面提到“量子意识算法”。', CN)).toBe(
      '未核实：以下内容未能在已读页面中逐字找到，请自行确认——条目「量子意识算法」',
    );
    expect(note('1. 量子意识算法', CN)).toContain('未核实');
  });

  const listing = '- link "Anker Cable"\n- text: SGD 12.81';
  it('#2: a price inside the bracket note is a fact of its own', () => {
    const facts = assessCompletionFacts({
      summary: '1. Anker Cable — SGD 12.81（原价 S$30）',
      pages: [{ text: listing }],
    });
    expect([...facts.unverified, ...facts.contradictions].join('\n')).toContain('S$30');
  });

  it('#2: a note without numbers is only a note; the price itself is still checked', () => {
    expect(
      assessCompletionFacts({
        summary: '1. Anker Cable — SGD 12.81（从详情页读取）',
        pages: [{ text: listing }],
      }).unverified,
    ).toEqual([]);
    const made = assessCompletionFacts({
      summary: '1. Anker Cable — SGD 99.99（从详情页读取）',
      pages: [{ text: listing }],
    });
    expect([...made.unverified, ...made.contradictions].join('\n')).toContain('99.99');
  });

  const DY =
    '打开 https://www.douyin.com/video/1 读视频标题、作者，以及点赞数、评论数、收藏数、分享数';
  it('#4: a guessed or doubted number is no answer', () => {
    expect(declaredAbsentFields(DY, '标题：A。作者：B。点赞数可能是 20（无法确认）。')).toEqual([
      '点赞数',
    ]);
    expect(declaredAbsentFields(DY, '标题：A。作者：B。点赞数推测为 20。')).toEqual(['点赞数']);
    expect(declaredAbsentFields(DY, '标题：A。作者：B。点赞数20无法确认。')).toEqual(['点赞数']);
  });

  it('#4: 「无法确认各项具体数值」 leaves every asked count missing', () => {
    expect(
      declaredAbsentFields(DY, '标题：A。作者：B。页面显示 20、2、10、97，无法确认各项具体数值。'),
    ).toEqual(['点赞数', '评论数', '收藏数', '分享数']);
    expect(
      declaredAbsentFields(DY, '点赞、评论、收藏、分享分别为 20、2、10、97（无法确认对应关系）。'),
    ).toEqual(['点赞数', '评论数', '收藏数', '分享数']);
  });

  it('#4 reverse: counts with their numbers, and doubt about something else, are answered', () => {
    expect(
      declaredAbsentFields(DY, '点赞 20，评论 2，收藏 10，分享 97。无法确认作者的粉丝数。'),
    ).toEqual([]);
    expect(
      declaredAbsentFields(DY, '标题：A；作者：B；点赞 20，评论 2，收藏 10，分享数无法确认。'),
    ).toEqual(['分享数']);
  });

  it('#5: a numeral inside an ordinary word is no value', () => {
    expect(declaredAbsentFields('读取点赞数', '点赞十分多，但无法确认点赞数。')).toEqual([
      '点赞数',
    ]);
    expect(declaredAbsentFields('读取点赞数', '点赞数为一万，评论区无法确认。')).toEqual([]);
    expect(declaredAbsentFields('读取点赞数', '点赞数三千个，无法确认收藏。')).toEqual([]);
  });
});

describe('PR #311 review · a value fills only its own item', () => {
  it("one video's count does not answer another's", () => {
    expect(
      declaredAbsentFields(
        '读取两个视频的点赞数',
        '第一个视频点赞数无法确认。第二个视频点赞数为215。',
      ),
    ).toEqual(['点赞数']);
    expect(
      declaredAbsentFields('读取两个视频的点赞数', '第一个视频点赞数为215。第二个视频点赞数为12。'),
    ).toEqual([]);
    expect(
      declaredAbsentFields(
        '读取两个视频的点赞数',
        '第一个视频点赞数无法确认，后来读到第一个视频点赞数为215。',
      ),
    ).toEqual([]);
  });
});
