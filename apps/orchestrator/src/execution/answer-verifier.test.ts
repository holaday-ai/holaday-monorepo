import { describe, expect, it } from 'vitest';

import { extractStructuredItems, verifyDeterministic } from './answer-verifier.js';
import { DOUYIN_REVIEW_WORKFLOW } from './expert-workflow-douyin.js';
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

describe('verifyDeterministic — empty-result guard (product polish #2)', () => {
  it('flags near-empty markdown (headers + ordinals only, no meaningful content)', () => {
    const contract = happyChecklistContract('tsk_empty');
    const ledger = new EvidenceLedger('tsk_empty');
    // Model hit max_tokens or post-check stripped the body — what
    // lands is structurally markdown but content-empty.
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText: '## 报告\n\n1. \n2. \n3. ',
    });
    expect(result.passed).toBe(false);
    expect(result.failureLevel).toBe('fixable');
    const emptyCheck = result.checks.find(
      (c) => c.criterionId === 'generic.empty_result',
    );
    expect(emptyCheck).toBeDefined();
    expect(emptyCheck?.passed).toBe(false);
    expect(emptyCheck?.severity).toBe('fixable');
  });

  it('passes when meaningful content >= 20 chars after sanitization', () => {
    const contract = happyChecklistContract('tsk_ok');
    const ledger = new EvidenceLedger('tsk_ok');
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText:
        '## 报告\n\n1. 网站访问量增长了 30%\n2. 用户留存稳定在 80%',
    });
    expect(result.passed).toBe(true);
    const emptyCheck = result.checks.find(
      (c) => c.criterionId === 'generic.empty_result',
    );
    // No check appended when meaningful >= 20 (the guard returns null).
    expect(emptyCheck).toBeUndefined();
  });

  it('strips table pipes + code markers before measuring (truly empty table)', () => {
    // A pipe-table with NO content cells — just structure + dashes.
    // After sanitization meaningful body collapses below the floor.
    const contract = happyChecklistContract('tsk_pipes');
    const ledger = new EvidenceLedger('tsk_pipes');
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText: '|   |   |\n|---|---|\n|   |   |\n',
    });
    expect(result.passed).toBe(false);
    const emptyCheck = result.checks.find(
      (c) => c.criterionId === 'generic.empty_result',
    );
    expect(emptyCheck?.passed).toBe(false);
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

const fullTierContract = (taskId: string): ExecutionContract =>
  buildContract({
    taskId,
    intent: '复盘抖音直播',
    executionMode: 'generate',
    expertWorkflowId: 'douyin-review',
    requiredInputs: [
      { name: 'gmv', description: 'GMV', provided: true },
    ],
  });

// Compact but realistic — every required section title and at
// least one annotation glyph per annotated section. Long enough
// to clear the full-tier word_count threshold (200 chars).
const COMPLETE_REPORT = [
  '# 直播复盘报告',
  '',
  '## ⚠️ 数据校验',
  '所有数据已通过交叉校验。',
  '',
  '## 📊 核心数据',
  '- GMV: ¥100000 🟢',
  '- 订单数: 1250 🟢',
  '- 客单价: ¥80 🟢',
  '- UV: 20000 🟢',
  '- 转化率: 6.25% 🔵 (订单数÷UV)',
  '',
  '## 🔍 问题诊断',
  '主要问题：UV 分布不均 🟢；客单价偏低 🟢；ROI 处于行业平均线 🟡。',
  '',
  '## 💡 优化动作',
  '1. 把主推品 X 从第 3 位上架位调整到第 1 位。',
  '2. 调整千川投放定向到「下单意向」人群。',
  '3. 增加直播话术节奏点位，每 15 分钟提及一次促销节点。',
  '',
  '## ✅ 下场直播 Checklist',
  '- [ ] 开播前 30 分钟完成商品上架顺序调整',
  '- [ ] 主推品话术彩排 3 遍',
  '- [ ] 千川投放计划开播前 2 小时启动',
  '- [ ] 下播后 30 分钟内完成数据填报',
].join('\n');

describe('verifyDeterministic — workflow section_presence + source_annotation (Phase 2 Day 4)', () => {
  it('non-workflow contract: new checks do not trigger', () => {
    // Plain checklist contract (no workflow). Even with a totally
    // unstructured answer, the new checks should not appear in
    // the result.
    const contract = buildContract({
      taskId: 'tsk_no_wf',
      intent: 'translate to english',
      executionMode: 'generate',
    });
    const result = verifyDeterministic({
      contract,
      ledger: new EvidenceLedger('tsk_no_wf'),
      answerText: 'Hello world. ' + 'x'.repeat(60),
      // workflowContract intentionally omitted
    });
    const sectionCheck = result.checks.find(
      (c) => c.criterionId === 'workflow.section_presence',
    );
    const annotationCheck = result.checks.find(
      (c) => c.criterionId === 'workflow.source_annotation',
    );
    expect(sectionCheck).toBeUndefined();
    expect(annotationCheck).toBeUndefined();
    expect(result.passed).toBe(true);
  });

  it('complete report: section_presence + source_annotation both pass', () => {
    const contract = fullTierContract('tsk_wf_ok');
    const ledger = new EvidenceLedger('tsk_wf_ok');
    ledger.add({
      fact: 'GMV=100000, 订单数=1250, 客单价=80',
      sourceType: 'user_input',
      sourceDetail: 'msg',
      confidence: 'observed',
    });
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText: COMPLETE_REPORT,
      workflowContract: DOUYIN_REVIEW_WORKFLOW,
    });
    const sectionCheck = result.checks.find(
      (c) => c.criterionId === 'workflow.section_presence',
    );
    const annotationCheck = result.checks.find(
      (c) => c.criterionId === 'workflow.source_annotation',
    );
    expect(sectionCheck).toBeDefined();
    expect(sectionCheck!.passed).toBe(true);
    expect(annotationCheck).toBeDefined();
    expect(annotationCheck!.passed).toBe(true);
  });

  it('missing required section: section_presence fails as fixable', () => {
    // Drop the "💡 优化动作" section entirely.
    const truncated = COMPLETE_REPORT.replace(
      /## 💡 优化动作[\s\S]*?(?=## ✅)/,
      '',
    );
    const contract = fullTierContract('tsk_wf_missing');
    const ledger = new EvidenceLedger('tsk_wf_missing');
    ledger.add({
      fact: 'GMV=100000, 订单数=1250, 客单价=80',
      sourceType: 'user_input',
      sourceDetail: 'msg',
      confidence: 'observed',
    });
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText: truncated,
      workflowContract: DOUYIN_REVIEW_WORKFLOW,
    });
    const sectionCheck = result.checks.find(
      (c) => c.criterionId === 'workflow.section_presence',
    );
    expect(sectionCheck).toBeDefined();
    expect(sectionCheck!.passed).toBe(false);
    expect(sectionCheck!.detail).toContain('优化动作');
    expect(sectionCheck!.severity).toBe('fixable');
    expect(result.passed).toBe(false);
    expect(result.failureLevel).toBe('fixable');
  });

  it('annotated section without 🟢🔵🟡🔴: source_annotation fails as fixable', () => {
    // Strip all glyphs out of the 核心数据 section while keeping
    // its title intact.
    const stripped = COMPLETE_REPORT.replace(
      /## 📊 核心数据[\s\S]*?(?=## 🔍)/,
      [
        '## 📊 核心数据',
        '- GMV: ¥100000',
        '- 订单数: 1250',
        '- 客单价: ¥80',
        '- UV: 20000',
        '- 转化率: 6.25%',
        '',
        '',
      ].join('\n'),
    );
    const contract = fullTierContract('tsk_wf_unannotated');
    const ledger = new EvidenceLedger('tsk_wf_unannotated');
    ledger.add({
      fact: 'GMV=100000, 订单数=1250, 客单价=80',
      sourceType: 'user_input',
      sourceDetail: 'msg',
      confidence: 'observed',
    });
    const result = verifyDeterministic({
      contract,
      ledger,
      answerText: stripped,
      workflowContract: DOUYIN_REVIEW_WORKFLOW,
    });
    const annotationCheck = result.checks.find(
      (c) => c.criterionId === 'workflow.source_annotation',
    );
    expect(annotationCheck).toBeDefined();
    expect(annotationCheck!.passed).toBe(false);
    expect(annotationCheck!.detail).toContain('核心数据');
    expect(annotationCheck!.severity).toBe('fixable');
    expect(result.failureLevel).toBe('fixable');
  });
});

// ---------------------------------------------------------------------------
// Codex Round 2 P1-4 — extractStructuredItems
// ---------------------------------------------------------------------------

describe('extractStructuredItems — JSON code block path', () => {
  it('parses JSON items[] wrapper with name + numeric price + url', () => {
    const answer = [
      'Here are the top results:',
      '```json',
      JSON.stringify({
        items: [
          { name: 'iPhone 16', price: 6999, url: 'https://item.jd.com/100123.html' },
          { name: 'iPhone 16 Pro', price: 9999, url: 'https://item.jd.com/100456.html' },
        ],
      }),
      '```',
    ].join('\n');
    const items = extractStructuredItems(answer);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      name: 'iPhone 16',
      price: 6999,
      url: 'https://item.jd.com/100123.html',
      source: 'json',
    });
    expect(items[1]!.price).toBe(9999);
  });

  it('parses bare JSON array form', () => {
    const answer = '```json\n[{"name":"A","price":100,"url":"https://x.com/a"}]\n```';
    const items = extractStructuredItems(answer);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'A', price: 100, source: 'json' });
  });

  it('parses ¥-prefixed string price via parsePriceText', () => {
    const answer = '```json\n{"items":[{"name":"X","price":"¥1,299.99","url":"https://x.com/x"}]}\n```';
    const items = extractStructuredItems(answer);
    expect(items[0]!.price).toBeCloseTo(1299.99);
  });

  it('skips non-https url field (treats as missing)', () => {
    const answer = '```json\n{"items":[{"name":"X","price":99,"url":"not-a-url"}]}\n```';
    const items = extractStructuredItems(answer);
    expect(items[0]!.url).toBeNull();
  });

  it('falls through to next strategy when JSON is malformed', () => {
    const answer = [
      '```json',
      '{ this is not valid JSON',
      '```',
      '',
      '| name | price | link |',
      '| --- | --- | --- |',
      '| Phone A | ¥1999 | https://example.com/a |',
    ].join('\n');
    const items = extractStructuredItems(answer);
    expect(items[0]!.source).toBe('table');
    expect(items[0]!.url).toBe('https://example.com/a');
  });
});

describe('extractStructuredItems — markdown table path', () => {
  it('parses cell-position-agnostic table (url + price + name in any column order)', () => {
    const answer = [
      '商品对比：',
      '| 商品 | 价格 | 链接 |',
      '| --- | --- | --- |',
      '| iPhone 16 | ¥6,999 | https://item.jd.com/x.html |',
      '| iPhone 16 Pro | ¥9,999 | https://item.jd.com/y.html |',
    ].join('\n');
    const items = extractStructuredItems(answer);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      name: 'iPhone 16',
      price: 6999,
      url: 'https://item.jd.com/x.html',
      source: 'table',
    });
  });

  it('handles markdown-link cells: [text](url) extracts the inner URL', () => {
    const answer = [
      '| name | url |',
      '| --- | --- |',
      '| Phone | [JD](https://item.jd.com/abc.html) |',
    ].join('\n');
    const items = extractStructuredItems(answer);
    expect(items[0]!.url).toBe('https://item.jd.com/abc.html');
  });
});

describe('extractStructuredItems — numbered list path', () => {
  it('parses "1. name ¥price https://url" lines', () => {
    const answer = [
      '推荐如下：',
      '1. iPhone 16 ¥6999 https://item.jd.com/a.html',
      '2. iPhone 16 Pro ¥9999 https://item.jd.com/b.html',
      '3. iPhone 16 Pro Max ¥12999 https://item.jd.com/c.html',
    ].join('\n');
    const items = extractStructuredItems(answer);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      name: 'iPhone 16',
      price: 6999,
      url: 'https://item.jd.com/a.html',
      source: 'list',
    });
    expect(items[2]!.price).toBe(12999);
  });

  it('keeps name when URL/price absent', () => {
    const answer = '1. iPhone 16 推荐\n2. iPhone 16 Pro 推荐';
    const items = extractStructuredItems(answer);
    expect(items).toHaveLength(2);
    expect(items[0]!.url).toBeNull();
    expect(items[0]!.price).toBeNull();
    expect(items[0]!.name).toBe('iPhone 16 推荐');
  });
});

describe('extractStructuredItems — bullet list (low fidelity)', () => {
  it('treats "- text" as bullet items when nothing else matches', () => {
    const answer = '想法：\n- 第一项\n- 第二项 ¥99\n- 第三项 https://example.com';
    const items = extractStructuredItems(answer);
    expect(items).toHaveLength(3);
    expect(items[0]!.source).toBe('bullet');
    expect(items[1]!.price).toBe(99);
    expect(items[2]!.url).toBe('https://example.com');
  });

  it('returns [] when answer has no recognised structure', () => {
    const answer = '这是一段纯文字回答，没有 JSON 块也没有 列表。';
    const items = extractStructuredItems(answer);
    expect(items).toHaveLength(0);
  });
});

describe('price_sort — only consults parsed items (no prose poisoning)', () => {
  it('ignores price-looking text in prose when items are sorted', () => {
    const contract = buildContract({
      taskId: 'tsk_ps1',
      intent: '推荐 5 个商品按价格升序',
      executionMode: 'generate',
    });
    // The intro mentions ¥10000 — but the items below are correctly
    // sorted ¥100 → ¥200 → ¥300. Pre-P1-4 would have included
    // ¥10000 as the first price and failed the asc check.
    const answer = [
      '建议预算 ¥10000 起。',
      '',
      '| name | price | url |',
      '| --- | --- | --- |',
      '| A | ¥100 | https://a.com |',
      '| B | ¥200 | https://b.com |',
      '| C | ¥300 | https://c.com |',
    ].join('\n');
    const result = verifyDeterministic({
      contract,
      ledger: new EvidenceLedger('tsk_ps1'),
      answerText: answer,
    });
    const sortCheck = result.checks.find((c) => c.criterionType === 'price_sort');
    expect(sortCheck).toBeDefined();
    expect(sortCheck!.passed).toBe(true);
  });

  it('catches reversed ordering in JSON items', () => {
    const contract = buildContract({
      taskId: 'tsk_ps2',
      intent: '前 3 商品按价格升序',
      executionMode: 'generate',
    });
    const answer = [
      '```json',
      JSON.stringify({
        items: [
          { name: 'C', price: 300, url: 'https://c.com' },
          { name: 'B', price: 200, url: 'https://b.com' },
          { name: 'A', price: 100, url: 'https://a.com' },
        ],
      }),
      '```',
    ].join('\n');
    const result = verifyDeterministic({
      contract,
      ledger: new EvidenceLedger('tsk_ps2'),
      answerText: answer,
    });
    const sortCheck = result.checks.find((c) => c.criterionType === 'price_sort');
    expect(sortCheck!.passed).toBe(false);
    expect(sortCheck!.detail).toContain('order broken');
  });
});
