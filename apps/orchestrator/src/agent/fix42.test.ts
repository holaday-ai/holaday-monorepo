import { describe, expect, it } from 'vitest';
import { assessCompletionFacts } from './browser-tools/completion-fields.js';
import { fieldLines } from './browser-tools/unified-browser-loop.js';
import { answerNotObtained } from './scrape-answer-check.js';
import { cleanInternalAddresses } from './search-fallback/search-engine-fallback.js';
import { humanizeToolMentions } from './text-sanitizer.js';

/** Deploy-42 b-v06 (tsk_BYiBeiPj247B8dCtEZnch): a scrape answer without the song name, completed. */
const B_V06 =
  '根据抓取的 [QQ音乐热歌榜](https://y.qq.com/n/ryqq/toplist/26)（2026-10-27）数据，第一名的**歌曲名称未被抓取到**，只显示歌手是**薛之谦**，时长 04:39。\n\n榜单前几名情况：\n\n| 排名 | 歌手 | 时长 |\n|------|------|------|\n| 1 | 薛之谦 | 04:39 |\n| 2 | 王菲 | 04:36 |\n| 3 | 许嵩 | 04:24 |\n| 4 | 孙燕姿 | 05:20 |\n| 5 | A2O LITE / A2O | 03:28 |\n\n页面抓取时歌曲标题字段缺失，无法确认第一名的具体歌名。';
const B_V06_INTENT = 'QQ音乐热歌榜第一名是啥';

describe('FIX-42 #1 · b-v06: a scrape answer without the asked name is not obtained', () => {
  it('Deploy-42 b-v06 verbatim: the browser gets its try, the answer is not completed', () => {
    expect(answerNotObtained(B_V06, B_V06_INTENT)).toBe(true);
  });

  it.each([
    ['第一名的歌曲名称未被抓取到，只显示歌手是薛之谦。', B_V06_INTENT],
    ['榜单第一名的歌名未能读取，歌手是薛之谦。', B_V06_INTENT],
    ['歌手是薛之谦。无法确认第一名的具体歌名。', B_V06_INTENT],
    ['歌手：薛之谦。歌曲标题没拿到。', B_V06_INTENT],
  ])('「%s」 → not obtained', (answer, intent) => {
    expect(answerNotObtained(answer, intent)).toBe(true);
  });

  it.each([
    ['第一名是《我好像在哪见过你》，歌手薛之谦；专辑名称未被抓取到。', B_V06_INTENT],
    ['上证指数现在 3648.30 点，成交额未被抓取到。', '上证指数现在多少点'],
    ['第一名是《我好像在哪见过你》（薛之谦），无法确认这首歌的发行日期。', B_V06_INTENT],
    ['QQ音乐热歌榜第一名是《我好像在哪见过你》，歌手薛之谦。', B_V06_INTENT],
    // PR #305 review: a title it cannot tell that is not the one asked for.
    ['第一名是《晴天》，歌手周杰伦。无法确认专辑的标题。', B_V06_INTENT],
    ['第一名是《晴天》，歌手周杰伦。无法确认这首歌的英文标题。', B_V06_INTENT],
  ])('reverse: 「%s」 is an answer', (answer, intent) => {
    expect(answerNotObtained(answer, intent)).toBe(false);
  });
});

describe('FIX-42 #3 · cosmetics', () => {
  it('Deploy-42 core-06: 「truncated=false」 and an id-only field line read as words / go', () => {
    expect(
      humanizeToolMentions(
        '已读取第3节「研究課題」（已读到末尾, truncated=false）。\n\n- source_url：https://zh.wikipedia.org/wiki/x\n- tabId：\n',
      ),
    ).toBe(
      '已读取第3节「研究課題」（已读到末尾, 未截断）。\n\n- source_url：https://zh.wikipedia.org/wiki/x\n',
    );
    expect(
      fieldLines([{ name: 'tabId', value: 'tab_3f2a9c1e-7b4d-4e2a-9c1e-7b4d4e2a9c1e' }], ''),
    ).toBe('');
  });

  it('Deploy-42 core-09: 「sizeBytes=0」 → 「0 字节」', () => {
    expect(humanizeToolMentions('文件大小为 0 字节（页面返回的元数据 sizeBytes=0）。')).toBe(
      '文件大小为 0 字节（页面返回的元数据 0 字节）。',
    );
  });

  it.each(['- 作者：张三', '在代码里写 `truncated=false` 即可', '参数 a=true 不变'])(
    'reverse: 「%s」 is left as written',
    (text) => {
      expect(humanizeToolMentions(text)).toBe(text);
    },
  );

  it('Deploy-42 reg-new-google: the internal address is replaced, the words after it stay', () => {
    expect(
      cleanInternalAddresses(
        '已打开 https://search-results.holaday.invalid/search?q=Claude（Brave 搜索接口，非 Google 结果页）。',
      ),
    ).toBe('已打开 搜索接口结果页（Brave 搜索接口，非 Google 结果页）。');
    expect(
      cleanInternalAddresses(
        '见 https://search-results.holaday.invalid/search?q=HOLA%20DAY%20AI 。',
      ),
    ).toBe('见 搜索接口结果页 。');
  });

  /** Deploy-42 dy-1 (scrape), its table as delivered. */
  const DY1_TABLE =
    '这条抖音视频的信息如下：\n\n| 项目 | 内容 |\n|------|------|\n| **标题** | 仙桥洞 真的好美 |\n| **作者** | 利利的旅行盲盒 |\n| **点赞数** | 20 |\n\n数据来源：抖音';
  it('Deploy-42 dy-1: a label/value table checks its values, not its labels as 标题', () => {
    const facts = assessCompletionFacts({
      summary: DY1_TABLE,
      pages: [{ text: '仙桥洞 真的好美\n@利利的旅行盲盒\n20 2 10 97' }],
      receipts: '',
      toolTexts: '',
      intent: '打开 https://www.douyin.com/video/7507106798919601427 读视频标题、作者',
    });
    expect(facts.unverified.join('；')).not.toMatch(/标题「作者」|标题「点赞数」/);
    expect(facts.unverified).toEqual([]);
  });

  it('reverse: a value no page shows is still unverified in a label/value table', () => {
    const facts = assessCompletionFacts({
      summary: DY1_TABLE.replace('利利的旅行盲盒', '另一个作者'),
      pages: [{ text: '仙桥洞 真的好美\n@利利的旅行盲盒\n20 2 10 97' }],
      receipts: '',
      toolTexts: '',
      intent: '打开 https://www.douyin.com/video/7507106798919601427 读视频标题、作者',
    });
    expect(facts.unverified.join('；')).toContain('另一个作者');
  });
});
