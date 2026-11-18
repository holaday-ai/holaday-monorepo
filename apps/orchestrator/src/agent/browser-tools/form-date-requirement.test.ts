import { describe, expect, it } from 'vitest';
import { asksToFillDateControl } from './browser-completion.js';

describe('date control action requirements', () => {
  it.each([
    '填写 Customer name=Session QA；如果没有日期控件，请如实说明。',
    '只填写姓名。若页面找不到日期输入框，就说明缺少它。',
    '填好姓名；如无日期选择器，请告知。',
    'Fill the name. If the page has no date input, say so.',
    'Fill the name; if there is no date control, please report it.',
  ])('does not invent date work from an absence disclosure: %s', (intent) => {
    expect(asksToFillDateControl(intent)).toBe(false);
  });
  it.each([
    '填写表单与日期控件，只填不提交并截图',
    '填写日期输入框；如果没有日期控件，请如实说明。',
    '如果没有日期控件，请如实说明；仍需要在允许站点寻找日期选择器。',
    'Fill the date picker; if there is no date input, please report it.',
    'If the page has no date input, go to another permitted page with a date control.',
  ])('preserves a separate explicit requirement: %s', (intent) => {
    expect(asksToFillDateControl(intent)).toBe(true);
  });
});
