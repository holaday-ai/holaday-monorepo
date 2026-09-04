import { describe, expect, it } from 'vitest';
import { MODEL_DATA_REGION_COPY, modelTaskSubmitDecision } from './model-data-region-state';

describe('model data region state', () => {
  it.each([
    ['cn', 'submit'],
    ['intl', 'submit'],
    [null, 'choose_region'],
    [undefined, 'choose_region'],
    ['unknown', 'choose_region'],
  ] as const)('maps %s to %s', (region, expected) => {
    expect(modelTaskSubmitDecision(region)).toBe(expected);
  });

  it('keeps the approved region labels and processing explanations exact', () => {
    expect(MODEL_DATA_REGION_COPY).toEqual({
      cn: {
        label: '中国大陆',
        description: '任务内容由中国大陆区域的千问服务处理。',
      },
      intl: {
        label: '国际',
        description: '任务内容由新加坡区域的千问服务处理。',
      },
    });
  });
});
