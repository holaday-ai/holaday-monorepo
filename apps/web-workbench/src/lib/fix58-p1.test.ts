/** FIX-58 P1-5 · the failure turn's fixed line follows the task language. */
import { describe, expect, it } from 'vitest';
import { optionsHeader } from './assistant-turn';

describe('FIX-58 P1-5 · 「我可以这样继续：」', () => {
  it.each([
    ['USB C cable price on Amazon Singapore', "Here's what I can do:"],
    ['亚马逊新加坡站 USB C 线价格', '我可以这样继续：'],
  ])('%s', (intent, header) => expect(optionsHeader(intent)).toBe(header));
});
