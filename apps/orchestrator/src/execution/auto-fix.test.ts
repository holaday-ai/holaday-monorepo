import { describe, expect, it } from 'vitest';

import { autoFix, pickSimilarUrl } from './auto-fix.js';
import { verifyDeterministic } from './answer-verifier.js';
import { buildContract } from './execution-contract.js';
import { EvidenceLedger } from './evidence-ledger.js';

describe('pickSimilarUrl', () => {
  it('prefers exact-host match with path overlap', () => {
    const grounded = [
      'https://example.com/help/index',
      'https://example.com/about',
      'https://www.iana.org/help/example-domains',
    ];
    expect(pickSimilarUrl('https://example.com/help/missing', grounded)).toBe(
      'https://example.com/help/index',
    );
  });

  it('falls back to suffix-host match (subdomain) when no exact host', () => {
    const grounded = ['https://docs.example.com/page'];
    expect(pickSimilarUrl('https://example.com/page', grounded)).toBe(
      'https://docs.example.com/page',
    );
  });

  it('returns undefined when nothing is similar enough', () => {
    const grounded = ['https://example.com/page'];
    expect(
      pickSimilarUrl('https://totally-different-site.example.org/x', grounded),
    ).toBeUndefined();
  });

  it('returns undefined when grounded list is empty', () => {
    expect(pickSimilarUrl('https://anywhere.example/a', [])).toBeUndefined();
  });

  it('strips www. for host comparison', () => {
    const grounded = ['https://www.example.com/x'];
    expect(pickSimilarUrl('https://example.com/x', grounded)).toBe(
      'https://www.example.com/x',
    );
  });

  it('does not replace a specific child page with its parent directory', () => {
    const grounded = ['https://docs.python.org/3/tutorial/'];
    expect(
      pickSimilarUrl('https://docs.python.org/3/tutorial/appetite.html', grounded),
    ).toBeUndefined();
  });

  it('still replaces a specific child page with a similar specific grounded page', () => {
    const grounded = [
      'https://docs.python.org/3/tutorial/appetite.html',
      'https://docs.python.org/3/tutorial/',
    ];
    expect(
      pickSimilarUrl('https://docs.python.org/3/tutorial/appetites.html', grounded),
    ).toBe('https://docs.python.org/3/tutorial/appetite.html');
  });
});

describe('autoFix — URL fabrication', () => {
  function setup(answer: string, groundedUrls: string[]) {
    const taskId = 'tsk_af';
    const contract = buildContract({
      taskId,
      intent: 'something',
      executionMode: 'generate',
    });
    const ledger = new EvidenceLedger(taskId);
    for (const u of groundedUrls) {
      ledger.add({
        fact: `visited ${u}`,
        sourceType: 'browser_state',
        sourceDetail: 'goto',
        confidence: 'observed',
      });
    }
    const verification = verifyDeterministic({
      contract,
      ledger,
      answerText: answer,
    });
    return { contract, ledger, verification };
  }

  it('substitutes a fabricated URL with a similar grounded one', () => {
    const answer =
      'Per https://example.com/help/wrong-page we should refresh. ' +
      'x'.repeat(60);
    const { contract, ledger, verification } = setup(answer, [
      'https://example.com/help/index',
    ]);
    const out = autoFix({ contract, ledger, verification, answerText: answer });
    expect(out.fixed).toContain('https://example.com/help/index');
    expect(out.fixed).not.toContain('wrong-page');
    expect(out.applied).toHaveLength(1);
    expect(out.applied[0]!.kind).toBe('url_substitute');
  });

  it('drops a fabricated URL when no grounded candidate is similar (no placeholder)', () => {
    const answer =
      'See https://made-up-citation.example/article for context. ' +
      'x'.repeat(60);
    const { contract, ledger, verification } = setup(answer, [
      'https://example.com/help/index',
    ]);
    const out = autoFix({ contract, ledger, verification, answerText: answer });
    // Phase 1 follow-up: the URL is removed without leaving a
    // placeholder. The surrounding sentence still reads cleanly
    // because the fabricated URL was the only structure
    // disappearing — punctuation around it stays.
    expect(out.fixed).not.toContain('made-up-citation');
    expect(out.fixed).not.toContain('[未验证');
    expect(out.applied[0]!.kind).toBe('url_drop');
    // The leading "See " text is preserved.
    expect(out.fixed).toContain('See  for context.');
  });

  it('keeps an all-URL answer meaningful after dropping every ungrounded URL', () => {
    const answer = [
      '1. https://react.dev',
      '2. https://developer.mozilla.org/react',
      '3. https://react.example.com/tutorial',
      '4. https://learn-react.example.org',
      '5. https://react-training.example.net',
    ].join('\n');
    const { contract, ledger, verification } = setup(answer, []);

    const out = autoFix({ contract, ledger, verification, answerText: answer });
    const recheck = verifyDeterministic({
      contract,
      ledger,
      answerText: out.fixed,
    });

    expect(out.fixed).not.toMatch(/https?:\/\//);
    expect(out.fixed).toContain('缺少可验证来源');
    expect(recheck.passed).toBe(true);
  });

  it('markdown link with ungrounded URL collapses to plain text (no empty href)', () => {
    // BOSS Phase 1 follow-up — the SPA's markdown renderer turns
    // an empty `href=""` into a self-link. autoFix must drop the
    // whole `[text](url)` pair instead of leaving `[text]()`.
    const answer =
      '推荐资源：[LearnPython.org](https://learnpython.org) 是一个不错的入门站点。' +
      ' '.repeat(40) + 'x'.repeat(40);
    const { contract, ledger, verification } = setup(answer, [
      'https://example.com/help/index',
    ]);
    const out = autoFix({ contract, ledger, verification, answerText: answer });
    expect(out.fixed).toContain('LearnPython.org');
    expect(out.fixed).not.toContain('[LearnPython.org]');
    expect(out.fixed).not.toContain('learnpython.org');
    expect(out.fixed).not.toContain('](https://');
    expect(out.fixed).not.toContain('[未验证');
    expect(out.applied[0]!.kind).toBe('url_drop');
    expect(out.applied[0]!.detail).toContain('markdown link');
  });

  it('markdown link with grounded URL stays intact', () => {
    const answer =
      '查阅 [help index](https://example.com/help/index) 了解详情。' +
      'x'.repeat(60);
    const { contract, ledger, verification } = setup(answer, [
      'https://example.com/help/index',
    ]);
    const out = autoFix({ contract, ledger, verification, answerText: answer });
    expect(out.fixed).toContain('[help index](https://example.com/help/index)');
    expect(out.applied).toHaveLength(0);
  });

  it('markdown link with similar grounded URL gets substituted', () => {
    const answer =
      '查阅 [help](https://example.com/help/wrong) 了解详情。' +
      'x'.repeat(60);
    const { contract, ledger, verification } = setup(answer, [
      'https://example.com/help/index',
    ]);
    const out = autoFix({ contract, ledger, verification, answerText: answer });
    expect(out.fixed).toContain('[help](https://example.com/help/index)');
    expect(out.fixed).not.toContain('wrong');
    expect(out.applied[0]!.kind).toBe('url_substitute');
  });

  it('preserves trailing punctuation when substituting', () => {
    const answer =
      'See (https://example.com/help/wrong). It explains. ' + 'x'.repeat(60);
    const { contract, ledger, verification } = setup(answer, [
      'https://example.com/help/index',
    ]);
    const out = autoFix({ contract, ledger, verification, answerText: answer });
    // Closing paren must still be there.
    expect(out.fixed).toContain('https://example.com/help/index)');
  });

  it('leaves grounded URLs untouched even when other URLs are fabricated', () => {
    const answer =
      'Real: https://example.com/help/index. Fake: https://fake.example.org/x. ' +
      'x'.repeat(60);
    const { contract, ledger, verification } = setup(answer, [
      'https://example.com/help/index',
    ]);
    const out = autoFix({ contract, ledger, verification, answerText: answer });
    expect(out.fixed).toContain('https://example.com/help/index');
    expect(out.fixed).not.toContain('fake.example.org');
  });
});

describe('autoFix — passes verification through unchanged', () => {
  it('returns original text when verification is passed', () => {
    const contract = buildContract({
      taskId: 'tsk_pass',
      intent: 'simple',
      executionMode: 'generate',
    });
    const ledger = new EvidenceLedger('tsk_pass');
    const answer = 'Plain answer with no URLs at all but long enough.' + 'x'.repeat(60);
    const verification = verifyDeterministic({
      contract,
      ledger,
      answerText: answer,
    });
    const out = autoFix({ contract, ledger, verification, answerText: answer });
    expect(out.fixed).toBe(answer);
    expect(out.applied).toEqual([]);
  });

  it('does nothing when failureLevel is hard_fail (caller escalates)', () => {
    const contract = {
      ...buildContract({
        taskId: 'tsk_hard',
        intent: 'x',
        executionMode: 'browser',
        targetDomain: 'example.com',
      }),
      constraints: ['no_form_submit'],
    };
    const ledger = new EvidenceLedger('tsk_hard');
    ledger.add({
      fact: 'visited https://example.com/',
      sourceType: 'browser_state',
      sourceDetail: 'goto',
      confidence: 'observed',
    });
    ledger.add({
      fact: 'submitted form on /search',
      sourceType: 'browser_state',
      sourceDetail: 'submit',
      confidence: 'observed',
    });
    const answer = 'Did the search.' + 'x'.repeat(60);
    const verification = verifyDeterministic({
      contract,
      ledger,
      answerText: answer,
      finalUrl: 'https://example.com/',
    });
    expect(verification.failureLevel).toBe('hard_fail');
    const out = autoFix({ contract, ledger, verification, answerText: answer });
    expect(out.fixed).toBe(answer);
    expect(out.applied).toEqual([]);
  });
});

describe('autoFix — ecommerce empty URLs', () => {
  it('fills empty JSON url fields from grounded search_ecommerce source URLs', () => {
    const contract = buildContract({
      taskId: 'tsk_ecom_fill',
      intent: '去电商站搜 iPhone 16，按价格排序，给前2结果（名称/价格/链接）',
      executionMode: 'generate',
    });
    const ledger = new EvidenceLedger('tsk_ecom_fill');
    ledger.add({
      fact: 'search_ecommerce_source platform=jd query="iPhone 16" url=https://item.jd.com/100123.html',
      sourceType: 'tool_result',
      sourceDetail: 'search_ecommerce.firecrawl',
      confidence: 'extracted',
    });
    ledger.add({
      fact: 'search_ecommerce_source platform=jd query="iPhone 16" url=https://item.jd.com/100456.html',
      sourceType: 'tool_result',
      sourceDetail: 'search_ecommerce.firecrawl',
      confidence: 'extracted',
    });
    const answer = [
      'JSON',
      JSON.stringify(
        {
          items: [
            { name: 'Apple iPhone 16 128GB', price: 4599, url: '', platform: '京东' },
            { name: 'Apple iPhone 16 256GB', price: 5469, url: '', platform: '京东' },
          ],
        },
        null,
        2,
      ),
    ].join('\n');
    const v1 = verifyDeterministic({ contract, ledger, answerText: answer });
    expect(v1.passed).toBe(false);
    expect(v1.failureLevel).toBe('fixable');
    const out = autoFix({ contract, ledger, verification: v1, answerText: answer });
    expect(out.fixed).toContain('"url": "https://item.jd.com/100123.html"');
    expect(out.fixed).toContain('"url": "https://item.jd.com/100456.html"');
    expect(out.applied.map((op) => op.kind)).toEqual([
      'empty_url_fill',
      'empty_url_fill',
    ]);
    const v2 = verifyDeterministic({ contract, ledger, answerText: out.fixed });
    expect(v2.passed).toBe(true);
  });

  it('prunes markdown rows that reuse catalogue pages instead of product links', () => {
    const contract = buildContract({
      taskId: 'tsk_ecom_prune',
      intent: '去电商站搜 iPhone 16，按价格排序，给前3结果（名称/价格/链接）',
      executionMode: 'browser',
    });
    const ledger = new EvidenceLedger('tsk_ecom_prune');
    ledger.add({
      fact: 'search_ecommerce_product_link platform=taobao query="iPhone 16" url=https://pcdetail.taobao.com/WWNWblVJ.html',
      sourceType: 'tool_result',
      sourceDetail: 'search_ecommerce.firecrawl.product_link',
      confidence: 'extracted',
    });
    ledger.add({
      fact: 'search_ecommerce_source platform=taobao query="iPhone 16" url=https://mobile-phone.taobao.com/chanpin/a623.html',
      sourceType: 'tool_result',
      sourceDetail: 'search_ecommerce.firecrawl',
      confidence: 'extracted',
    });
    const answer = [
      '| # | 商品名称 | 价格 | 链接 |',
      '|---|---|---|---|',
      '| 1 | Apple iPhone 16 | ¥2798 | [淘宝](https://pcdetail.taobao.com/WWNWblVJ.html) |',
      '| 2 | Apple iPhone 16 Plus | ¥2868 | [淘宝](https://mobile-phone.taobao.com/chanpin/a623.html) |',
      '| 3 | Apple iPhone 16 Pro | ¥3208 | [淘宝](https://mobile-phone.taobao.com/chanpin/a623.html) |',
    ].join('\n');

    const v1 = verifyDeterministic({ contract, ledger, answerText: answer });
    expect(v1.passed).toBe(false);
    expect(v1.failureLevel).toBe('fixable');
    const out = autoFix({ contract, ledger, verification: v1, answerText: answer });

    expect(out.fixed).toContain('https://pcdetail.taobao.com/WWNWblVJ.html');
    expect(out.fixed).not.toContain('iPhone 16 Plus');
    expect(out.fixed).not.toContain('iPhone 16 Pro');
    expect(out.fixed).toContain('仅保留了 1 条有独立商品详情链接');
    expect(out.applied.map((op) => op.kind)).toContain('ecommerce_row_prune');
  });

  it('prunes catalogue rows even when product-link evidence is missing', () => {
    const contract = buildContract({
      taskId: 'tsk_ecom_prune_by_shape',
      intent: '去电商站搜 iPhone 16，按价格排序，给前3结果（名称/价格/链接）',
      executionMode: 'browser',
    });
    const ledger = new EvidenceLedger('tsk_ecom_prune_by_shape');
    ledger.add({
      fact: 'search_ecommerce_source platform=taobao query="iPhone 16" url=https://pcdetail.taobao.com/WWNWblVJMTNVaFpTZ1c0cFoyY0N1UT09.html',
      sourceType: 'tool_result',
      sourceDetail: 'search_ecommerce.firecrawl',
      confidence: 'extracted',
    });
    ledger.add({
      fact: 'search_ecommerce_source platform=taobao query="iPhone 16" url=https://mobile-phone.taobao.com/chanpin/a623.html',
      sourceType: 'tool_result',
      sourceDetail: 'search_ecommerce.firecrawl',
      confidence: 'extracted',
    });
    const answer = [
      '| # | 商品名称 | 价格 | 链接 |',
      '|---|---|---|---|',
      '| 1 | Apple iPhone 16 | ¥2798 | [查看](https://pcdetail.taobao.com/WWNWblVJMTNVaFpTZ1c0cFoyY0N1UT09.html) |',
      '| 2 | Apple iPhone 16 Plus | ¥2868 | [查看](https://mobile-phone.taobao.com/chanpin/a623.html) |',
      '| 3 | Apple iPhone 16 Pro | ¥3208 | [查看](https://mobile-phone.taobao.com/chanpin/a623.html) |',
    ].join('\n');

    const v1 = verifyDeterministic({ contract, ledger, answerText: answer });
    expect(v1.passed).toBe(false);
    const out = autoFix({ contract, ledger, verification: v1, answerText: answer });

    expect(out.fixed).toContain('pcdetail.taobao.com/WWNWblVJMTNVaFpTZ1c0cFoyY0N1UT09.html');
    expect(out.fixed).not.toContain('iPhone 16 Plus');
    expect(out.fixed).not.toContain('iPhone 16 Pro');
    expect(out.applied.map((op) => op.kind)).toContain('ecommerce_row_prune');
  });
});

describe('autoFix — duplicate candidate links', () => {
  it('keeps candidate rows but downgrades repeated generic links to same-source text', () => {
    const contract = buildContract({
      taskId: 'tsk_candidate_duplicate_fix',
      intent: '找涩谷附近 3 家适合晚餐的餐厅，给名称、评分、链接',
      executionMode: 'browser',
    });
    const repeatedUrl = 'https://www.google.com/maps/dir/?api=1&destination=shibuya';
    const ledger = new EvidenceLedger('tsk_candidate_duplicate_fix');
    ledger.add({
      fact: `visited ${repeatedUrl}`,
      sourceType: 'browser_state',
      sourceDetail: 'goto',
      confidence: 'observed',
    });
    const answer = [
      '| 餐厅 | 评分 | 链接 |',
      '|---|---:|---|',
      `| Uobei Shibuya | 4.2 | [Google Maps](${repeatedUrl}) |`,
      `| Ichiran Shibuya | 4.1 | [Google Maps](${repeatedUrl}) |`,
      `| Gyukatsu Motomura | 4.6 | [Google Maps](${repeatedUrl}) |`,
      '这三家都在涩谷附近，按评价和距离做了筛选。',
    ].join('\n');

    const v1 = verifyDeterministic({ contract, ledger, answerText: answer });
    expect(v1.passed).toBe(false);
    expect(v1.failureLevel).toBe('fixable');

    const out = autoFix({ contract, ledger, verification: v1, answerText: answer });
    expect(out.applied.map((op) => op.kind)).toContain('duplicate_candidate_link_drop');
    expect(out.fixed).toContain('Uobei Shibuya');
    expect(out.fixed).toContain('Ichiran Shibuya');
    expect(out.fixed).toContain('Gyukatsu Motomura');
    expect(out.fixed.match(new RegExp(repeatedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
    expect(out.fixed).toContain('同一来源页');

    const v2 = verifyDeterministic({ contract, ledger, answerText: out.fixed });
    expect(v2.passed).toBe(true);
  });
});

describe('autoFix — missing fields note', () => {
  it('appends a 补充字段 line when provided inputs missing from answer', () => {
    const contract = buildContract({
      taskId: 'tsk_mf',
      intent: '复盘',
      executionMode: 'generate',
      expertWorkflowId: 'douyin',
      requiredInputs: [
        { name: 'GMV', description: 't', provided: true },
        { name: '客单价', description: 't', provided: true },
      ],
    });
    const ledger = new EvidenceLedger('tsk_mf');
    ledger.add({
      fact: 'GMV=100000, 客单价=80',
      sourceType: 'user_input',
      sourceDetail: 'msg',
      confidence: 'observed',
    });
    const answer = '本场 GMV ¥100000，分析下转化和复购。' + 'x'.repeat(220);
    const verification = verifyDeterministic({
      contract,
      ledger,
      answerText: answer,
    });
    expect(verification.failureLevel).toBe('fixable');
    const out = autoFix({ contract, ledger, verification, answerText: answer });
    expect(out.fixed).toContain('补充字段');
    expect(out.fixed).toContain('客单价');
    const op = out.applied.find((o) => o.kind === 'missing_fields_note');
    expect(op).toBeDefined();
  });
});

describe('autoFix — re-verify after fix', () => {
  it('a successful URL substitution makes the verifier pass on rerun', () => {
    const contract = buildContract({
      taskId: 'tsk_re',
      intent: 'something',
      executionMode: 'generate',
    });
    const ledger = new EvidenceLedger('tsk_re');
    ledger.add({
      fact: 'visited https://example.com/help/index',
      sourceType: 'browser_state',
      sourceDetail: 'goto',
      confidence: 'observed',
    });
    const answer =
      'Source: https://example.com/help/missing-page is the canonical doc. ' +
      'x'.repeat(60);
    const v1 = verifyDeterministic({ contract, ledger, answerText: answer });
    expect(v1.passed).toBe(false);
    const out = autoFix({ contract, ledger, verification: v1, answerText: answer });
    const v2 = verifyDeterministic({
      contract,
      ledger,
      answerText: out.fixed,
    });
    expect(v2.passed).toBe(true);
  });
});
