import { expect, it } from 'vitest';
import { verifyDeterministic } from './answer-verifier.js';
import { EvidenceLedger } from './evidence-ledger.js';
import { buildContract } from './execution-contract.js';

it.each([
  [{ tool: 'type', form: { ref: 'e1', filled: true, submitted: false } }, true],
  [{ tool: 'type', form: { ref: 'e1', filled: true, submitted: true } }, false],
  [{ tool: 'submit', form: { filled: true, submitted: false } }, false],
  [{ tool: 'type', form: { submitted: 'false' } }, false],
  ['form_submit fired on /search', false],
] as const)('uses the actual form submission value: %j', (fact, allowed) => {
  const contract = buildContract({
    taskId: 'constraint',
    intent: '只填表不提交',
    executionMode: 'browser',
    targetDomain: 'example.com',
    // User-stated (no longer a default since BROWSER-AUTOPILOT-1).
    constraints: ['no_form_submit'],
  });
  const ledger = new EvidenceLedger('constraint');
  ledger.add({
    fact: typeof fact === 'string' ? fact : JSON.stringify(fact),
    sourceType: 'browser_state',
    sourceDetail: 'browser_tool_receipt',
    confidence: 'observed',
  });
  const result = verifyDeterministic({
    contract,
    ledger,
    answerText: '表单字段已填写，未提交。',
    finalUrl: 'https://example.com/',
  });
  expect(result.checks.find((c) => c.criterionId === 'generic.constraints')?.passed).toBe(allowed);
});
