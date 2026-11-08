import { describe, expect, it } from 'vitest';
import { codeIntentRefusal, looksLikeCodeIntent } from './code-intent.js';

describe('FIX-59 P0: only a request for code or software is code', () => {
  it.each([
    '写一个 Python 爬虫程序',
    '帮我写个登录页的 React 组件',
    '写一个 Python 程序来生成周报',
    '写一个能自动下单的脚本',
    '写一个爬取京东价格的脚本',
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

describe('FIX-59 复审 #1 必须修 1: software of any kind is code', () => {
  it.each([
    '帮我写个 Chrome 插件',
    '写个油猴脚本',
    '写一段 SQL 查询',
    '做一个微信小程序',
    '写一个计算器程序',
    '帮我写一个浏览器扩展',
    '写一个正则表达式',
  ])('code: %s', (intent) => expect(looksLikeCodeIntent(intent)).toBe(true));
  it.each(['写一个小程序的推广文案', '写个 Chrome 插件的使用说明', '做一个 PPT 页面'])(
    'not code: %s',
    (intent) => expect(looksLikeCodeIntent(intent)).toBe(false),
  );
});

describe('FIX-59 复审 #1 必须修 2: browser work and writing are not code', () => {
  it.each([
    '帮我做一个网页截图',
    '帮我在 WordPress 后台创建一个页面',
    '在 Shopify 后台新建一个页面',
    '打开 Notion 新建一个页面',
    '写一个 App Store 的应用描述',
    '写一个 React 组件的教程',
    '给这个 app 写一段评价',
    'Create a new page in the WordPress admin',
  ])('not code: %s', (intent) => expect(looksLikeCodeIntent(intent)).toBe(false));
  it.each(['在 VS Code 里写一个函数', '在 GitHub 上修改代码', '在本地项目里写一个页面组件'])(
    'still code: %s',
    (intent) => expect(looksLikeCodeIntent(intent)).toBe(true),
  );
});

describe('DEPLOY-59 第 0 步 1: refuse only when it is certain', () => {
  // 复审 #2: these went through at 334feca3 and must go through again.
  it.each(['帮我创建一个 Notion 页面', '帮我在后台修改商品页面的价格', '写一个SQL学习计划'])(
    'goes through: %s',
    (intent) => expect(looksLikeCodeIntent(intent)).toBe(false),
  );
  it.each([
    '帮我写个 Chrome 插件',
    '做一个微信小程序',
    '写一段 SQL 查询',
    '写一个计算器程序',
    '写一个 Python 爬虫程序',
    '帮我写个登录页的 React 组件',
    '写一个 Python 程序来生成周报',
    '帮我做个记账 app',
  ])('a code head after a making verb is refused: %s', (intent) =>
    expect(looksLikeCodeIntent(intent)).toBe(true),
  );
  it.each([
    '写一个 SQL 学习计划',
    '写一个 Chrome 插件的使用教程',
    '做一个网页截图',
    '写一个 App Store 的应用描述',
    '写一份爬虫原理的分析',
    '做一个小程序推广方案',
  ])('a writing head goes through: %s', (intent) =>
    expect(looksLikeCodeIntent(intent)).toBe(false),
  );
  // 允许放行: the structure cannot tell these for certain, and the lists are not widened for them.
  it.each([
    'Write a Chrome extension',
    '帮我写一个 React 组件的单元测试',
    '帮我搭建一个网站',
    '帮我创建一个网站',
  ])('允许放行 (not certain): %s', (intent) => expect(looksLikeCodeIntent(intent)).toBe(false));
});
