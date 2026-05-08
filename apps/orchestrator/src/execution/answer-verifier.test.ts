import { describe, expect, it } from 'vitest';

import { verifyDeterministic } from './answer-verifier.js';
import type { ExecutionContract } from './execution-contract.js';
import { buildContract } from './execution-contract.js';
import { EvidenceLedger } from './evidence-ledger.js';

function ledgerWith(
  taskId: string,
  ...entries: Array<Parameters<EvidenceLedger['add']>[0]>
): EvidenceLedger {
  const l = new EvidenceLedger(taskId);
  for (const e of entries) l.add(e);
  return l;
}

function happyChecklistContract(taskId: string): ExecutionContract {
  return buildContract({
    taskId,
    intent: 'do something simple',
    executionMode: 'generate',
  });
}

describe('verifyDeterministic — happy paths', () => {
  it('passing checklist task: word_count + no URLs in answer → passed', () => {
    const contract = happyChecklistContract('tsk_p1');
    const ledger = new EvidenceLedger('tsk_p1');
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText:
        'Today is a beautiful day for shipping. The weather is fine and the build is green.',
    });
    expect(result.passed).toBe(true);
    expect(result.tier).toBe('deterministic');
    expect(result.failureLevel).toBeUndefined();
  });

  it('passing browser task: finalUrl matches domain + extracted fact in ledger', () => {
    const contract = buildContract({
      taskId: 'tsk_p2',
      intent: 'open example.com and read title',
      executionMode: 'browser',
      targetDomain: 'example.com',
    });
    const ledger = ledgerWith(
      'tsk_p2',
      {
        fact: 'navigated to https://example.com/',
        sourceType: 'browser_state',
        sourceDetail: 'page.goto',
        confidence: 'observed',
      },
      {
        fact: 'page title = "Example Domain"',
        sourceType: 'tool_result',
        sourceDetail: 'extract',
        confidence: 'extracted',
      },
    );
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText: 'The page title is "Example Domain".',
      finalUrl: 'https://example.com/',
    });
    expect(result.passed).toBe(true);
  });
});

describe('verifyDeterministic — URL fabrication (acceptance #3)', () => {
  it('flags URLs in answer that have no grounded source', () => {
    const contract = happyChecklistContract('tsk_fab');
    const ledger = ledgerWith('tsk_fab', {
      fact: 'visited https://example.com/',
      sourceType: 'browser_state',
      sourceDetail: 'goto',
      confidence: 'observed',
    });
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText:
        'Sources include https://example.com/ and https://made-up-citation.example/article/42 (which the agent never actually visited).',
    });
    expect(result.passed).toBe(false);
    expect(result.failureLevel).toBe('fixable');
    const groundCheck = result.checks.find(
      (c) => c.criterionId === 'generic.url_grounding',
    );
    expect(groundCheck).toBeDefined();
    expect(groundCheck!.passed).toBe(false);
    expect(groundCheck!.detail).toContain('made-up-citation');
    expect(groundCheck!.detail).not.toContain('example.com/');
  });

  it('vacuously passes when answer contains no URLs', () => {
    const contract = happyChecklistContract('tsk_no_url');
    const ledger = new EvidenceLedger('tsk_no_url');
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText: 'No URLs mentioned. Just plain text. ' + 'x'.repeat(60),
    });
    const groundCheck = result.checks.find(
      (c) => c.criterionId === 'generic.url_grounding',
    );
    expect(groundCheck).toBeUndefined();
    expect(result.passed).toBe(true);
  });

  it('tolerates trailing punctuation around URLs in answer', () => {
    const contract = happyChecklistContract('tsk_punct');
    const ledger = ledgerWith('tsk_punct', {
      fact: 'visited https://example.com/help',
      sourceType: 'browser_state',
      sourceDetail: 'goto',
      confidence: 'observed',
    });
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText:
        'See the docs (https://example.com/help). It explains everything you need.',
    });
    expect(result.passed).toBe(true);
  });
});

describe('verifyDeterministic — number cross-validation (acceptance #4)', () => {
  it('flags GMV ≠ 订单数 × 客单价 as needs_clarification', () => {
    const contract = happyChecklistContract('tsk_num');
    const ledger = ledgerWith(
      'tsk_num',
      {
        fact: 'GMV = ¥200000',
        sourceType: 'user_input',
        sourceDetail: 'msg #1',
        confidence: 'observed',
      },
      {
        fact: '订单数 = 500',
        sourceType: 'user_input',
        sourceDetail: 'msg #1',
        confidence: 'observed',
      },
      {
        fact: '客单价 = ¥50',
        sourceType: 'user_input',
        sourceDetail: 'msg #1',
        confidence: 'observed',
      },
    );
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText:
        '直播复盘报告：本场 GMV ¥200000，订单 500 单，客单价 ¥50。' + 'x'.repeat(60),
    });
    expect(result.passed).toBe(false);
    const numCheck = result.checks.find(
      (c) => c.criterionId === 'generic.number_cross_check',
    );
    expect(numCheck).toBeDefined();
    expect(numCheck!.passed).toBe(false);
    expect(numCheck!.detail).toContain('订单数×客单价');
    expect(result.failureLevel).toBe('needs_clarification');
  });

  it('passes when GMV ≈ 订单数 × 客单价 within 5% tolerance', () => {
    const contract = happyChecklistContract('tsk_num_ok');
    const ledger = ledgerWith(
      'tsk_num_ok',
      {
        fact: 'GMV = ¥100000',
        sourceType: 'user_input',
        sourceDetail: 'msg #1',
        confidence: 'observed',
      },
      {
        fact: '订单数 = 1250',
        sourceType: 'user_input',
        sourceDetail: 'msg #1',
        confidence: 'observed',
      },
      {
        fact: '客单价 = ¥80',
        sourceType: 'user_input',
        sourceDetail: 'msg #1',
        confidence: 'observed',
      },
    );
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText: '直播复盘 ' + 'x'.repeat(80),
    });
    const numCheck = result.checks.find(
      (c) => c.criterionId === 'generic.number_cross_check',
    );
    expect(numCheck).toBeDefined();
    expect(numCheck!.passed).toBe(true);
  });

  it('skips cross-check when triple is incomplete', () => {
    const contract = happyChecklistContract('tsk_num_partial');
    const ledger = ledgerWith('tsk_num_partial', {
      fact: 'GMV = ¥100000',
      sourceType: 'user_input',
      sourceDetail: 'msg',
      confidence: 'observed',
    });
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText: 'Just GMV reported. ' + 'x'.repeat(60),
    });
    const numCheck = result.checks.find(
      (c) => c.criterionId === 'generic.number_cross_check',
    );
    expect(numCheck).toBeUndefined();
    expect(result.passed).toBe(true);
  });
});

describe('verifyDeterministic — constraint violations (acceptance #5)', () => {
  it('detects no_form_submit violation in browser_state ledger entry → hard_fail', () => {
    const contract = buildContract({
      taskId: 'tsk_cv',
      intent: '搜索',
      executionMode: 'browser',
      targetDomain: 'example.com',
    });
    const ledger = ledgerWith(
      'tsk_cv',
      {
        fact: 'navigated to https://example.com/',
        sourceType: 'browser_state',
        sourceDetail: 'goto',
        confidence: 'observed',
      },
      {
        fact: 'form_submit fired on /search',
        sourceType: 'browser_state',
        sourceDetail: 'click',
        confidence: 'observed',
      },
    );
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText: 'Did the search.',
      finalUrl: 'https://example.com/',
    });
    expect(result.passed).toBe(false);
    expect(result.failureLevel).toBe('hard_fail');
    const constraintCheck = result.checks.find(
      (c) => c.criterionId === 'generic.constraints',
    );
    expect(constraintCheck!.passed).toBe(false);
    expect(constraintCheck!.detail).toContain('no_form_submit');
  });

  it('Chinese constraint alias 不进行支付 maps to no_payment and detects 支付/checkout', () => {
    const contract: ExecutionContract = {
      ...buildContract({
        taskId: 'tsk_pay',
        intent: '比价',
        executionMode: 'browser',
        targetDomain: 'taobao.com',
      }),
      constraints: ['不进行支付'],
    };
    const ledger = ledgerWith(
      'tsk_pay',
      {
        fact: 'opened https://taobao.com/cart',
        sourceType: 'browser_state',
        sourceDetail: 'goto',
        confidence: 'observed',
      },
      {
        fact: 'clicked checkout button',
        sourceType: 'browser_state',
        sourceDetail: 'click',
        confidence: 'observed',
      },
    );
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText: 'Did the thing.',
      finalUrl: 'https://taobao.com/cart',
    });
    expect(result.passed).toBe(false);
    expect(result.failureLevel).toBe('hard_fail');
  });

  it('does not flag user-input mentions of forbidden actions', () => {
    // user mentioning "支付" in their request is NOT a violation — it's
    // the agent's actions that matter. Only browser_state / tool_result
    // entries are audited.
    const contract = buildContract({
      taskId: 'tsk_uin',
      intent: '问题：支付遇到问题',
      executionMode: 'browser',
      targetDomain: 'example.com',
    });
    const ledger = ledgerWith(
      'tsk_uin',
      {
        fact: '用户提到：支付失败',
        sourceType: 'user_input',
        sourceDetail: 'msg',
        confidence: 'observed',
      },
      {
        fact: 'navigated to https://example.com/help',
        sourceType: 'browser_state',
        sourceDetail: 'goto',
        confidence: 'observed',
      },
    );
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText: 'See https://example.com/help for the answer.',
      finalUrl: 'https://example.com/help',
    });
    expect(result.passed).toBe(true);
  });
});

describe('verifyDeterministic — criterion: word_count', () => {
  it('fails when answer is below threshold and severity is fixable', () => {
    const contract = happyChecklistContract('tsk_wc');
    const result = verifyDeterministic({
      contract,
      ledger: new EvidenceLedger('tsk_wc'),
      answerText: 'too short',
    });
    expect(result.passed).toBe(false);
    expect(result.failureLevel).toBe('fixable');
    const wc = result.checks.find((c) =>
      c.detail.includes('outside'),
    );
    expect(wc).toBeDefined();
  });
});

describe('verifyDeterministic — criterion: url_match', () => {
  it('fails with needs_clarification when finalUrl is missing', () => {
    const contract = buildContract({
      taskId: 'tsk_um',
      intent: '打开',
      executionMode: 'browser',
      targetDomain: 'example.com',
    });
    const ledger = ledgerWith('tsk_um', {
      fact: 'navigated to https://example.com/',
      sourceType: 'browser_state',
      sourceDetail: 'goto',
      confidence: 'observed',
    });
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText: 'Could not navigate.',
      // no finalUrl
    });
    expect(result.passed).toBe(false);
    expect(result.failureLevel).toBe('needs_clarification');
  });

  it('fails when finalUrl is a different domain', () => {
    const contract = buildContract({
      taskId: 'tsk_um2',
      intent: '打开',
      executionMode: 'browser',
      targetDomain: 'example.com',
    });
    const ledger = ledgerWith('tsk_um2', {
      fact: 'navigated to https://different.com/',
      sourceType: 'browser_state',
      sourceDetail: 'goto',
      confidence: 'observed',
    });
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText: 'Reached different.com instead.',
      finalUrl: 'https://different.com/',
    });
    expect(result.passed).toBe(false);
  });
});

describe('verifyDeterministic — criterion: data_present', () => {
  it('hard_fails when ledger has no productive entries', () => {
    const contract = buildContract({
      taskId: 'tsk_dp',
      intent: '抓取',
      executionMode: 'browser',
      targetDomain: 'example.com',
    });
    const ledger = new EvidenceLedger('tsk_dp');
    // Add only inferred entries — not productive.
    ledger.add({
      fact: 'I think the answer is 42',
      sourceType: 'inference',
      sourceDetail: 'llm',
      confidence: 'inferred',
    });
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText: 'Some answer text long enough to pass word_count threshold easily.',
      finalUrl: 'https://example.com/',
    });
    expect(result.passed).toBe(false);
    expect(result.failureLevel).toBe('hard_fail');
  });
});

describe('verifyDeterministic — criterion: covers_required_inputs (full tier)', () => {
  it('passes when answer mentions every provided input name', () => {
    const contract = buildContract({
      taskId: 'tsk_full',
      intent: '复盘',
      executionMode: 'generate',
      expertWorkflowId: 'douyin',
      requiredInputs: [
        { name: 'GMV', description: '总成交额', provided: true },
        { name: '客单价', description: '人均下单金额', provided: true },
      ],
    });
    const ledger = ledgerWith('tsk_full', {
      fact: 'GMV=100000, 客单价=80',
      sourceType: 'user_input',
      sourceDetail: 'msg',
      confidence: 'observed',
    });
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText:
        '直播复盘：本场 GMV ¥100000，客单价 ¥80。从 ROI 看转化合理，建议下次提升 UV。',
    });
    const cri = result.checks.find((c) =>
      c.detail.includes('provided inputs'),
    );
    expect(cri).toBeDefined();
    expect(cri!.passed).toBe(true);
  });

  it('fails fixable when a provided input is missing from answer', () => {
    const contract = buildContract({
      taskId: 'tsk_full2',
      intent: '复盘',
      executionMode: 'generate',
      expertWorkflowId: 'douyin',
      requiredInputs: [
        { name: 'GMV', description: 't', provided: true },
        { name: '客单价', description: 't', provided: true },
      ],
    });
    const ledger = ledgerWith('tsk_full2', {
      fact: 'GMV=100000, 客单价=80',
      sourceType: 'user_input',
      sourceDetail: 'msg',
      confidence: 'observed',
    });
    const result = verifyDeterministic({
      contract,
      ledger,
      // GMV present, 客单价 absent → fixable
      answerText: '直播复盘：本场 GMV ¥100000 表现良好。' + 'x'.repeat(200),
    });
    const cri = result.checks.find((c) =>
      c.detail.includes('provided inputs missing'),
    );
    expect(cri).toBeDefined();
    expect(cri!.passed).toBe(false);
    expect(result.failureLevel).toBe('fixable');
  });
});

describe('verifyDeterministic — failure-level priority', () => {
  it('unprovided requiredInputs forces needs_clarification regardless', () => {
    const contract = buildContract({
      taskId: 'tsk_fl',
      intent: '复盘',
      executionMode: 'generate',
      expertWorkflowId: 'douyin',
      requiredInputs: [
        { name: 'GMV', description: 't', provided: false },
      ],
    });
    const ledger = new EvidenceLedger('tsk_fl');
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText: '...',
    });
    expect(result.passed).toBe(false);
    expect(result.failureLevel).toBe('needs_clarification');
  });

  it('hard_fail wins over fixable when both present', () => {
    const contract: ExecutionContract = {
      ...buildContract({
        taskId: 'tsk_pri',
        intent: '搜索',
        executionMode: 'browser',
        targetDomain: 'example.com',
      }),
      constraints: ['no_form_submit'],
    };
    const ledger = ledgerWith(
      'tsk_pri',
      {
        fact: 'navigated to https://example.com/',
        sourceType: 'browser_state',
        sourceDetail: 'goto',
        confidence: 'observed',
      },
      {
        fact: 'submitted form on /search',
        sourceType: 'browser_state',
        sourceDetail: 'submit',
        confidence: 'observed',
      },
    );
    const result = verifyDeterministic({
      contract,
      ledger,
      // Short answer would also fail word_count (fixable)
      answerText: 'short.',
      finalUrl: 'https://example.com/',
    });
    expect(result.passed).toBe(false);
    // Both fixable (word_count) and hard_fail (constraint) failures
    // present; hard_fail wins.
    expect(result.failureLevel).toBe('hard_fail');
  });
});

describe('verifyDeterministic — suggestion building', () => {
  it('includes grounded URLs in the suggestion when fabrication detected', () => {
    const contract = happyChecklistContract('tsk_sug');
    const ledger = ledgerWith('tsk_sug', {
      fact: 'visited https://real.example.com/page',
      sourceType: 'browser_state',
      sourceDetail: 'goto',
      confidence: 'observed',
    });
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText:
        'Source: https://made-up.example.com/cite — but the answer is long enough for word_count.',
    });
    expect(result.passed).toBe(false);
    expect(result.suggestedFix).toBeDefined();
    expect(result.suggestedFix).toContain('grounded URLs');
    expect(result.suggestedFix).toContain('https://real.example.com/page');
  });
});
