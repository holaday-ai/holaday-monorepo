import { expect, it } from 'vitest';
import { assessCompletionFacts } from './completion-fields.js';

const pages = [{ text: 'Public video title\n1 year ago\n16年前' }];
const assess = (summary: string) => assessCompletionFacts({ summary, pages });

it.each([
  '1 year ago（相对时间，非精确日期）',
  '16年前(相对时间，非精确日期)',
  '16年前（页面以相对时间显示，未提供绝对日期）',
])('grounds a date value and ignores its explanatory note: %s', (date) => {
  expect(assess(`发布日期：${date}。`)).toEqual({ contradictions: [], unverified: [] });
});
it('flags a different relative date on the same page as a contradiction', () => {
  expect(assess('发布日期：99 years ago（相对时间，非精确日期）。').contradictions).toHaveLength(1);
});
it.each(['1 year ago（精确日期：2099-01-01）', '1 year ago（相对时间，非精确日期；2099-01-01）'])(
  'never silently accepts a parenthetical that carries its own facts: %s',
  (date) => {
    const result = assess(`发布日期：${date}。`);
    expect(result.contradictions.length + result.unverified.length).toBeGreaterThan(0);
  },
);
it('accepts a title followed by an explanatory note', () => {
  expect(assess('标题：Public video title（相对时间，非精确日期）')).toEqual({
    contradictions: [],
    unverified: [],
  });
});
