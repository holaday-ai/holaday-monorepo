import { describe, expect, it } from 'vitest';
import {
  anchoredLogPost,
  bestBuySensorShape,
  opaqueSensorBody,
  sensorBodyVerdict,
  telemetryTrigger,
} from './cloud-observation.js';
import {
  absentExplainedByPage,
  assessCompletionFacts,
  declaredAbsentFields,
  unverifiedNote,
} from './completion-fields.js';
import { assessEngagementClaims, engagementFindings } from './engagement-counts.js';

/**
 * G7 (G6 r5 xhs-read, INBOX 2026-11-15): three cloud-browser faults on a Xiaohongshu note
 * (1583 赞 / 1822 收藏 / 24 评论 on the screenshot) and BestBuy's sensor pause.
 */

// A comment's like button is marked 点赞 with its own count; the note's bar is bare numbers.
const snapshot = [
  '- generic [ref=e40]: Clara',
  '- generic [ref=e88] [互动=点赞]: "1"',
  '- generic [ref=e89]: 共 24 条评论',
].join('\n');
const pageText = '📍杭州｜西湖一日游攻略（保姆级不费腿版）\n评论\n1584\n1823\n24';

describe('G7 #1: an engagement number read from the page is never pushed onto another number', () => {
  it('xon1: 1584 read from the bar is delivered as 未核实, not rejected for the comment mark 「1」', () => {
    const answer = '标题：📍杭州｜西湖一日游攻略（保姆级不费腿版）\n作者：Clara\n点赞数：1584';
    const found = engagementFindings(answer, [snapshot, pageText]);
    expect(found.contradictions).toEqual([]);
    expect(found.unverified).toHaveLength(1);
    expect(found.unverified[0]).toContain('1584');
    // No number to switch to.
    expect(found.unverified[0]).not.toContain('「1」');
    expect(assessEngagementClaims(answer, [snapshot, pageText])).toEqual([]);
    const facts = assessCompletionFacts({
      summary: answer,
      intent: '打开 https://www.xiaohongshu.com/explore/x 读这篇笔记的标题、作者和点赞数',
      pages: [
        { sourceURL: 'https://www.xiaohongshu.com/explore/x', text: snapshot },
        { sourceURL: 'https://www.xiaohongshu.com/explore/x', text: pageText },
      ],
    });
    expect(facts.contradictions.some((c) => c.includes('点赞'))).toBe(false);
    expect(facts.unverified[0]).toContain('1584');
    // Its own line: the number is on the page, only not settled as this counter.
    expect(unverifiedNote(facts.unverified)).toMatch(
      /^未核实：以下数字页面上有，但没能确认属于这一项.*点赞数「1584」/,
    );
  });

  it('a number that is nowhere on the page is still sent back — told to say 未能核实, offered no number', () => {
    const [why] = assessEngagementClaims('点赞数：217', [snapshot, pageText]);
    expect(why).toContain('未能核实');
    expect(why).toContain('不要为了通过核对改成页面上别的数字');
    expect(why).not.toMatch(/数字是「1」/);
  });

  it('FIX-29 still holds: the share counter given as the like count is a wrong counter', () => {
    const marked = [
      '- generic [ref=e1] [互动=点赞]: "20"',
      '- generic [ref=e2] [互动=评论]: "2"',
      '- generic [ref=e3] [互动=收藏]: "10"',
      '- generic [ref=e4] [互动=分享]: "97"',
    ].join('\n');
    const [why] = assessEngagementClaims('点赞数：97', [marked]);
    expect(why).toContain('标注的是分享数');
    expect(why).toContain('未能核实');
    expect(assessEngagementClaims('点赞 20，评论 2，收藏 10，分享 97', [marked])).toEqual([]);
  });
});

describe('G7 #3: 「页面不显示点赞」 explained by a quote about another counter gets its second look', () => {
  const xon3 =
    '部分完成：已读取该笔记的标题为「📍杭州｜西湖一日游攻略（保姆级不费腿版）」，作者为「Clara」。\n点赞数未能读到（未登录时不显示具体数字）；评论数页面显示为「共 24 条评论」。';
  it('the xon3 wording counts as a declared-absent 点赞数 (so the run takes its look)', () => {
    expect(
      declaredAbsentFields('读这篇笔记的标题、作者和点赞数', xon3, undefined, [pageText]),
    ).toContain('点赞数');
    expect(
      declaredAbsentFields('读这篇笔记的标题、作者和点赞数', '因此未能读到点赞数。', undefined, [
        pageText,
      ]),
    ).toContain('点赞数');
    // 复审 P2-3: a value or another field is not made absent by a counter's 「不显示」.
    expect(
      declaredAbsentFields(
        '读这篇笔记的标题、作者和点赞数',
        '作者是Clara（页面未显示点赞数）',
        undefined,
        [pageText],
      ),
    ).toEqual(['点赞数']);
    expect(
      declaredAbsentFields(
        '读标题和作者',
        '标题「秋日穿搭」下方点赞数不显示；作者小红薯看不到评论',
        undefined,
        [pageText],
      ),
    ).toEqual([]);
    // A value given is not absent.
    expect(
      declaredAbsentFields('读这篇笔记的标题、作者和点赞数', '点赞数：1584', undefined, [pageText]),
    ).toEqual([]);
  });
  it('a quote about comments does not explain the missing like count', () => {
    expect(
      absentExplainedByPage('点赞数：未获取到；评论数页面显示为「共 24 条评论」', [
        snapshot,
        pageText,
      ]),
    ).toBe(false);
  });
  it('the page’s own words about the like count do', () => {
    const page = `${pageText}\n登录后查看点赞数据`;
    expect(
      absentExplainedByPage('点赞数：未获取到（页面写着「登录后查看点赞数据」）', [page]),
    ).toBe(true);
  });
  it('lines with no engagement word keep the FIX-61 rule', () => {
    const detail = '显示 "2 options from S$8.21" White / 200 centimeters';
    expect(
      absentExplainedByPage('价格：未获取到（页面写着「2 options from S$8.21」）', [detail]),
    ).toBe(true);
  });
});

describe('G7 #2: Xiaohongshu’s log under its rednote host is a log post', () => {
  const url = new URL('https://t2.rnote.com/api/v2/collect');
  it('an opaque body to the exact host and path passes; a JSON body or another path does not', () => {
    expect(anchoredLogPost(url, 'POST', 'x'.repeat(888))).toBe(true);
    expect(anchoredLogPost(url, 'POST', '{"note_id":"6929ba55","action":"like"}')).toBe(false);
    expect(anchoredLogPost(new URL('https://t2.rnote.com/api/v2/like'), 'POST', '')).toBe(false);
    expect(anchoredLogPost(new URL('https://t2.rnote.com/api/v2/collect?a=b'), 'POST', '')).toBe(
      false,
    );
    expect(
      telemetryTrigger({ branch: 'unknown_post', url: 'https://t2.rnote.com/api/v2/collect' }),
    ).toBe(true);
  });
  it('the real 收藏 write is never this', () => {
    expect(
      anchoredLogPost(
        new URL('https://edith.xiaohongshu.com/api/sns/web/v1/note/collect'),
        'POST',
        '',
      ),
    ).toBe(false);
  });
});

describe('G7 #4: a BestBuy pause says which sensor check refused it (codes only)', () => {
  const online = new URL(
    'https://www.bestbuy.com/g9tiKT/ey/oH/MM6P/rRxvEZmI4JxgY/NrY7QfD3/BS8rDwE/bQISSTkp/CGkIAQ',
  );
  it('the online path is sensor-shaped, so the body check is what refused it', () => {
    expect(bestBuySensorShape(online, 'POST', `{"body":"${'a'.repeat(1200)}"}`)).toBe(true);
  });
  it('codes for each refusal; ok only for the opaque sensor string', () => {
    expect(sensorBodyVerdict(`{"body":"${'a'.repeat(1200)}"}`)).toBe('ok');
    expect(opaqueSensorBody(`{"body":"${'a'.repeat(1200)}"}`)).toBe(true);
    expect(sensorBodyVerdict('{"body":"x","other":1}')).toBe('not-one-member');
    expect(sensorBodyVerdict('{"body":"short"}')).toBe('short');
    expect(
      sensorBodyVerdict(`{"body":${JSON.stringify(JSON.stringify({ a: 'x'.repeat(1200) }))}}`),
    ).toBe('inner-json');
    expect(sensorBodyVerdict(`{"body":"a=1&b=2&${'c'.repeat(1200)}"}`)).toBe('pairs');
  });
});
