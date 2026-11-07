/** Offline, no model or remote I/O: exercise the real blocker on fixed HTML. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { probeBrowserBlocker } from '../src/agent/browser-tools/browser-blocker-probe.js';
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const cases = JSON.parse(
  readFileSync(here('./browser-eval/blocker-audit-corpus.json'), 'utf8'),
) as Array<{
  id: string;
  html: string;
  url: string;
  intent: string;
  expected: string;
  reason: string;
}>;
const browser = await chromium.launch({ headless: true });
const rows = [];
try {
  for (const c of cases) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      const html = readFileSync(here(`./browser-eval/blocker-fixtures/${c.html}.html`), 'utf8');
      await page.route('**/*', (r) =>
        r.request().frame() === page.mainFrame() && r.request().url() === c.url
          ? r.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
          : r.request().isNavigationRequest()
            ? r.fulfill({
                contentType: 'text/html; charset=utf-8',
                body: '<h1>Please sign in to continue</h1><input type="password">',
              })
            : r.abort(),
      );
      await page.goto(c.url);
      const hit = await probeBrowserBlocker(page, c.intent);
      const actual = !hit
        ? 'clear'
        : 'disposition' in hit && hit.disposition === 'continue'
          ? 'continue'
          : 'pause';
      rows.push({
        ...c,
        actual,
        observedReason: hit ? hit.message : '未发现阻断当前任务的可见登录或验证墙',
        pass: actual === c.expected,
        decision: hit,
      });
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
console.log('| 样本 | 期望 | 判定 | 预期依据 | 实际理由 | 结果 |');
console.log('|---|---|---|---|---|---|');
for (const r of rows)
  console.log(
    `| ${r.id} | ${r.expected} | ${r.actual} | ${r.reason} | ${r.observedReason} | ${r.pass ? 'PASS' : 'FAIL'} |`,
  );
console.log(`${rows.filter((r) => r.pass).length}/${rows.length} passed; network/model calls: 0`);
const jsonArg = process.argv.indexOf('--json');
if (jsonArg > 0 && process.argv[jsonArg + 1])
  writeFileSync(process.argv[jsonArg + 1]!, `${JSON.stringify(rows, null, 2)}\n`);
if (rows.some((r) => !r.pass)) process.exitCode = 1;
