import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { anchoredLogPost, keyedLogCheck } from './cloud-observation.js';
import {
  assessCompletionFacts,
  declaredAbsentFields,
  fieldLabel,
  unverifiedNote,
} from './completion-fields.js';

const XHS = new URL('https://apm-fe.xiaohongshu.com/api/data');
/** The 9 posts Xiaohongshu's SDK sent on the 300031 page (local capture 2026-10-29, ids masked). */
const CAPTURE: { posts: unknown[] } = JSON.parse(
  readFileSync(new URL('./fixtures/fix48-xhs-apm-300031.json', import.meta.url), 'utf8'),
);
type Rec = Record<string, unknown> & { measurement_data: Record<string, unknown> };
const records = CAPTURE.posts.flatMap((post) => (Array.isArray(post) ? post : [post])) as Rec[];
const byName = (name: string) => structuredClone(records.find((r) => r.measurement_name === name)!);
/** Deploy-48 xhs-read's final page (`resultEvidence.finalUrl`, uuid masked). */
const ROUTE_404 =
  'https://www.xiaohongshu.com/404?error_code=300031&error_msg=Sorry%252C%2520This%2520Page%2520Isn%27t%2520Available%2520Right%2520Now.&uuid=00000000-0000-4000-8000-000000000000&redirectPath=https://www.xiaohongshu.com/explore/6929ba55000000001e023ef8';
/**
 * The same record as sent from that page: the page fields name /404, not the login app (the
 * Deploy-48 record had no custom_c1 — it failed on `key:measurement_name+measurement_data` only).
 */
const on404 = (record: Rec): Rec => {
  const out: Rec = {
    ...record,
    context_matchedPath: '/404',
    context_route: ROUTE_404,
    context_artifactName: 'fe-404',
  };
  delete out.custom_c1;
  return out;
};
const check = (body: unknown) => keyedLogCheck(XHS, JSON.stringify(body));

describe('FIX-48 #1 · the apm-fe measurement record is a known shape', () => {
  it('evidence: every captured post on the login error page still pauses — on 「login」 in its values', () => {
    for (const post of CAPTURE.posts) {
      const why = check(post);
      expect(why).toMatch(/^(?:record\d+:)?(?:value:|measurement_data:)/);
      expect(anchoredLogPost(XHS, 'POST', JSON.stringify(post))).toBe(false);
    }
    // The value checks refuse them now, not the shape (FIX-45: `key:measurement_name…`).
    expect(check([byName('pageView')])).toBe('record0:value:context_matchedPath');
  });

  it.each(['pageView', 'httpRequestTiming', 'infra_sec_web_api_walify'])(
    'the real %s record from the 404 page passes',
    (name) => {
      expect(check([on404(byName(name))])).toBeNull();
      expect(anchoredLogPost(XHS, 'POST', JSON.stringify([on404(byName(name))]))).toBe(true);
    },
  );

  it('reverse: the real sec_restrict_web record names the login redirect in `extra` — still pauses', () => {
    const r = on404(byName('sec_restrict_web'));
    delete r.c1;
    // DEPLOY-49 复审 #1: its page URL is in a key that holds no URL; `extra` is a JSON string.
    expect(check(r)).toBe('measurement_data:url-key:fromPath');
    delete r.measurement_data.fromPath;
    expect(check(r)).toBe('measurement_data:json:extra');
  });

  it('a batch of real records from the 404 page passes, record by record', () => {
    const batch = ['pageView', 'httpRequestTiming', 'infra_sec_web_api_walify'].map((name) =>
      on404(byName(name)),
    );
    expect(check(batch)).toBeNull();
    // One bad record in the batch refuses it, and is named.
    const bad = structuredClone(batch);
    bad[2]!.measurement_data.api_name = '/api/sns/web/v1/note/like';
    expect(check(bad)).toBe('record2:measurement_data:value:api_name');
  });

  const page = () => on404(byName('httpRequestTiming'));
  it.each<[string, (r: Rec) => void, RegExp]>([
    [
      'a timing of a like request',
      (r) => {
        r.measurement_data.url = '//edith.xiaohongshu.com/api/sns/web/v1/note/like';
        r.measurement_data.matchedPath = r.measurement_data.url;
      },
      /^measurement_data:value:matchedPath$/,
    ],
    [
      'a follow in the page route',
      (r) => {
        r.context_route = 'https://www.xiaohongshu.com/user/profile/1?follow=1';
      },
      /^value:context_route$/,
    ],
    [
      'an action-named measurement',
      (r) => {
        r.measurement_name = 'note_collect';
      },
      /^measurement_name$/,
    ],
    [
      'a nested object in the timings',
      (r) => {
        r.measurement_data.extra = { followUserId: '1' };
      },
      /^measurement_data:value:extra$/,
    ],
    [
      'an array in the timings',
      (r) => {
        r.measurement_data.list = [1, 2];
      },
      /^measurement_data:value:list$/,
    ],
    [
      'a phone key in the timings',
      (r) => {
        r.measurement_data.phone = '13800138000';
      },
      /^measurement_data:key:phone$/,
    ],
    [
      'a code key in the timings',
      (r) => {
        r.measurement_data.smsCode = '1234';
      },
      /^measurement_data:key:smsCode$/,
    ],
    [
      'a visitor id that is not opaque hex',
      (r) => {
        r.context_userId = '13800138000';
      },
      /^value:context_userId$/,
    ],
    [
      'an unlisted top-level key',
      (r) => {
        r.note_id = 'x';
      },
      /^key:note_id$/,
    ],
    [
      'a context key named after an account',
      (r) => {
        r.context_accountPhone = '1';
      },
      /^personal-key:context_accountPhone$/,
    ],
    [
      'a value over 1 KB',
      (r) => {
        r.measurement_data.url = `//as.xiaohongshu.com/${'x'.repeat(1100)}`;
        r.measurement_data.matchedPath = r.measurement_data.url;
      },
      /^measurement_data:value:matchedPath$/,
    ],
    [
      'a record over 4 KB',
      (r) => {
        for (let i = 0; i < 6; i += 1) r.measurement_data[`f${i}`] = 'x'.repeat(900);
      },
      /^record-size$/,
    ],
    [
      'more than 80 timings',
      (r) => {
        for (let i = 0; i < 81; i += 1) r.measurement_data[`t${i}`] = i;
      },
      /^measurement_data:keys:/,
    ],
    [
      'no clientTime',
      (r) => {
        delete r.clientTime;
      },
      /^no-clientTime$/,
    ],
  ])('reverse: %s still pauses', (_label, change, why) => {
    const r = page();
    change(r);
    expect(check(r)).toMatch(why);
    expect(anchoredLogPost(XHS, 'POST', JSON.stringify(r))).toBe(false);
  });

  it('the two fixed tokens are the only words passed over', () => {
    const r = page();
    // 「(KHTML, like Gecko)」 passes, a 「like」 anywhere else in the UA does not.
    r.context_userAgent = `${r.context_userAgent} like`;
    expect(check(r)).toBe('value:context_userAgent');
    // `error_code=` as the 300031 page's parameter passes; a 「code」 value does not.
    const s = page();
    s.context_route = `${ROUTE_404}&sms_code=1`;
    expect(check(s)).toBe('value:context_route');
  });

  it('a measurement name without data keeps the FIX-43 flat rule (FIX-46 wall-xhs)', () => {
    const { measurement_data: _d, ...flat } = page();
    expect(check(flat)).toMatch(/^key:/);
  });
});

describe('FIX-48 #2 · field names read in Chinese, never half', () => {
  it.each([
    ['final_page_height', '最终页面高度'],
    ['finalPageHeight', '最终页面高度'],
    ['macos_installer_description', 'macOS安装包描述'],
    ['page_width', '页面宽度'],
  ])('%s → %s', (name, label) => {
    expect(fieldLabel(name)).toBe(label);
  });
  it.each([
    ['scroll_position_after', 'scroll position after'],
    ['finalScrollOffset', 'final Scroll Offset'],
  ])('reverse: a word with no entry → the plain words, no mixing (%s)', (name, label) => {
    expect(fieldLabel(name)).toBe(label);
    expect(fieldLabel(name)).not.toMatch(/\p{Script=Han}/u);
  });
});

const DY =
  '打开 https://www.douyin.com/video/1 读视频标题、作者，以及点赞数、评论数、收藏数、分享数';
const COUNTS = ['点赞数', '评论数', '收藏数', '分享数'];

describe('FIX-48 #3 · 协调方复审 PR #311 的小问题', () => {
  it.each([
    '点赞20，评论2，收藏10，分享97，但无法确认各项具体数值',
    '点赞20，评论2，收藏10，分享97，但各项具体数值无法确认',
    '点赞20，评论2，收藏10，分享97，但无法确认各项的具体数值',
    '点赞20，评论2，收藏10，分享97，各项数值均无法确认',
    '点赞20，评论2，收藏10，分享97（各项具体数值无法确认）',
    '点赞20，评论2，收藏10，分享97，但无法逐一确认各项数值',
    '点赞20，评论2，收藏10，分享97，但以上数值都无法确认',
    '点赞20，评论2，收藏10，分享97，但不能确定每一项的具体数值',
    '点赞20，评论2，收藏10，分享97，但无法确认各项',
    // PR #312 review: doubting the values' accuracy withdraws them.
    '点赞20，评论2，收藏10，分享97，但无法确认各项具体数值是否准确',
    '点赞20，评论2，收藏10，分享97，但各项数据的准确性无法确认',
    // PR #312 review: an explanation after the phrase.
    '点赞20，评论2，收藏10，分享97。但无法确认各项具体数值（页面没有标签）',
    '点赞20，评论2，收藏10，分享97。但无法确认各项具体数值：页面没有标签',
    // PR #312 review: a freshness word in the explanation is no freshness doubt.
    '点赞20，评论2，收藏10，分享97。但无法确认各项具体数值（页面实时刷新且没有标签）',
  ])('「%s」: the answer cannot confirm each count — all missing', (answer) => {
    expect(declaredAbsentFields(DY, `标题：A。作者：B。${answer}。`)).toEqual(COUNTS);
  });

  it.each([
    '点赞20，评论2，收藏10，分享97。无法确认每个视频的发布时间',
    '点赞20，评论2，收藏10，分享97。以上数据无法确认是否实时',
    '点赞20，评论2，收藏10，分享97，以上数据无法确认其实时性',
    '点赞20，评论2，收藏10，分享97。无法确认这些数据的增长趋势',
    // PR #312 review: a doubt about another attribute of the counts.
    '点赞20，评论2，收藏10，分享97，各项数据的采集时间无法确认',
    '点赞20，评论2，收藏10，分享97，无法确认各项数据的采集时间',
  ])('reverse: 「%s」 doubts something else — the counts stand', (answer) => {
    expect(declaredAbsentFields(DY, `标题：A。作者：B。${answer}。`)).toEqual([]);
  });

  it.each([
    '点赞数估计在一万以上',
    '点赞数一万以上',
    '点赞数约2万',
    '点赞数约 2 万',
    '点赞数2万左右',
    '点赞数大约 20000',
    '点赞数 3000 上下',
  ])('「%s」 is a guess, not a value', (like) => {
    expect(declaredAbsentFields(DY, `${like}，评论数215，收藏数4369，分享数1652。`)).toEqual([
      '点赞数',
    ]);
  });

  it.each(['点赞数1.2万', '点赞数10万+', '点赞数 4741（预约直播 2 场）'])(
    'reverse: 「%s」 as the page shows it is a value',
    (like) => {
      expect(declaredAbsentFields(DY, `${like}，评论数215，收藏数4369，分享数1652。`)).toEqual([]);
    },
  );

  const listing = '- link "Anker Cable"\n- text: SGD 12.81';
  const flagged = (summary: string) => {
    const facts = assessCompletionFacts({ summary, pages: [{ text: listing }] });
    return [...facts.contradictions, unverifiedNote(facts.unverified)].join('\n');
  };
  it.each([
    '1. Anker Cable — SGD 12.81（约 2 天送达）',
    '1. Anker Cable — SGD 12.81（库存 5 件）',
    '1. Anker Cable — SGD 12.81（4.5 星，299 条评价）',
  ])('「%s」: a number that is no price is not checked as one', (summary) => {
    expect(flagged(summary)).not.toMatch(/括注/);
  });

  it.each([
    ['1. Anker Cable — SGD 12.81（原价 S$30）', 'S$30'],
    ['1. Anker Cable — SGD 12.81（原价 99 元）', '99 元'],
    ['1. Anker Cable — SGD 12.81（约 2 天送达，原价 S$30）', 'S$30'],
  ])('reverse: 「%s」 — a price in the note is still checked', (summary, price) => {
    expect(flagged(summary)).toContain(price);
    expect(flagged(summary)).not.toMatch(/2 天/);
  });

  it('PR #312 review: an unsigned original price keeps its price word — 「299 reviews」 is no match', () => {
    const pages = [{ text: `${listing}\n- text: 299 reviews` }];
    const facts = assessCompletionFacts({
      summary: '1. Anker Cable — SGD 12.81（原价 99）',
      pages,
    });
    expect([...facts.contradictions, unverifiedNote(facts.unverified)].join('\n')).toContain(
      '原价 99',
    );
    // PR #312 review: an English label is a price too, checked with its label.
    for (const note of ['original price 99', 'list price: 99', 'was 99', 'RRP 99']) {
      const en = assessCompletionFacts({ summary: `1. Anker Cable — SGD 12.81（${note}）`, pages });
      expect([...en.contradictions, unverifiedNote(en.unverified)].join('\n')).toContain(note);
    }
    // Reverse: the page shows it — verified.
    const shown = assessCompletionFacts({
      summary: '1. Anker Cable — SGD 12.81（原价 99）',
      pages: [{ text: `${listing}\n- text: 原价 99` }],
    });
    expect(shown.unverified).toEqual([]);
  });

  it('PR #312 review: a review count is no price — its numeric note is still checked', () => {
    const facts = assessCompletionFacts({
      summary: '已读取。',
      fields: [{ name: '评价数', value: '299（好评率 98%）' }],
      pages: [{ text: '- text: 299' }],
    });
    expect(unverifiedNote(facts.unverified)).toContain('好评率 98%');
  });

  it('a price field with a delivery note: only the price is checked', () => {
    const facts = assessCompletionFacts({
      summary: '- 价格：SGD 12.81（约 2 天送达）',
      pages: [{ text: listing }],
    });
    expect([...facts.contradictions, ...facts.unverified].join('\n')).not.toMatch(/括注/);
    const made = assessCompletionFacts({
      summary: '- 价格：SGD 12.81（原价 S$30）',
      pages: [{ text: listing }],
    });
    expect([...made.contradictions, unverifiedNote(made.unverified)].join('\n')).toContain('S$30');
  });
});

describe('DEPLOY-49 复审 #1 · measurement values carry no encoded write (apm312.mjs)', () => {
  /** The coordinator's base record: an httpRequestTiming of the home feed. */
  const base = {
    clientTime: 1793520000000,
    context_sdkSessionId: 'a1b2',
    context_platform: 'PC',
    context_route: '/explore',
    context_userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130',
    context_userId: '',
    measurement_name: 'httpRequestTiming',
    measurement_data: {
      url: 'https://edith.xiaohongshu.com/api/sns/web/v1/homefeed',
      duration: 123,
      encodedBodySize: 2048,
      status: 200,
    },
  };
  const r = (o: Record<string, unknown> = {}, d: Record<string, unknown> = {}) =>
    JSON.stringify([{ ...base, ...o, measurement_data: { ...base.measurement_data, ...d } }]);
  const xhs = (body: string) => keyedLogCheck(XHS, body);

  it('the real-looking record passes', () => {
    expect(xhs(r())).toBeNull();
    expect(anchoredLogPost(XHS, 'POST', r())).toBe(true);
  });

  it.each<[string, string, string]>([
    [
      'a JSON string with an action',
      r({}, { payload: '{"action":"add","item":"1"}' }),
      'json:payload',
    ],
    [
      'a JSON string with no action word',
      r({}, { payload: '{"op":"post","target":"6929ba55","text":"hi"}' }),
      'json:payload',
    ],
    [
      'base64 of note_id=1&action=like',
      r({}, { blob: Buffer.from('note_id=1&action=like').toString('base64') }),
      'base64:blob',
    ],
    ['a URL-encoded body', r({}, { body: 'item_id%3D1%26type%3Dpost' }), 'pairs:body'],
    [
      'a URL to the collect endpoint',
      r({}, { url: 'https://edith.xiaohongshu.com/api/sns/web/v1/note/collect' }),
      'value:url',
    ],
    [
      'a URL to …/feed/post',
      r({}, { url: 'https://edith.xiaohongshu.com/api/sns/web/v1/feed/post' }),
      'url-write:url',
    ],
    [
      'a URL to an order',
      r({}, { url: 'https://www.xiaohongshu.com/api/store/order/create' }),
      'url-write:url',
    ],
    ['a URL carrying phone digits', r({}, { url: 'https://x.com/?m=13800138000' }), 'url-host:url'],
    [
      'an `?error_code=` query in a URL',
      r({}, { url: 'https://x.com/p?error_code=1' }),
      'value:url',
    ],
    ['`error_code=` hiding a `code=`', r({}, { q: 'a&error_code=1&code=9' }), 'pairs:q'],
    ['a nested object', r({}, { x: { action: 'like' } }), 'value:x'],
  ])('reverse: %s still pauses', (_label, body, why) => {
    expect(xhs(body)).toBe(`record0:measurement_data:${why}`);
    expect(anchoredLogPost(XHS, 'POST', body)).toBe(false);
  });

  it.each<[string, string, string]>([
    ['an arbitrary measurement name', r({ measurement_name: 'addToCart' }), 'measurement_name'],
    [
      '「like」 after the KHTML token',
      r({ context_userAgent: '(KHTML, like Gecko) follow' }),
      'value:context_userAgent',
    ],
    ['a login route', r({ context_route: '/login' }), 'value:context_route'],
    ['a phone as the visitor id', r({ context_userId: '13800138000' }), 'value:context_userId'],
    ['a 16-hex visitor id', r({ context_userId: '0123456789abcdef' }), 'value:context_userId'],
    ['text in a custom dimension', r({ c1: 'post body text' }), 'value:c1'],
  ])('reverse: %s still pauses', (_label, body, why) => {
    expect(xhs(body)).toBe(`record0:${why}`);
  });

  it('a decoded reading is read too: base64 or URL-encoded action words, short pairs', () => {
    expect(xhs(r({}, { t: Buffer.from('like').toString('base64') }))).toBe(
      'record0:measurement_data:value:t',
    );
    expect(xhs(r({}, { t: '%6C%69%6B%65' }))).toBe('record0:measurement_data:value:t');
    expect(xhs(r({}, { t: 'a%3D1' }))).toBe('record0:measurement_data:pairs:t');
  });

  it('only `url` / `name` hold a URL, and only the SDK’s hosts, no query', () => {
    const feed = base.measurement_data.url;
    expect(xhs(r({}, { source: feed }))).toBe('record0:measurement_data:url-key:source');
    expect(xhs(r({}, { name: feed }))).toBeNull();
    expect(xhs(r({}, { matchedPath: feed }))).toBeNull();
    expect(xhs(r({}, { matchedPath: '//edith.xiaohongshu.com/api/sns/web/v1/feed' }))).toBe(
      'record0:measurement_data:url-key:matchedPath',
    );
    expect(xhs(r({}, { url: `${feed}?num=1` }))).toBe('record0:measurement_data:url-query:url');
    expect(xhs(r({}, { url: 'https://xiaohongshu.com.evil.io/a' }))).toBe(
      'record0:measurement_data:url-host:url',
    );
    expect(xhs(r({}, { api_name: '/api/sns/web/v1/feed/post' }))).toBe(
      'record0:measurement_data:url-write:api_name',
    );
  });

  it.each(['httpRequestTiming', 'infra_sec_web_api_walify', 'pageView', 'renderPerf'])(
    'the real %s record from the 404 page still passes',
    (name) => {
      expect(check([on404(byName(name))])).toBeNull();
    },
  );

  it('the real resource timings from the 404 page still pass — as a batch too', () => {
    const timings = records
      .filter((rec) => rec.measurement_name === 'infraBrowserResourceTiming')
      .map(on404)
      .filter((rec) => !/login/.test(String(rec.measurement_data.name)));
    expect(timings.length).toBeGreaterThan(0);
    expect(check(timings)).toBeNull();
  });
});

describe('DEPLOY-49 复审 #1 · 约数和价格标签 (p312.mjs)', () => {
  const DY =
    '打开 https://www.douyin.com/video/1 读视频标题、作者，以及点赞数、评论数、收藏数、分享数';

  it.each([
    '点赞 2 万左右。',
    '点赞 3 k 以上。',
    '点赞 2万 上下。',
    '点赞约 2 万。',
    '点赞 20000 上下。',
  ])('%s is a guess', (text) => {
    expect(declaredAbsentFields(DY, text)).toEqual(['点赞数']);
  });

  it('reverse: plain counts are answers', () => {
    expect(declaredAbsentFields(DY, '点赞 2 万，评论 215，收藏 4369，分享 1652。')).toEqual([]);
  });

  const P = '- link "Anker Cable"\n- text: SGD 12.81\n- text: S$30';
  const notes = (summary: string) =>
    assessCompletionFacts({ summary, pages: [{ text: P }] }).unverified;

  it.each([
    ['划线价 99', '划线价 99'],
    ['折后 9.9', '折后 9.9'],
    ['到手价 8', '到手价 8'],
    ['券后 9.9 元', '券后 9.9 元'],
    ['regular 99', 'regular 99'],
    ['sale 9.9', 'sale 9.9'],
  ])('a bracket 「%s」 is checked as a price', (note, shown) => {
    expect(notes(`1. Anker Cable — SGD 12.81（${note}）`)).toEqual([`价格（括注）「${shown}」`]);
  });

  it('reverse: a delivery note is no price', () => {
    expect(notes('1. Anker Cable — SGD 12.81（约 2 天送达）')).toEqual([]);
  });
});
