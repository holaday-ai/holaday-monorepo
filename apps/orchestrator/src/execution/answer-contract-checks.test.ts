/**
 * REBUILD-3: an answer the price contract checked and rendered skips the ecommerce row check
 * over its text (the contract replaces it); every other criterion stays. Unmarked tasks keep all.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { markAnswerContract } from '../agent/answer-contract/handled.js';
import type { ExecutionContract } from './execution-contract.js';
import {
  _resetExecutionPipelineForTest,
  contractChecks,
  disposeExecution,
} from './execution-pipeline.js';

const contract = {
  taskId: 'tsk_price',
  successCriteria: [
    { id: 'rows', type: 'ecommerce_rows' },
    { id: 'sort', type: 'price_sort' },
    { id: 'count', type: 'result_count' },
  ],
} as unknown as ExecutionContract;

afterEach(() => _resetExecutionPipelineForTest());

describe('REBUILD-3 contract checks', () => {
  it('a price-contract answer drops only the ecommerce row check', () => {
    markAnswerContract('tsk_price', 'price');
    expect(contractChecks('tsk_price', contract).successCriteria.map((c) => c.id)).toEqual([
      'sort',
      'count',
    ]);
    expect(contract.successCriteria).toHaveLength(3);
  });

  it('other tasks keep every criterion; disposal forgets the mark', () => {
    expect(contractChecks('tsk_other', contract)).toBe(contract);
    markAnswerContract('tsk_price', 'price');
    disposeExecution('tsk_price');
    expect(contractChecks('tsk_price', contract)).toBe(contract);
  });
});
