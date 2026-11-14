/** FIX-58 P0 · nothing read outside → no source claims, no live values (any lane). */
import { describe, expect, it } from 'vitest';
import { EvidenceLedger } from './evidence-ledger.js';
import { checkUngroundedLiveClaims } from './ungrounded-live-claims.js';

function ledger(intent: string, read?: string): EvidenceLedger {
  const l = new EvidenceLedger('tsk_test');
  l.add({ fact: intent, sourceType: 'user_input', sourceDetail: 'intent', confidence: 'observed' });
  l.add({
    fact: 'response_length=300',
    sourceType: 'tool_result',
    sourceDetail: 'llm',
    confidence: 'observed',
  });
  if (read)
    l.add({
      fact: read,
      sourceType: 'tool_result',
      sourceDetail: 'search',
      confidence: 'observed',
    });
  return l;
}

/** The online answer (tsk_pVJkbLniTrmcPdrjJoRm7), shortened. */
const INVENTED = `\`\`\`json
{
  "query": "USB C 线",
  "items": [
    { "rank": 1, "name": "Amazon Basics USB-C to USB-A 3.1 Gen 1 Cable, 6 Foot, Black", "price": 12.90, "url": "", "platform": "Amazon Singapore" },
    { "rank": 2, "name": "Anker PowerLine+ USB-C to USB-A 3.0 Cable, 6ft", "price": 19.90, "url": "", "platform": "Amazon Singapore" }
  ]
}
\`\`\`

价格为新加坡元（SGD），数据来自 Amazon Singapore 搜索结果页。实际价格可能因促销、库存变化而波动。`;

describe('FIX-58 P0 · ungrounded live claims', () => {
  it('the online answer fails (source claim, nothing read)', () => {
    const check = checkUngroundedLiveClaims({
      answerText: INVENTED,
      ledger: ledger('亚马逊新加坡站 USB C 线价格'),
    });
    expect(check).toMatchObject({
      passed: false,
      severity: 'hard_fail',
      criterionType: 'ungrounded_live_claim',
    });
  });

  it('invented prices without a source claim fail too when the user asked a live fact', () => {
    const check = checkUngroundedLiveClaims({
      answerText: '1. Anker USB C Cable — S$12.99\n2. UGREEN USB C Cable — S$10.92',
      ledger: ledger('亚马逊新加坡站 USB C 线价格'),
    });
    expect(check?.detail).toContain('S$12.99');
  });

  it.each([
    [
      'According to Amazon, the cable costs about that much.',
      'USB C cable price on Amazon Singapore',
    ],
    ['根据京东的搜索结果，这款手机卖得很好。', '京东 iPhone 16 Pro 怎么样'],
    ['以上信息来源：淘宝商城。', '帮我看看这件衣服'],
  ])(
    'a source claim with nothing read is caught (复审 #1: its sentence goes): %s',
    (answerText, intent) => {
      expect(checkUngroundedLiveClaims({ answerText, ledger: ledger(intent) })).toMatchObject({
        passed: false,
        severity: 'fixable',
        criterionId: 'generic.ungrounded_side_mention',
      });
    },
  );

  it('the same answer passes when something was read', () => {
    expect(
      checkUngroundedLiveClaims({
        answerText: INVENTED,
        ledger: ledger(
          '亚马逊新加坡站 USB C 线价格',
          'web_search_url=https://www.amazon.sg/s?k=usb+c',
        ),
      }),
    ).toBeNull();
  });

  it.each([
    ['帮我写一个促销文案，原价 199 元现价 99 元', '限时特惠！原价 199 元，现价只要 99 元！'],
    ['帮我做一份北京三日游预算', '第一天：故宫门票约 60 元，午餐约 80 元。合计约 500 元。'],
    ['解释一下什么是 PD 快充', 'PD 是 USB Power Delivery 的缩写，最高可到 240W。'],
    ['中国人口多少', '中国人口约 14.1 亿（国家统计局 2023 年数据）。'],
    ['总结一下你提供的数据', '根据你提供的数据，销量最好的是第 2 款。'],
  ])('ordinary answers pass: %s', (intent, answerText) => {
    expect(checkUngroundedLiveClaims({ answerText, ledger: ledger(intent) })).toBeNull();
  });

  it('a value presented as current is caught even when the request was not a live fact', () => {
    const check = checkUngroundedLiveClaims({
      answerText: '这款耳机目前售价 ¥1299，很值得入手。',
      ledger: ledger('推荐一款降噪耳机'),
    });
    // 复审 #1 建议修: not the value asked for — said as an estimate, not a failure.
    expect(check).toMatchObject({ passed: false, severity: 'fixable' });
  });

  it('the user turn in the core context counts as the user’s own words', () => {
    expect(
      checkUngroundedLiveClaims({
        answerText: '原价 199 元，现价 99 元。',
        ledger: new EvidenceLedger('tsk_core'),
        userIntent: '亚马逊新加坡站这款线原价 199 元现价 99 元，帮我写一句推荐',
      }),
    ).toBeNull();
  });
});
