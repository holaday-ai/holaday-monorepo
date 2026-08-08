import { describe, expect, it } from 'vitest';

import { appendSearchSourceReferences } from './search-source-references.js';

describe('appendSearchSourceReferences', () => {
  it('adds only valid tool-returned links as a clearly labelled verification section', () => {
    expect(
      appendSearchSourceReferences('近期动态已整理。', [
        { title: 'CNBC: fund update', url: 'https://www.cnbc.com/fund-update' },
        { title: 'Ignored', url: 'javascript:alert(1)' },
      ]),
    ).toBe(
      [
        '近期动态已整理。',
        '',
        '### 检索来源',
        '以下链接由联网检索返回，供核验；结论请以来源正文为准。',
        '- [CNBC: fund update](<https://www.cnbc.com/fund-update>)',
      ].join('\n'),
    );
  });

  it('deduplicates provider URLs and never repeats a link already in the answer', () => {
    const result = appendSearchSourceReferences(
      '已核对 https://www.cnbc.com/fund-update。',
      [
        { title: 'CNBC', url: 'https://www.cnbc.com/fund-update' },
        { title: 'Yahoo\nFinance', url: 'https://finance.yahoo.com/fund' },
        { title: 'Yahoo duplicate', url: 'https://finance.yahoo.com/fund' },
      ],
    );

    expect(result).toContain('- [Yahoo Finance](<https://finance.yahoo.com/fund>)');
    expect(result).not.toContain('CNBC](<https://www.cnbc.com/fund-update>)');
    expect(result.match(/finance\.yahoo\.com\/fund/g)).toHaveLength(1);
  });
});
