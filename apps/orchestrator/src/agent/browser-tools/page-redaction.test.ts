import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REDACTION_FAILED_COPY, SENSITIVE_VALUES_EXPRESSION } from './page-redaction.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';

const LOGIN_PAGE = `
  <label>账号 <input name="user" value="alice@example.com" /></label>
  <label>密码 <input type="password" value="hunter2!pw" /></label>
  <label>短信验证码 <input name="sms" value="834921" /></label>
  <input placeholder="请输入登录密码" value="plainpw-777" />
  <input autocomplete="one-time-code" aria-label="code" value="551177" />
  <p>欢迎回来</p>`;

describe('cloud executor redaction (unified executor, real Chromium)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it('masks password, OTP and placeholder-"密码" fields in snapshot and extract', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(LOGIN_PAGE);
      const tools = createPlaywrightUnifiedExecutor(page, { actionTimeoutMs: 2_000 });
      const snapshot = await tools.execute({ tool: 'snapshot' });
      expect(snapshot.ok).toBe(true);
      for (const secret of ['hunter2!pw', '834921', 'plainpw-777', '551177'])
        expect(snapshot.text).not.toContain(secret);
      expect(snapshot.text).toContain('[REDACTED]');
      // Ordinary fields stay readable for the model.
      expect(snapshot.text).toContain('alice@example.com');
      expect(snapshot.text).toContain('欢迎回来');

      await page.evaluate(() => {
        document.body.insertAdjacentHTML('beforeend', '<p>回显 hunter2!pw</p>');
      });
      const extracted = await tools.execute({ tool: 'extract', instruction: 'all' });
      expect(extracted.ok).toBe(true);
      expect(extracted.text).not.toContain('hunter2!pw');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('redacts before truncating, so a cut cannot expose part of a secret', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(
        `<label>密码 <input type="password" value="longsecret-abcdef" /></label>`,
      );
      // Cut the raw tree in the middle of the secret: truncating first would leak a prefix.
      const raw = await page.locator('body').ariaSnapshot({ mode: 'ai' });
      const at = raw.indexOf('longsecret');
      expect(at).toBeGreaterThan(0);
      const tools = createPlaywrightUnifiedExecutor(page, { maxSnapshotChars: at + 5 });
      const text = (await tools.execute({ tool: 'snapshot' })).text;
      expect(text).not.toContain('longs');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('fails closed when the page cannot be inspected', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(LOGIN_PAGE);
      const broken = new Proxy(page, {
        get(target, prop, receiver) {
          if (prop === 'evaluate') return async () => Promise.reject(new Error('detached'));
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const result = await createPlaywrightUnifiedExecutor(broken).execute({ tool: 'snapshot' });
      expect(result).toEqual({ ok: false, text: REDACTION_FAILED_COPY });
    } finally {
      await page.close();
    }
  }, 60_000);

  it('the in-page expression survives runtimes that inject __name helpers', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(LOGIN_PAGE);
      const injected = SENSITIVE_VALUES_EXPRESSION.replace(
        'return (',
        'return (__name(() => 0, "probe"), ',
      );
      expect(await page.evaluate(injected)).toEqual(
        expect.arrayContaining(['hunter2!pw', '834921', 'plainpw-777', '551177']),
      );
    } finally {
      await page.close();
    }
  }, 60_000);
});
