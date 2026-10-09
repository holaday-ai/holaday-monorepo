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
