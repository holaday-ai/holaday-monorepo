/**
 * Start-page reachability for the browser eval (no model calls, no keys):
 * opens every task's start URL in the same managed headless browser the eval
 * uses and records status / title / login-wall or bot-wall signals, so eval
 * failures can be attributed to the site rather than the model or tools.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PlaywrightExecutor } from '../../src/agent/vision-loop/playwright-executor.js';
import type { BrowserEvalTask } from './score.js';

const suite = JSON.parse(readFileSync(new URL('./tasks.json', import.meta.url), 'utf8')) as {
  tasks: BrowserEvalTask[];
};
const LOGIN_RE = /登录|登陆|扫码|sign ?in|log ?in/i;
const BOT_RE =
  /验证码|安全验证|人机|captcha|verify you are human|access denied|unusual traffic|blocked|403 forbidden|cloudflare/i;

const rows = ['id,category,status,httpStatus,ms,loginWall,botWall,title'];
const executor = new PlaywrightExecutor();
const launched = await executor.launchManaged({ headless: true });
if (!launched.ok) throw new Error('browser launch failed');
try {
  for (const task of suite.tasks) {
    const started = Date.now();
    let status = 'ok';
    let httpStatus = 0;
    let title = '';
    let text = '';
    try {
      await executor.resetPageForTask().catch(() => {});
      const page = await executor.getPage();
      const response = await page.goto(task.startUrl, {
        timeout: 30_000,
        waitUntil: 'domcontentloaded',
      });
      httpStatus = response?.status() ?? 0;
      await page.waitForTimeout(1_500);
      title = (await page.title()).replace(/[\n,]/g, ' ').slice(0, 60);
      text = (
        await page
          .locator('body')
          .innerText({ timeout: 5_000 })
          .catch(() => '')
      ).slice(0, 4_000);
    } catch (error) {
      status = `error:${error instanceof Error ? error.name : 'unknown'}`;
    }
    const row = [
      task.id,
      task.category,
      status,
      httpStatus,
      Date.now() - started,
      LOGIN_RE.test(text) || LOGIN_RE.test(title),
      BOT_RE.test(text) || BOT_RE.test(title) || httpStatus === 403,
      JSON.stringify(title),
    ].join(',');
    rows.push(row);
    process.stdout.write(`${row}\n`);
  }
} finally {
  await executor.disconnect().catch(() => {});
}
mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(new URL('./results/reachability.csv', import.meta.url), `${rows.join('\n')}\n`);
