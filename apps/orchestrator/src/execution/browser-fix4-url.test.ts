import { describe, expect, it } from 'vitest';
import { verifyDeterministic } from './answer-verifier.js';
import { autoFix } from './auto-fix.js';
import { EvidenceLedger } from './evidence-ledger.js';
import { buildContract } from './execution-contract.js';
describe('BROWSER-FIX-4 URL boundaries', () => {
  it('preserves a balanced Wikipedia path and Chinese text outside the Markdown link', () => {
    const url = 'https://en.wikipedia.org/wiki/Science_(journal)';
    const answerText = `[Science](${url})，后续中文保留。`;
    const contract = buildContract({
      taskId: 'balanced',
      intent: '读取页面',
      executionMode: 'browser',
    });
    const ledger = new EvidenceLedger('balanced');
    ledger.add({
      fact: `visited ${url}`,
      sourceType: 'browser_state',
      sourceDetail: 'navigate',
      confidence: 'observed',
    });
    const verification = verifyDeterministic({ contract, ledger, answerText });
    expect(ledger.getGroundedUrls()).toContain(url);
    expect(autoFix({ contract, ledger, answerText, verification }).fixed).toBe(answerText);
  });
  it.each([
    '，依次滚动五次。',
    '后继续读取',
    '。然后继续',
    '；保留内容',
    '：说明',
    '）」说明',
    '』）】说明',
    '**，后续中文',
  ])('preserves Chinese following a grounded URL: %s', (suffix) => {
    const url = 'https://example.com/infinite_scroll';
    const answerText = `打开 ${url}${suffix}`;
    const contract = buildContract({ taskId: 'url', intent: '读取页面', executionMode: 'browser' });
    const ledger = new EvidenceLedger('url');
    ledger.add({
      fact: `visited ${url}`,
      sourceType: 'browser_state',
      sourceDetail: 'navigate',
      confidence: 'observed',
    });
    const verification = verifyDeterministic({ contract, ledger, answerText });
    expect(autoFix({ contract, ledger, answerText, verification }).fixed).toBe(answerText);
    expect(ledger.getGroundedUrls()).toContain(url);
  });
  it('drops only an ungrounded URL, retaining following Chinese text', () => {
    const answerText = '链接 https://wrong.example/abc，后续中文必须保留。';
    const contract = buildContract({ taskId: 'url', intent: '读取页面', executionMode: 'browser' });
    const ledger = new EvidenceLedger('url');
    ledger.add({
      fact: 'https://known.example/read',
      sourceType: 'browser_state',
      sourceDetail: 'navigate',
      confidence: 'observed',
    });
    const verification = verifyDeterministic({ contract, ledger, answerText });
    const fixed = autoFix({ contract, ledger, answerText, verification }).fixed;
    expect(fixed).not.toContain('https://wrong.example');
    expect(fixed).toContain('，后续中文必须保留。');
  });
});
