/**
 * Browser reachability diagnostic. Run on the box that hosts the headless
 * Chromium orchestrator talks to (VULTR prod, or a local dev machine).
 *
 * Reproduces production's connect path: connectOverCDP → getPage →
 * page.goto(<target>). Prints the full browser state (every context,
 * every page, every URL) before and after the goto so we can tell:
 *
 *   - whether multiple chromiums are fighting for 9222 (stray pages
 *     we didn't create),
 *   - whether goto resolves but stays on about:blank (renderer blocked),
 *   - whether goto throws with a DNS / TLS / timeout error (network
 *     sandbox issue).
 *
 * Usage:
 *   CDP_ENDPOINT=http://127.0.0.1:9222 \
 *     tsx apps/orchestrator/scripts/diagnose-browser.ts https://example.com
 */
import { chromium, type Browser } from 'playwright';

const CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const TARGET_URL = process.argv[2] ?? 'https://example.com';
const NAV_TIMEOUT_MS = 15_000;

async function dumpBrowserState(label: string, browser: Browser): Promise<void> {
  const contexts = browser.contexts();
  console.log(`\n[${label}] ${contexts.length} context(s):`);
  for (let i = 0; i < contexts.length; i += 1) {
    const pages = contexts[i].pages();
    console.log(`  context[${i}] — ${pages.length} page(s):`);
    for (const p of pages) {
      let title = '';
      try {
        title = await p.title();
      } catch (err) {
        title = `<title() failed: ${err instanceof Error ? err.message : String(err)}>`;
      }
      console.log(`    - url=${p.url()} title=${JSON.stringify(title)}`);
    }
  }
}

async function main(): Promise<void> {
  console.log(`CDP endpoint: ${CDP_ENDPOINT}`);
  console.log(`target URL:   ${TARGET_URL}`);

  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  } catch (err) {
    console.error(`connectOverCDP failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  await dumpBrowserState('before', browser);

  const ctx = browser.contexts()[0];
  if (!ctx) {
    console.error('no contexts — is the browser actually running?');
    process.exit(3);
  }

  // Production's getPage reuses pages[0]; in diagnostic we want an
  // isolated fresh page so we're not debugging whatever neko / another
  // tenant left around. Open a new one, run goto there, measure.
  console.log('\nopening fresh page via ctx.newPage()…');
  const page = await ctx.newPage();
  console.log(`new page url: ${page.url()}`);

  const started = Date.now();
  let gotoErr: string | null = null;
  let response = null;
  try {
    response = await page.goto(TARGET_URL, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });
  } catch (err) {
    gotoErr = err instanceof Error ? err.message : String(err);
  }
  const elapsed = Date.now() - started;

  console.log(`\ngoto result — elapsed ${elapsed}ms`);
  if (gotoErr) {
    console.log(`  ERROR: ${gotoErr}`);
  } else if (response) {
    console.log(`  HTTP ${response.status()} ${response.statusText()}`);
    console.log(`  final URL: ${page.url()}`);
    try {
      console.log(`  title: ${JSON.stringify(await page.title())}`);
    } catch (err) {
      console.log(`  title(): ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      const bodyLen = await page.evaluate(() => document.body?.innerText?.length ?? 0);
      console.log(`  document.body.innerText.length: ${bodyLen}`);
    } catch (err) {
      console.log(`  innerText probe failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    console.log(`  null response (navigation cancelled?) — final URL: ${page.url()}`);
  }

  await dumpBrowserState('after', browser);

  try {
    await page.close();
  } catch {
    /* ignore */
  }
  try {
    await browser.close();
  } catch {
    /* ignore */
  }

  if (gotoErr) process.exit(1);
  if (!response || response.status() >= 400) process.exit(1);
  if (page.url() === 'about:blank') {
    console.error('\nFAILURE: navigation reported success but page stayed at about:blank');
    process.exit(1);
  }
  console.log('\nOK — browser reached the target and rendered content');
}

main().catch((err) => {
  console.error('unhandled:', err);
  process.exit(4);
});
