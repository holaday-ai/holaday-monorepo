import { describe, expect, it } from 'vitest';
import { hasInternalRef, hasSnapshotSyntax } from '../internal-refs.js';
import { renderPriceAnswer, renderPriceFailure, userReason } from './price-render.js';

// Coordinator ruling #2 (bench a1): element ids reached the user in missing / failure reasons —
// wall-jd 「价格所在区块（e31）只含…」, dm-jd-mobile 「位于e31节点，商品标题位于e37节点」,
// reg-new-amazon-sg 「搜索结果页第3个商品卡片 e388 在快照中没有显示具体价格文本」.
const A1_REASONS = [
  '价格所在区块（e31）只含 ¥7??9，未包含规格信息；页面虽在标题里写了 128GB 原色，但该规格与价格不在同一最小节点内，不能绑定到该价格条目。',
  '价格"¥7??9"位于e31节点，商品标题位于e37节点，两者不在同一个最小规格项或商品卡片区块内；且未登录状态下价格为掩码形式，无法确认实际价格',
  '搜索结果页第3个商品卡片 e388 在快照中没有显示具体价格文本',
  'block_ref「e244」太大：里面有 2 个不同价格',
  '- generic [ref=e6]: 没有显示价格',
];
const ELEMENT_ID = /(?<![\p{L}\p{N}_])(?:f\d+)?e\d{1,4}(?![\p{L}\p{N}_])/u;

describe('ruling #2: no element ids or node talk in what the person reads', () => {
  it.each(A1_REASONS)('「%s」', (reason) => {
    for (const language of ['zh', 'en'] as const) {
      const out = userReason(reason, language);
      expect(out).not.toMatch(ELEMENT_ID);
      expect(out).not.toMatch(/节点|区块|block_?ref|快照|snapshot/i);
      expect(hasSnapshotSyntax(out)).toBe(false);
      expect(hasInternalRef(out)).toBe(false);
    }
  });

  it('an ordinary reason is kept as written', () => {
    expect(userReason('页面上没显示价格', 'zh')).toBe('页面上没显示价格');
    expect(userReason('price not shown on the page', 'en')).toBe('price not shown on the page');
  });

  it('the rendered partial answer and failure text carry none either', () => {
    const missing = A1_REASONS.map((reason, i) => ({
      field: 'price',
      item: `商品${i + 1}`,
      reason,
    }));
    const answer = renderPriceAnswer({ language: 'zh', items: [], missing, note: null }).summary;
    const failure = renderPriceFailure(missing, 'zh');
    for (const text of [answer, failure]) {
      expect(text).not.toMatch(ELEMENT_ID);
      expect(text).not.toMatch(/节点|区块|block_?ref|快照/);
    }
  });
});
