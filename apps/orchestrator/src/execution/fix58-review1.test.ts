/** FIX-58 复审 #1 + 协调方代体验: the must-fix and suggested items, one block each. */
import { describe, expect, it } from 'vitest';
import { assessCompletionFacts } from '../agent/browser-tools/completion-fields.js';
import { fieldLines, plainAnswer } from '../agent/browser-tools/unified-browser-loop.js';
import { explainExecutionMode } from '../agent/intent-classifier.js';
import { matchLiveFact } from '../agent/live-fact.js';
import { marketTableAsText, withSourceLinksApart } from '../agent/market-answer.js';
import { autoFix } from './auto-fix.js';
import { EvidenceLedger } from './evidence-ledger.js';
import { buildContract } from './execution-contract.js';
import { checkUngroundedLiveClaims, groundSideMentions } from './ungrounded-live-claims.js';

const logger = { info() {}, warn() {}, debug() {}, error() {} } as never;
const route = (intent: string) => explainExecutionMode({ intent, logger } as never);

function ledger(intent: string, extra?: { fact: string; type: 'file_parse' }): EvidenceLedger {
  const l = new EvidenceLedger('tsk_review1');
  l.add({ fact: intent, sourceType: 'user_input', sourceDetail: 'intent', confidence: 'observed' });
  if (extra)
    l.add({
      fact: extra.fact,
      sourceType: extra.type,
      sourceDetail: 'file',
      confidence: 'observed',
    });
  return l;
}
const check = (answerText: string, intent: string, l = ledger(intent)) =>
  checkUngroundedLiveClaims({ answerText, ledger: l });

/** A price list whose prices sit past the ledger's 500-char cut. */
const LONG_LIST = `${'商品清单说明：本表由门店整理，仅供内部核对。'.repeat(30)}\nA 款 128 元\nB 款 256 元\nC 款 512 元`;

describe('必须修 1 · the user’s own numbers are read whole', () => {
  const answer =
    '| 商品 | 价格 |\n|---|---|\n| A 款 | 128 元 |\n| B 款 | 256 元 |\n| C 款 | 512 元 |';
  it('an attachment past 500 chars (ledger file_parse)', () => {
    expect(LONG_LIST.indexOf('128')).toBeGreaterThan(500);
    const l = ledger('把附件价格表整理成表格', { fact: LONG_LIST, type: 'file_parse' });
    expect(l.entries[1]!.fact.length).toBe(500);
    expect(check(answer, '把附件价格表整理成表格', l)).toBeNull();
  });
  it('an attachment in the core verification context', () => {
    expect(
      checkUngroundedLiveClaims({
        answerText: answer,
        ledger: new EvidenceLedger('tsk_core'),
        verificationContext: {
          initialRequest: '京东这几款价格整理成表格',
          userTurns: [],
          materials: [{ kind: 'text', key: 'f1', source: 'file', text: LONG_LIST }],
        },
      }),
    ).toBeNull();
  });
  it('an invented price beside them still fails when the user asked a live price', () => {
    expect(
      checkUngroundedLiveClaims({
        answerText: `${answer}\n| D 款 | 999 元 |`,
        ledger: new EvidenceLedger('tsk_core'),
        verificationContext: {
          initialRequest: '京东这几款现在多少钱',
          userTurns: [],
          materials: [{ kind: 'text', key: 'f1', source: 'file', text: LONG_LIST }],
        },
      })?.detail,
    ).toContain('999 元');
  });
});

describe('必须修 2 · market tables', () => {
  const answer =
    '上证指数报 3600。\n\n| 指数 | 收盘 | 涨跌 |\n|---|---|---|\n| 上证 | 3600 | +0.5% |\n| 深成 | 11800 | -0.2% |';
  it('a task that asks for a table keeps it', () => {
    for (const intent of ['把今天大盘行情做成表格', '列一个指数收盘列表', 'stock index table'])
      expect(marketTableAsText(answer, intent)).toBe(answer);
  });
  it('the sentence keeps the column names', () => {
    expect(marketTableAsText(answer, '今天大盘收盘怎么样')).toBe(
      '上证指数报 3600。\n\n上证收盘 3600，涨跌 +0.5%；深成收盘 11800，涨跌 -0.2%。\n',
    );
  });
});

describe('必须修 3 · a list said once (「苹果手机多少钱」)', () => {
  const summary =
    '苹果手机价格如下：\n\n1. iPhone Duo：RMB 15,999 起\n2. iPhone 18 Pro：RMB 9,999 起\n3. iPhone Air：RMB 8,799 起';
  const fields = [
    { name: 'iPhone Duo', value: 'RMB 15,999起' },
    { name: 'iPhone 18 Pro', value: 'RMB 9999起' },
    { name: 'iPhone Air', value: 'RMB 8799 起' },
  ];
  it('field values said with other separators and spaces are not added again', () => {
    expect(fieldLines(fields, summary)).toBe('');
  });
  it('a whole repeated list goes', () => {
    const doubled = `${summary}\n\n以上为官方标价。\n\n- iPhone Duo：RMB 15,999起\n- iPhone 18 Pro：RMB 9999起\n- iPhone Air：RMB 8799起`;
    expect(plainAnswer(doubled)).toBe(`${summary}\n\n以上为官方标价。`);
  });
  it('a list with something new stays', () => {
    const more = `${summary}\n\n- iPhone Duo：RMB 15,999起\n- iPhone 17：RMB 6799起`;
    expect(plainAnswer(more)).toContain('iPhone 17：RMB 6799起');
  });
  it('the page’s 「RMB 9999 起」 grounds 「RMB 9999起」 (no 未核实)', () => {
    const facts = assessCompletionFacts({
      summary,
      fields,
      pages: [
        { text: 'iPhone Duo RMB 15999 起\niPhone 18 Pro RMB 9999 起\niPhone Air RMB 8799 起' },
      ],
    });
    expect(facts.unverified).toEqual([]);
  });
});

describe('必须修 4 · weather, rates and quotes asked about today', () => {
  it.each([
    '今天北京天气怎么样',
    '现在美元兑人民币汇率多少',
    '贵州茅台今天股价',
    'what is the weather in Singapore today',
  ])('%s → a live fact without a site', (intent) => {
    expect(matchLiveFact(intent)).not.toBeNull();
  });
  it('the weather keeps its search road (a failed search goes to the browser)', async () => {
    expect(await route('今天北京天气怎么样')).toMatchObject({ mode: 'scrape' });
  });
  it.each([
    ['今天北京晴，气温 12 度，适合出门。', '今天北京天气怎么样'],
    ['北京现在 3.2℃，体感 0℃。', '北京现在多少度 今天天气'],
    ['今天美元兑人民币汇率 7.12。', '现在美元兑人民币汇率多少'],
    ['1 美元 = 7.12 人民币。', '今天汇率多少'],
  ])('an invented value fails: %s', (answerText, intent) => {
    expect(check(answerText, intent)).toMatchObject({
      passed: false,
      severity: 'hard_fail',
      criterionId: 'generic.ungrounded_live_values',
    });
  });
  it('「不知道」 passes', () => {
    expect(
      check('我这次没能查到北京今天的实时天气，建议打开中国天气网查看。', '今天北京天气怎么样'),
    ).toBeNull();
  });
});

describe('必须修 5 · saying a page was operated with nothing read', () => {
  it.each([
    '页面已加载，以下是搜索结果。',
    '我已打开亚马逊新加坡站的搜索页面，结果如下。',
    '数据已提取完毕：共 5 款。',
    'I opened the page and found three cables.',
    'The page has been loaded successfully.',
  ])('%s fails', (answerText) => {
    expect(check(answerText, '推荐几款 USB C 线')).toMatchObject({
      severity: 'hard_fail',
      criterionId: 'generic.pretended_operation',
    });
  });
  it('telling the user what to open is no claim', () => {
    expect(
      check('你可以打开京东搜索「USB C 线」，按销量排序查看。', '推荐几款 USB C 线'),
    ).toBeNull();
  });
});

describe('必须修 6 · English', () => {
  it('lower-case 「according to」 with a site', () => {
    expect(
      check('according to amazon singapore, these are the top picks.', 'recommend usb c cables'),
    ).toMatchObject({ passed: false });
  });
  it('「according to」 without a site is no claim', () => {
    expect(
      check('according to your budget, the second one fits best.', 'recommend usb c cables'),
    ).toBeNull();
  });
  it.each([
    'The Anker cable is currently listed on most stores at $12.99.',
    'You can get the Anker cable for $12.99 right now.',
    'The Anker cable sells for $12.99 as of today.',
  ])('a current word further away in the sentence: %s', (answerText) => {
    expect(check(answerText, 'recommend a usb c cable')).toMatchObject({ passed: false });
  });
  it('an estimate is no claim', () => {
    expect(
      check('The Anker cable is currently about $12.99.', 'recommend a usb c cable'),
    ).toBeNull();
  });
});

describe('建议修 · fixed in place, not failed', () => {
  const fixOf = (answerText: string, intent: string) => {
    const l = ledger(intent);
    const verification = {
      taskId: 'tsk_review1',
      passed: false,
      tier: 'deterministic' as const,
      failureLevel: 'fixable' as const,
      checks: [check(answerText, intent, l)!],
    };
    const contract = buildContract({ taskId: 'tsk_review1', intent } as never);
    return autoFix({ contract, ledger: l, verification, answerText });
  };

  it('a source named in passing: the sentence goes', () => {
    const answer = 'PD 快充最高可到 240W。以上信息来自维基百科。';
    expect(check(answer, '解释一下什么是 PD 快充')).toMatchObject({
      severity: 'fixable',
      criterionId: 'generic.ungrounded_side_mention',
    });
    const out = fixOf(answer, '解释一下什么是 PD 快充');
    expect(out.fixed).toBe('PD 快充最高可到 240W。');
    expect(check(out.fixed, '解释一下什么是 PD 快充')).toBeNull();
  });

  it('a writing task’s example prices are no claim', () => {
    expect(
      check('今日特价！拿铁只要 ¥19.9，第二杯半价。', '帮我写一段咖啡店周末促销文案'),
    ).toBeNull();
    expect(check('海报主文案：现在下单立减 50 元！', '帮我做一张海报')).toBeNull();
  });

  it('a live number on the side of a plan becomes an estimate', () => {
    const intent = '帮我规划北京一日游';
    const answer = '上午去故宫，故宫目前门票 60 元，记得提前预约。下午逛景山。';
    expect(check(answer, intent)).toMatchObject({ severity: 'fixable' });
    const out = groundSideMentions({ answerText: answer, ledger: ledger(intent) });
    expect(out.text).toBe('上午去故宫，故宫门票约 60 元（以官网为准），记得提前预约。下午逛景山。');
    expect(check(out.text, intent)).toBeNull();
  });

  it('the number the user asked for still fails', () => {
    expect(check('故宫目前门票 60 元。', '故宫门票多少钱')).toMatchObject({
      severity: 'hard_fail',
    });
  });

  it('routing looks at the main clause, not every word', async () => {
    const intent = 'iPhone 16 Pro 多少钱？如果买两台要多少';
    expect(matchLiveFact(intent)).not.toBeNull();
    expect((await route(intent)).mode).not.toBe('generate');
    expect(matchLiveFact('京东 iPhone 16 Pro 价格怎么样')).not.toBeNull();
    expect(matchLiveFact('iPhone 16 怎么卖')).not.toBeNull();
    for (const notLive of [
      '帮我写一段文案，主打 iPhone 16 Pro 的价格优势',
      '怎么查京东的历史价格',
      '把以下价格表整理一下',
      '单价 99 元，买 3 个一共多少钱',
    ])
      expect(matchLiveFact(notLive)).toBeNull();
  });

  it('a source link is set apart from the sentence before it', () => {
    expect(
      withSourceLinksApart(
        '已发布**暴雪黄色预警**[中国天气网](https://www.weather.com.cn/a.shtml)。\n[中央气象台](https://www.nmc.cn/b.html) 实况：3.2℃',
      ),
    ).toBe(
      '已发布**暴雪黄色预警**（来源：[中国天气网](https://www.weather.com.cn/a.shtml)）。\n[中央气象台](https://www.nmc.cn/b.html)实况：3.2℃',
    );
    // A link the sentence leads into stays where it is.
    const led = '数据来自[中国天气网](https://www.weather.com.cn/a.shtml)。';
    expect(withSourceLinksApart(led)).toBe(led);
  });
});
