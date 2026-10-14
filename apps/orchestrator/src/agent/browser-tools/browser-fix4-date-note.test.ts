import { expect, it } from 'vitest';
import { completionFieldGaps } from './completion-fields.js';

const pages = [{ text: 'Public video title\n1 year ago\n16年前' }];
it.each(['1 year ago（相对时间，非精确日期）', '16年前(相对时间，非精确日期)'])(
  'grounds the date value while allowing its explicit precision disclaimer: %s',
  (date) => {
    expect(
      completionFieldGaps(`发布日期：${date}。`, 'Public video title', undefined, pages),
    ).toBeNull();
  },
);
it.each([
  '99 years ago（相对时间，非精确日期）',
  '1 year ago（精确日期：2099-01-01）',
  '1 year ago（相对时间，非精确日期；2099-01-01）',
])('does not discard unsupported dates or factual parenthetical content: %s', (date) => {
  expect(
    completionFieldGaps(`发布日期：${date}。`, 'Public video title', undefined, pages),
  ).toBeTruthy();
});
it('does not remove date-like parentheticals from a title', () => {
  expect(
    completionFieldGaps(
      '标题：Public video title（相对时间，非精确日期）',
      'Public video title',
      undefined,
      pages,
    ),
  ).toBeTruthy();
});
