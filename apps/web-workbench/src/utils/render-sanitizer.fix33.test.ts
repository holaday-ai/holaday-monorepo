import { describe, expect, it } from 'vitest';
import { sanitizeForRender } from './render-sanitizer';

describe('FIX-33 · the task view never shows tool-call syntax as text', () => {
  it('strips the new-bestbuy pseudo tool call, keeps the sentence', () => {
    const raw =
      '我来帮你在 BestBuy 搜索 usb c cable。\n\n<li_call>\n<function>browser_use</function>\n<arguments>\n{"action": "navigate", "url": ""}</arguments>\n</li_call>';
    expect(sanitizeForRender(raw)).toBe('我来帮你在 BestBuy 搜索 usb c cable。');
  });
  it('leaves code the user asked about alone', () => {
    const raw = '写法如下：\n```xml\n<function>browser_use</function>\n```\n`<arguments>` 放参数。';
    expect(sanitizeForRender(raw)).toBe(raw);
  });
});
