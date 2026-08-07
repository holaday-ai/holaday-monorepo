import { describe, expect, it } from 'vitest';
import { classifyLightweightTask } from './lightweight-task.js';

describe('classifyLightweightTask — lightweight intents', () => {
  it('classifies simple arithmetic', () => {
    expect(classifyLightweightTask('1 加 1 等于几？')).toBe('arithmetic');
    expect(classifyLightweightTask('100 * 23')).toBe('arithmetic');
    expect(classifyLightweightTask('计算 12 + 30')).toBe('arithmetic');
    expect(classifyLightweightTask('把 100 摄氏度换算成华氏度')).toBe('arithmetic');
  });

  it('classifies greetings', () => {
    expect(classifyLightweightTask('你好')).toBe('greeting');
    expect(classifyLightweightTask('hello')).toBe('greeting');
    expect(classifyLightweightTask('谢谢！')).toBe('greeting');
    expect(classifyLightweightTask('在吗')).toBe('greeting');
  });

  it('classifies short knowledge questions', () => {
    expect(classifyLightweightTask('什么是 AI？')).toBe('lightweight_knowledge');
    expect(classifyLightweightTask('Python 里 for 循环怎么写？')).toBe('lightweight_knowledge');
    expect(classifyLightweightTask('解释一下递归的概念')).toBe('lightweight_knowledge');
    expect(classifyLightweightTask('什么是动态规划？')).toBe('lightweight_knowledge');
  });

  // Coverage expansion (2026-06-09) — the exact prompts the QA pass
  // drove through the SPA. Pins each phrasing variant so a future
  // tweak to ARITH_OP_RE / CONVERSION_UNIT_RE / GREETING_RE that
  // narrows the net is caught at unit time.
  it('classifies arithmetic with a trailing 等于几 question tail', () => {
    expect(classifyLightweightTask('100 * 23 等于几？')).toBe('arithmetic');
    expect(classifyLightweightTask('12 除以 3 等于几')).toBe('arithmetic');
  });

  it('classifies a unit-conversion question (C→F)', () => {
    expect(classifyLightweightTask('把 100 摄氏度换算成华氏度')).toBe('arithmetic');
    expect(classifyLightweightTask('100 摄氏度等于多少华氏度？')).toBe('arithmetic');
  });

  it('classifies a bare 谢谢 thank-you as a greeting', () => {
    expect(classifyLightweightTask('谢谢')).toBe('greeting');
    expect(classifyLightweightTask('thanks')).toBe('greeting');
  });
});

describe('classifyLightweightTask — must-execute intents stay null', () => {
  it('does NOT intercept browser / URL / interaction tasks', () => {
    expect(classifyLightweightTask('打开 https://example.com')).toBeNull();
    expect(classifyLightweightTask('登录 LinkedIn 查看我的主页')).toBeNull();
    expect(classifyLightweightTask('去 Google Flights 查机票')).toBeNull();
    expect(classifyLightweightTask('帮我在淘宝下单 iPhone')).toBeNull();
  });

  it('does NOT intercept current-data / search tasks', () => {
    expect(classifyLightweightTask('查今天特斯拉股价')).toBeNull();
    expect(classifyLightweightTask('搜索关于 AI 的最新新闻')).toBeNull();
    expect(classifyLightweightTask('现在北京天气怎么样？')).toBeNull();
    expect(classifyLightweightTask('leopold的基金最近发生了什么事？')).toBeNull();
  });

  it('does NOT intercept file-production tasks', () => {
    expect(classifyLightweightTask('生成一个可下载的 Markdown 文件')).toBeNull();
    expect(classifyLightweightTask('帮我做一个表格并导出 csv')).toBeNull();
    expect(classifyLightweightTask('生成 qa-summary.pdf')).toBeNull();
  });

  it('does NOT intercept long-form generation or empty input', () => {
    expect(classifyLightweightTask('帮我写一份完整的产品需求文档 PRD，包含背景、目标、功能列表')).toBeNull();
    expect(classifyLightweightTask('')).toBeNull();
    expect(classifyLightweightTask(null)).toBeNull();
  });

  // Task 2 (2026-06-09) — the exact must-execute prompts BOSS listed.
  // Every one must classify null so it never takes the generate-lane
  // direct-answer shortcut. Routing to browser/scrape/generate is a
  // separate concern (see intent-classifier.test.ts); here we only
  // pin that the lightweight net never swallows an execution task.
  it('does NOT intercept BOSS must-execute set', () => {
    for (const intent of [
      '打开 https://example.com',
      '查今天特斯拉股价',
      '搜索最新 AI 新闻',
      '生成一个可下载的 Markdown 文件',
      '去 Google Flights 查机票',
      '登录 LinkedIn 查看页面',
    ]) {
      expect(classifyLightweightTask(intent), intent).toBeNull();
    }
  });
});
