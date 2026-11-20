import { describe, expect, it } from 'vitest';
import { looksLikeCodeIntent } from '../../agent/code-intent.js';

describe('D10 code scope distinguishes website viewing from development', () => {
  it.each([
    '打开 GitHub 设置页只读查看、不修改，不做任何操作',
    '打开 https://github.com/settings/profile，检查登录状态，不修改设置',
    '访问 GitHub 仓库首页，只看 README，不写代码',
    '查看 GitHub 上这个 PR 的讨论，不提交 PR',
    '去 GitHub 登录页看看，不做设置修改',
    'Open github.com/settings and check whether I am logged in',
    'View this GitHub repository; do not edit code or create a PR',
    'Browse the GitHub releases page and summarize the changes',
    '查看开发者网站上的 API 文档',
    '在后台做一次只读登录检查',
  ])('allows viewing: %s', (intent) => expect(looksLikeCodeIntent(intent)).toBe(false));
  it.each([
    '帮我写一个 React 组件',
    '修改仓库文件 README.md',
    '修复代码中的空指针错误',
    '给这个仓库提交 PR',
    '重构这个函数',
    '帮我做个网站',
    'Edit the repository files and submit a PR',
    'Write code for a login form',
    'Fix the bug in src/app.ts',
    '打开 GitHub 然后修改代码并提 PR',
  ])('rejects development: %s', (intent) => expect(looksLikeCodeIntent(intent)).toBe(true));
});

// Fixed PR255 round-two corpus, including every independent review regression.
it.each([
  'Open the PR #123 on GitHub and read its discussion',
  'Open pull request #123 in GitHub in read-only mode; do not edit code',
  'open PR #123',
  '打开 holaday 的 PR 看讨论',
  '查看 pull request',
  'Open https://github.com/org/repo/pull/123',
  'Open the PR and review its discussion',
  'Read PR #42 and summarize reviewer comments',
  '打开 GitHub 设置页只读查看、不修改',
  '查看 GitHub issue #99',
  'Read the issue discussion about fixing the bug',
  'Check whether github.com/settings requires login',
  '打开仓库 README 看安装说明',
  '查看 GitHub Actions 的部署记录',
  'Review the discussion on the existing pull request',
  'Open issue #34 on GitHub',
  '打开 GitHub Releases 页面查看版本',
  'Browse github.com without editing repository files',
  '解释如何编写 Python 脚本',
  'Explain how to build a website',
  '查看修改代码的教程',
  '分析插件开发的流程',
  '写一篇关于 React 组件的文章',
  '不要写代码，只查看页面',
  'Do not create a PR; read PR #12',
  'Review the existing PR without modifying code',
  '查看“帮我建站”这个 issue 的讨论',
  'Write a report about deploying an app',
])('round-two readonly: %s', (intent) => expect(looksLikeCodeIntent(intent)).toBe(false));
it.each([
  '帮我建站',
  '帮我开发一个后台系统',
  '帮我写个插件',
  '帮我写一个 TypeScript 函数',
  '帮我编写 Python 脚本',
  '帮我部署这个应用',
  'Analyze requirements and build a website',
  '查看需求并修改代码',
  'Write a Python script',
  'Build a plugin',
  'Deploy the app to production',
  '帮我写一个简单的 React 登录页面',
  '创建一个 PR',
  '提交 PR',
  '发起一个 pull request',
  '新开一个 PR',
  'Open a new PR for these changes',
  '帮我改代码后提 PR',
  '看看需求，然后写一个组件',
  '分析需求并帮我实现一个接口',
  '修复这个仓库的 bug',
  '帮我写一个浏览器扩展',
  'Build a simple React login component',
  'Write a TypeScript function',
  '修改仓库文件 README.md',
  '开发一个小程序',
  '请调试这个程序',
  '重构这个函数',
  '查看 PR #123，然后修复代码',
  'Read the discussion and submit a PR',
  '不要建站，但帮我写脚本',
  '帮我实现一个 API',
  'Compile the program',
  '帮我上线这个网站',
])('round-two development: %s', (intent) => expect(looksLikeCodeIntent(intent)).toBe(true));

it.each([
  'Open a PR and read its discussion',
  'Open a PR at https://github.com/org/repo/pull/123',
  'Read a guide to build a website',
  '不改代码，查看 GitHub issue',
])('existing target and instructional context: %s', (intent) =>
  expect(looksLikeCodeIntent(intent)).toBe(false),
);

it('does not hide a development instruction after an unspaced URL', () => {
  expect(looksLikeCodeIntent('打开 https://github.com/org/repo/pull/123，然后修改代码')).toBe(true);
});
