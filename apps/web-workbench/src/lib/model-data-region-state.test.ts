import { describe, expect, it } from 'vitest';
import { MODEL_DATA_REGION_COPY, modelTaskSubmitDecision } from './model-data-region-state';

describe('model data region state', () => {
  it.each([
    ['cn', 'submit'],
    ['intl', 'submit'],
    [null, 'choose_region'],
    [undefined, 'choose_region'],
    ['unknown', 'choose_region'],
  ] as const)('with the selection on, maps %s to %s', (region, expected) => {
    expect(modelTaskSubmitDecision(region, true)).toBe(expected);
  });

  it.each([['cn'], ['intl'], [null], [undefined], ['unknown']] as const)(
    'FIX-60 BOSS 决定: with the selection off (the default), %s submits',
    (region) => {
      expect(modelTaskSubmitDecision(region)).toBe('submit');
      expect(modelTaskSubmitDecision(region, false)).toBe('submit');
    },
  );

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
