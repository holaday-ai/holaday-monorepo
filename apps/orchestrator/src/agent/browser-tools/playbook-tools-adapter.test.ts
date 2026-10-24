import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { playbookToolsFromUnifiedExecutor } from './playbook-tools-adapter.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';

describe('batch 06 replay tools over the batch 04 unified executor', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it('parses refs and input types, acts by ref, and throws on failure for local repair', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(
        '<label>邮箱 <input type="email" /></label><label>密码 <input type="password" /></label><button onclick="this.textContent=\'已提交\'">提交</button>',
      );
      const tools = playbookToolsFromUnifiedExecutor(
        page,
        createPlaywrightUnifiedExecutor(page, { actionTimeoutMs: 1_000 }).execute,
      );
      const snapshot = await tools.snapshot();
      const email = snapshot.elements.find((element) => element.name === '邮箱');
      const password = snapshot.elements.find((element) => element.name === '密码');
      const button = snapshot.elements.find((element) => element.role === 'button');
      expect(email?.inputType).toBe('email');
      expect(password?.inputType).toBe('password');
      await tools.type(email?.ref as string, 'a@example.com');
      await tools.click(button?.ref as string);
      await tools.wait_for({ text: '已提交' });
      await expect(tools.click('e9999')).rejects.toThrow(/snapshot/);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('uploads replay file paths directly instead of treating them as attachment ids', async () => {
    const page = await browser.newPage();
    const dir = await mkdtemp(join(tmpdir(), 'replay-upload-'));
    try {
      const file = join(dir, 'report.txt');
      await writeFile(file, 'hello');
      await page.setContent('<label>附件 <input type="file" /></label>');
      const tools = playbookToolsFromUnifiedExecutor(
        page,
        // No resolveUploads: the unified executor alone could not upload.
        createPlaywrightUnifiedExecutor(page, { actionTimeoutMs: 1_000 }).execute,
      );
      const snapshot = await tools.snapshot();
      const input = snapshot.elements.find((element) => element.name === '附件');
      await tools.upload(input?.ref as string, [file]);
      expect(await page.locator('input[type=file]').inputValue()).toMatch(/report\.txt$/);
      await expect(tools.upload('e9999', [file])).rejects.toThrow(/snapshot/);
      await expect(tools.upload(input?.ref as string, [])).rejects.toThrow();
    } finally {
      await page.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
