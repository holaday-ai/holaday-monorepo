import { describe, expect, it } from 'vitest';
import { weeklyHoroscopeSections } from './horoscope-content';

describe('horoscope content', () => {
  it('maps only provider-backed weekly fields into readable sections', () => {
    const sections = weeklyHoroscopeSections({
      weekLabel: '8月10日 - 8月16日',
      personal: '关系提示',
      health: '身心提示',
      profession: '工作提示',
      emotions: '情绪提示',
      travel: '出行提示',
      luck: '好运提示',
      luckyColors: ['#FFB86B'],
    });

    expect(sections.map((section) => section.label)).toEqual([
      '工作',
      '人际',
      '身心',
      '情绪',
      '出行',
      '好运',
    ]);
    expect(JSON.stringify(sections)).not.toMatch(/月亮|上升|流年|natal|transit/i);
  });
});
