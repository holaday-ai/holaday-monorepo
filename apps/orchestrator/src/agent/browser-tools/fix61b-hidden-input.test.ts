import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { asksToFillForm } from './browser-completion.js';
import { HIDDEN_VALUE_NOTE, withHiddenValueNote } from './unified-browser-loop.js';
import { humanTypedFieldNames } from './unified-supercar-runner.js';

/**
 * FIX-61B P1-6 (Deploy-61 单列 5): a box the user typed into is hidden from the assistant — it is
 * not empty, and a read-only answer saying 「没有填写」 is no claim of a filled form.
 */
describe('FIX-61B P1-6: a hidden user input is not empty', () => {
  it('the online follow-up is no request to fill (its 「没有填写」 is not refused)', () => {
    expect(
      asksToFillForm(
        '请使用云端浏览器，打开 https://httpbin.org/forms/post ，只打开，不要填写\n读一下当前页面表单里 Customer name 输入框现在填的是什么，只读不改',
      ),
    ).toBe(false);
    expect(asksToFillForm("open the form but don't fill it in")).toBe(false);
    expect(asksToFillForm('无需填写，只看表单有哪些字段')).toBe(false);
  });

  it('a real request to fill still needs a fill receipt', () => {
    expect(
      asksToFillForm(
        '请使用云端浏览器，httpbin.org/forms/post 或 the-internet.herokuapp.com 填表单与日期控件，只填不提交并截图',
      ),
    ).toBe(true);
    expect(asksToFillForm('帮我在这个页面填写姓名和电话')).toBe(true);
    expect(asksToFillForm('please fill the form with my name')).toBe(true);
  });

  it('a read showing a masked value says what it is', () => {
    const read = '- textbox "Customer name:": [REDACTED]\n- textbox "Telephone:"';
    expect(withHiddenValueNote(read)).toBe(`${read}\n${HIDDEN_VALUE_NOTE}`);
    expect(withHiddenValueNote('- textbox "Telephone:"')).toBe('- textbox "Telephone:"');
  });

  it('the boxes the person typed into are named — never their text (real Chromium)', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(
        '<label for="c">Customer name:</label><input id="c" data-hd-human-typed value="MASKCHECK7">' +
          '<input placeholder="Telephone">',
      );
      const names = await humanTypedFieldNames(page);
      expect(names).toEqual(['Customer name']);
      expect(names.join(' ')).not.toContain('MASKCHECK7');
    } finally {
      await browser.close();
    }
  });
});
