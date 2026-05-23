import { describe, expect, it } from 'vitest';
import { learningEmptyCopy } from './admin-learning-copy';

describe('learningEmptyCopy', () => {
  it('uses a neutral empty message for the all filter', () => {
    expect(learningEmptyCopy({ search: '', filter: 'all' })).toBe(
      '暂无域名执行数据',
    );
  });

  it('keeps filter-specific messages for targeted empty states', () => {
    expect(learningEmptyCopy({ search: '', filter: 'highRisk' })).toContain(
      '无高风险域名',
    );
    expect(learningEmptyCopy({ search: '', filter: 'recentFail' })).toBe(
      '本周无失败任务',
    );
  });

  it('prioritizes search miss copy', () => {
    expect(learningEmptyCopy({ search: 'example', filter: 'recentFail' })).toBe(
      '没有匹配的域名',
    );
  });
});
