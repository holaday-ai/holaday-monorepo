import { describe, it, expect } from 'vitest';
import {
  pickImageModel,
  DEFAULT_FLASH_MODEL,
  DEFAULT_PRO_MODEL,
} from './model-router.js';

describe('pickImageModel', () => {
  it('defaults to NB2 flash for a plain text-to-image ask', () => {
    const d = pickImageModel('画一只在草地上的橘猫');
    expect(d.tier).toBe('flash');
    expect(d.model).toBe(DEFAULT_FLASH_MODEL);
    expect(d.resolution).toBeUndefined();
  });

  it('routes poster requests to Pro', () => {
    const d = pickImageModel('帮我做一张双十一促销海报');
    expect(d.tier).toBe('pro');
    expect(d.model).toBe(DEFAULT_PRO_MODEL);
  });

  it('routes embedded-text requests to Pro', () => {
    const d = pickImageModel('生成一张配图，上面要有"夏日特惠"几个字');
    expect(d.tier).toBe('pro');
  });

  it('routes English poster/text asks to Pro', () => {
    expect(pickImageModel('design a poster with bold text').tier).toBe('pro');
    expect(pickImageModel('a logo with the brand name').tier).toBe('pro');
  });

  it('routes 4K/超清 asks to Pro (no explicit resolution in v1)', () => {
    const d = pickImageModel('做一张4K高清的电影海报');
    expect(d.tier).toBe('pro');
    expect(d.resolution).toBeUndefined();
  });

  it('routes 2K/高清 asks to Pro (no explicit resolution in v1)', () => {
    const d = pickImageModel('2K 高清封面');
    expect(d.tier).toBe('pro');
    expect(d.resolution).toBeUndefined();
  });

  it('does not force resolution for a plain Pro hint without a res demand', () => {
    const d = pickImageModel('设计一张杂志封面');
    expect(d.tier).toBe('pro');
    expect(d.resolution).toBeUndefined();
  });

  it('honours injected model ids', () => {
    const flash = pickImageModel('画只猫', { flashModel: 'nb2-custom' });
    expect(flash.model).toBe('nb2-custom');
    const pro = pickImageModel('海报', { proModel: 'nbpro-custom' });
    expect(pro.model).toBe('nbpro-custom');
  });
});
