import { describe, expect, it } from 'vitest';

import { assessGeneralTaskIntake } from './general-task-intake.js';

describe('assessGeneralTaskIntake', () => {
  it('asks for a delivery location before a same-day shopping task starts', () => {
    expect(assessGeneralTaskIntake('帮我找最便宜、评分最高而且今天送达的咖啡机')).toEqual(
      expect.objectContaining({
        kind: 'missing_input',
        field: 'delivery_location',
      }),
    );
  });

  it('asks which product to compare instead of browsing a placeholder request', () => {
    expect(assessGeneralTaskIntake('对比三家平台的某商品价格并总结最优选')).toEqual(
      expect.objectContaining({
        kind: 'missing_input',
        field: 'product',
      }),
    );
  });

  it('does not block a concrete same-day request that includes a city', () => {
    expect(
      assessGeneralTaskIntake('在上海找今天送达的 iPhone 16，按到手价排序给前 5 个'),
    ).toBeNull();
  });

  it('does not interfere with ordinary research tasks', () => {
    expect(assessGeneralTaskIntake('研究 2026 年 AI 行业趋势并给来源')).toBeNull();
  });
});
