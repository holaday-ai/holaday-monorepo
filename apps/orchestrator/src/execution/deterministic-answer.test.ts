import { describe, expect, it } from 'vitest';
import { tryDeterministicLightweightAnswer } from './deterministic-answer.js';

describe('tryDeterministicLightweightAnswer — arithmetic hits', () => {
  it('answers a single binary op over plain numbers', () => {
    expect(tryDeterministicLightweightAnswer('1+1')).toBe('1 + 1 = 2');
    expect(tryDeterministicLightweightAnswer('1 加 1 等于几？')).toBe('1 + 1 = 2');
    expect(tryDeterministicLightweightAnswer('100 * 23 等于几？')).toBe('100 × 23 = 2300');
    expect(tryDeterministicLightweightAnswer('100 乘以 23')).toBe('100 × 23 = 2300');
    expect(tryDeterministicLightweightAnswer('12 除以 3')).toBe('12 ÷ 3 = 4');
    expect(tryDeterministicLightweightAnswer('10 减去 4 等于多少')).toBe('10 - 4 = 6');
    expect(tryDeterministicLightweightAnswer('3 * 0.5')).toBe('3 × 0.5 = 1.5');
  });

  it('handles a trailing equals sign', () => {
    expect(tryDeterministicLightweightAnswer('1+1=?')).toBe('1 + 1 = 2');
  });
});

describe('tryDeterministicLightweightAnswer — greeting hits', () => {
  it('answers the canonical greetings only', () => {
    expect(tryDeterministicLightweightAnswer('你好')).toContain('HOLA DAY');
    expect(tryDeterministicLightweightAnswer('你好！')).toContain('HOLA DAY');
    expect(tryDeterministicLightweightAnswer('hello')).toContain('HOLA DAY');
    expect(tryDeterministicLightweightAnswer('谢谢')).toContain('不客气');
    expect(tryDeterministicLightweightAnswer('thanks')).toContain('不客气');
  });

  it('does NOT fire on a greeting with a trailing request', () => {
    // Not a bare greeting — must go to the model (and in routing this
    // would not even be lightweight: it carries a current-data signal).
    expect(tryDeterministicLightweightAnswer('你好，帮我查今天股价')).toBeNull();
  });
});

describe('tryDeterministicLightweightAnswer — returns null (defers to model)', () => {
  it('does NOT do unit conversion', () => {
    expect(tryDeterministicLightweightAnswer('把 100 摄氏度换算成华氏度')).toBeNull();
    expect(tryDeterministicLightweightAnswer('100 摄氏度等于多少华氏度？')).toBeNull();
  });

  it('does NOT do multi-step / chained math or equations', () => {
    expect(tryDeterministicLightweightAnswer('1+2+3')).toBeNull();
    expect(tryDeterministicLightweightAnswer('(1+2)*3')).toBeNull();
    expect(tryDeterministicLightweightAnswer('2x+1=5')).toBeNull();
  });

  it('does NOT emit a repeating / non-terminating decimal', () => {
    expect(tryDeterministicLightweightAnswer('10 除以 3')).toBeNull();
    expect(tryDeterministicLightweightAnswer('1 除以 7')).toBeNull();
  });

  it('rejects divide by zero', () => {
    expect(tryDeterministicLightweightAnswer('5 除以 0')).toBeNull();
  });

  it('does NOT touch knowledge questions', () => {
    expect(tryDeterministicLightweightAnswer('什么是 AI？')).toBeNull();
    expect(tryDeterministicLightweightAnswer('解释一下递归')).toBeNull();
  });

  it('does NOT touch web / action / file / current-data intents', () => {
    for (const intent of [
      '打开 https://example.com',
      '查今天特斯拉股价',
      '搜索最新 AI 新闻',
      '生成一个可下载的 Markdown 文件',
      '去 Google Flights 查机票',
      '登录 LinkedIn 查看页面',
    ]) {
      expect(tryDeterministicLightweightAnswer(intent), intent).toBeNull();
    }
  });

  it('handles empty / overlong / nullish input', () => {
    expect(tryDeterministicLightweightAnswer('')).toBeNull();
    expect(tryDeterministicLightweightAnswer(null)).toBeNull();
    expect(tryDeterministicLightweightAnswer(undefined)).toBeNull();
    expect(tryDeterministicLightweightAnswer('1 + 1 ' + 'x'.repeat(50))).toBeNull();
  });
});
