import { describe, expect, it } from 'vitest';
import { completionGap } from './browser-tools/browser-completion.js';
import { hasInternalRef, stripInternalRefs } from './internal-refs.js';
import { decodeHtmlEntities, sanitizeFinalText } from './text-sanitizer.js';

/** Deploy-40 core-11 (tsk_JcfthzNceMxxYecTpDF54), verbatim. */
const CORE_11 =
  '已在 https://the-internet.herokuapp.com/infinite_scroll 完成5次向下滚动，每次滚动后页面高度均增长并加载新内容。第5次滚动后当前视口内可见的内容为7段 Lorem Ipsum 风格的文本块（snapshot 中），页面标题为「Infinite Scroll」，底部显示「Powered by Elemental Selenium and Sauce Labs」。\n\n- visible_blocks_after_5th_scroll：7 text blocks (refs e12, e13, e19, e20, e21, e22, e23)\n\n未核实：以下内容未能在已读页面中逐字找到，请自行确认——visible_blocks_after_5th_scroll「7 text blocks (refs e12, e13, e19, e20, e21, e22, e23)」；visible_blocks_after_5th_scroll（括注）「refs e12」';

/** Deploy-40 core-04 (tsk_gkcJBvthvxBjfCstJ6m7F): the summary rejected twice, verbatim. */
const CORE_04 =
  '在 YouTube 搜索「Playwright tutorial」并切换到 Videos 标签后，按顺序提取的前 5 个视频标题如下：\n\n1. What is Playwright? (🎭 Playwright introduction tutorial, features & demo)\n2. Software Testing Course – Playwright, E2E, and AI Agents\n3. Full Course - Playwright Automation Testing With TypeScript In 6 Hours | Playwright Tutorial\n4. Playwright Automation Full Course for Beginners | Build Production Level Framework from Scratch\n5. Playwright with TypeScript : Learn Playwright Automation Tutorial from Scratch [6 Hours]';
const CORE_04_INTENT = '请使用云端浏览器，YouTube 搜索「Playwright tutorial」返回前5个视频标题';
const YT = 'https://www.youtube.com/results?search_query=Playwright+tutorial';

describe('FIX-40 #1 · refs (plural) are internal refs too', () => {
  it('Deploy-40 core-11: no ref left in the answer, the field or the note', () => {
    expect(hasInternalRef(CORE_11)).toBe(true);
    const shown = sanitizeFinalText(CORE_11);
    expect(shown).not.toMatch(/\brefs?\b\s*[=:：]?\s*e\d/i);
    expect(shown).not.toMatch(/\be(?:12|13|19|2\d)\b/);
    expect(shown).toContain('- visible_blocks_after_5th_scroll：7 text blocks');
    expect(shown).toContain('visible_blocks_after_5th_scroll「7 text blocks」');
    expect(hasInternalRef(shown)).toBe(false);
  });

  it.each([
    ['7 个段落块（refs e12, e13, e19–e23）', '7 个段落块'],
    ['段落 refs: e12–e23 已读', '段落已读'],
    ['按钮 (ref e12) 已点', '按钮已点'],
    ['Blocks (Refs E12, E13) loaded', 'Blocks loaded'],
  ])('%s → %s', (input, expected) => {
    expect(stripInternalRefs(input)).toBe(expected);
  });

  it.each([
    'see the refs for details',
    'git refs/heads/main was updated',
    '参考文献 refs 共 3 条',
    'URL https://x.test/?refs=e12 stays',
    '`refs e12` in code stays',
  ])('reverse: 「%s」 is left as written', (text) => {
    expect(stripInternalRefs(text)).toBe(text);
  });
});

describe('FIX-40 #2 · a tab on the page is not a browser tab', () => {
  const searched = [
    { tool: 'navigate', ok: true, url: 'https://www.youtube.com/' },
    { tool: 'type', ok: true, url: 'https://www.youtube.com/' },
    { tool: 'snapshot', ok: true, url: YT },
  ];

  it('Deploy-40 core-04: 「切换到 Videos 标签」 with a click is no switch_tab claim', () => {
    const trace = [...searched, { tool: 'click', ok: true, url: `${YT}&sp=EgIQAQ%3D%3D` }];
    expect(completionGap(CORE_04_INTENT, CORE_04, trace as never, true) ?? '').not.toMatch(
      /switch_tab|页面控件/,
    );
  });

  it('a page tab claim needs no switch_tab even without a click (FIX-26 kept)', () => {
    expect(completionGap(CORE_04_INTENT, CORE_04, searched as never, true) ?? '').not.toMatch(
      /switch_tab/,
    );
  });

  it.each([
    ['已打开新标签页读取标题', 'new_tab'],
    ['在新标签页中打开了链接并读取标题', 'new_tab'],
    ['已切回起始标签页', 'switch_tab'],
    ['切换到第 2 个标签页后读取', 'switch_tab'],
    ['switched back to the original tab', 'switch_tab'],
  ])('reverse: 「%s」 with no %s receipt is still sent back', (summary, tool) => {
    const trace = [...searched, { tool: 'click', ok: true, url: YT }];
    expect(completionGap('读取页面标题', summary, trace as never, true)).toMatch(
      new RegExp(`动作 ${tool} 没有成功工具回执`),
    );
  });

  it('「点开『热门』标签」 and 「switched to the Videos tab」 with a click are page controls', () => {
    const trace = [...searched, { tool: 'click', ok: true, url: YT }];
    for (const summary of [
      '点开『热门』标签后读取了前 3 条',
      'switched to the Videos tab and read the list',
    ])
      expect(completionGap('读取页面', summary, trace as never, true) ?? '').not.toMatch(
        /switch_tab/,
      );
  });
});

describe('FIX-40 #3 · HTML entities in an answer are decoded (code untouched)', () => {
  it('Deploy-40 new-google', () => {
    expect(
      sanitizeFinalText('摘要原文：「Claude is Anthropic&#x27;s AI, built for problem solvers.」'),
    ).toBe("摘要原文：「Claude is Anthropic's AI, built for problem solvers.」");
  });
  it.each([
    ['Tom &amp; Jerry', 'Tom & Jerry'],
    ['&quot;quoted&quot; &#39;single&#39;', '"quoted" \'single\''],
    ['caf&#233; &#x4e2d;文', 'café 中文'],
    ['a&nbsp;b', 'a b'],
  ])('%s → %s', (input, expected) => {
    expect(decodeHtmlEntities(input)).toBe(expected);
  });
  it.each([
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    '&#60;b&#62;',
    '`a &amp; b` in code',
    '```\nconst s = "&#x27;";\n```',
    'AT&T and R&D',
  ])('reverse: 「%s」 is left as written', (text) => {
    expect(decodeHtmlEntities(text)).toBe(text);
  });
});
