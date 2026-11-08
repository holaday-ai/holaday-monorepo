import { describe, expect, it } from 'vitest';
import { codeIntentRefusal, looksLikeCodeIntent } from './code-intent.js';

describe('FIX-59 P0: only a request for code or software is code', () => {
  it.each([
    '写一个 Python 爬虫程序',
    '帮我写个登录页的 React 组件',
    '写一个 Python 程序来生成周报',
    '写一个能自动下单的脚本',
    '写一个爬取京东价格的脚本',
    '帮我写一个 React 组件的单元测试',
    '写一个 python 脚本自动剪辑抖音视频',
    '写一段代码片段',
    'Write a script that generates a weekly report',
    'Write a Python script for a story generator',
    '帮我做个网站',
    '修复代码中的空指针错误',
    '帮我修 bug、整理文档',
  ])('code: %s', (intent) => expect(looksLikeCodeIntent(intent)).toBe(true));

  it.each([
    '写一个程序员深夜加班的小说片段',
    '写一篇关于程序员的公众号文章',
    '帮程序员写一份周报',
    '写一首关于代码的诗',
    '写一个程序猿的段子',
    '写一个关于程序化交易的介绍',
    '帮我写一个晚会节目程序',
    '写一个网站运营方案',
    '做个 app 推广文案',
    '写一个网站的介绍',
    '写个讲述一个开发网站的人的故事',
    '写个脚本，拍抖音用的',
    '帮我写一个短视频口播脚本',
    '做一下页面上的表格整理',
    '写一个关于京东的页面摘要',
    'Write a short story about a programmer',
    'Write a poem about code',
    'Write a script for a YouTube video about coffee',
    'Write the landing page copy for my bakery',
    'Write an essay about building an app',
  ])('writing, not code: %s', (intent) => expect(looksLikeCodeIntent(intent)).toBe(false));
});

describe('FIX-59 P0: the refusal is plain and offers a way forward', () => {
  it('Chinese task, Chinese words', () => {
    const copy = codeIntentRefusal('写一个 Python 爬虫程序');
    expect(copy).toBe(
      '写代码不是我最擅长的，你可以用 Claude Code 或 Cursor。如果你是想让我搜索资料、整理文档或者操作网页，我很乐意帮你。',
    );
    expect(copy).not.toContain('专注浏览器');
  });
  it('English task, English words', () => {
    const copy = codeIntentRefusal('Write a Python script');
    expect(copy).toContain('Claude Code or Cursor');
    expect(copy).not.toMatch(/[㐀-鿿]/);
  });
});
