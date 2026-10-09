import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyGeometry,
  measurePage,
  pixelDifference,
  taskStateFindings,
} from './lib/checks.mjs';
import { inspectControls } from './lib/interaction.mjs';
import { canonicalUrl, inventory, scenarioSlug, writeInventory } from './lib/inventory.mjs';
import { isPopupNavigation } from './lib/network.mjs';
import { saveReport } from './lib/report.mjs';
import { SEED_VERSION } from './lib/seed.mjs';
import { startSeedServer } from './lib/server.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(
  process.env.UI_AUDIT_APP_DIR ?? path.join(root, '../apps/web-workbench'),
);
const out = path.resolve(process.env.UI_AUDIT_OUTPUT ?? root);
const artifacts = path.join(out, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const args = new Set(process.argv.slice(2));
const bootstrap = args.has('--update-baseline');
const screenOnly = args.has('--screens-only');
const require = createRequire(path.join(appDir, 'package.json'));
const { chromium } = require('playwright');
const coreRoot = path.dirname(
  createRequire(require.resolve('playwright')).resolve('playwright-core/package.json'),
);
const { PNG } = require(path.join(coreRoot, 'lib/utilsBundle.js'));
const candidate = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: appDir,
  encoding: 'utf8',
}).stdout.trim();
function treeHash() {
  const hash = createHash('sha256');
  function walk(dir) {
    for (const e of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        hash.update(path.relative(appDir, p));
        hash.update(fs.readFileSync(p));
      }
    }
  }
  walk(path.join(appDir, 'src'));
  for (const f of ['package.json', 'vite.config.ts', 'tailwind.config.ts', 'index.html']) {
    const p = path.join(appDir, f);
    if (fs.existsSync(p)) hash.update(fs.readFileSync(p));
  }
  return hash.digest('hex');
}
function suiteHash() {
  const hash = createHash('sha256');
  for (const file of [
    fileURLToPath(import.meta.url),
    ...fs
      .readdirSync(path.join(root, 'lib'))
      .filter((name) => name.endsWith('.mjs'))
      .sort()
      .map((name) => path.join(root, 'lib', name)),
  ])
    hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}
const report = {
  schemaVersion: 1,
  candidate,
  sourceHash: treeHash(),
  suiteSourceHash: suiteHash(),
  seed: SEED_VERSION,
  startedAt: new Date().toISOString(),
  mode: bootstrap ? 'baseline-create' : 'verify',
  screenOnly,
  findings: [],
  coverageGaps: [],
  pages: [],
  seedContracts: [],
  networkWhitelist: [
    {
      rule: '403 /api/trpc/videoEditing.getProject on /video/edit/:projectId',
      reason:
        'Actual backend default-off contract: FORBIDDEN; no license or remote SDK is provisioned',
    },
    {
      rule: 'synthetic external popup landing',
      reason:
        'URL navigation tested through local HTML interception; third-party availability is not tested',
    },
    {
      rule: 'exact five brand PNG assets',
      reason: 'offline SVG placeholder preserves box geometry; logo pixel fidelity is excluded',
    },
  ],
};
let server;
let browser;
try {
  const envFiles = fs
    .readdirSync(appDir)
    .filter((n) => n === '.env' || (n.startsWith('.env.') && !n.endsWith('.example')));
  if (envFiles.length)
    throw Error('LOCAL_ENV_PRESENT: use a clean candidate checkout without environment files');
  const data = inventory(appDir);
  writeInventory(data, out);
  if (!args.has('--skip-build')) {
    const log = fs.openSync(path.join(artifacts, 'build.log'), 'w');
    const result = spawnSync(
      process.execPath,
      [
        path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'),
        'build',
        '--config',
        'vite.config.ts',
      ],
      {
        cwd: appDir,
        env: {
          PATH: process.env.PATH,
          NODE_OPTIONS: '--max-old-space-size=1536 --v8-pool-size=1',
          UV_THREADPOOL_SIZE: '1',
          GOMAXPROCS: '1',
        },
        stdio: ['ignore', log, log],
      },
    );
    fs.closeSync(log);
    if (result.status !== 0) throw Error('CANDIDATE_BUILD_FAILED: artifacts/build.log');
    fs.writeFileSync(
      path.join(appDir, 'dist/ui-audit-build.json'),
      JSON.stringify({ candidate, sourceHash: report.sourceHash }),
    );
  }
  const build = JSON.parse(fs.readFileSync(path.join(appDir, 'dist/ui-audit-build.json'), 'utf8'));
  if (build.candidate !== candidate || build.sourceHash !== report.sourceHash)
    throw Error('STALE_CANDIDATE_BUILD');
  report.buildHash = createHash('sha256')
    .update(fs.readFileSync(path.join(appDir, 'dist/index.html')))
    .digest('hex');
  server = await startSeedServer(appDir);
  browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  report.browserVersion = browser.version();
  report.platform = process.platform;
  const selected = process.env.UI_AUDIT_ROUTES ? JSON.parse(process.env.UI_AUDIT_ROUTES) : null;
  const routes = data.routes.filter((r) => !selected || selected.includes(r.pattern));
  if (selected?.some((r) => !data.routes.some((x) => x.pattern === r)))
    throw Error('UNKNOWN_ROUTE_FILTER');
  const widths = process.env.UI_AUDIT_WIDTHS
    ? JSON.parse(process.env.UI_AUDIT_WIDTHS)
    : [1440, 1280, 1024];
  if (widths.some((w) => ![1440, 1280, 1024].includes(w))) throw Error('UNSUPPORTED_WIDTH');
  if (selected || widths.length !== 3)
    report.coverageGaps.push('Filtered run: not full release acceptance');
  if (screenOnly) report.coverageGaps.push('Screens-only exploration: controls not exercised');
  const taskScenarios = ['generate', 'browser', 'scrape', 'image'].flatMap((mode) =>
    ['executing', 'completed', 'failed', 'awaiting_user', 'cancelled'].map((status) => ({
      pattern: `task:${mode}:${status}`,
      path: `/?task=tsk_ui_${mode}_${status}`,
      component: 'WorkbenchApp',
      status,
      taskMode: mode,
    })),
  );
  const allScenarios = [...(!selected ? taskScenarios : []), ...routes];
  const cases = process.env.UI_AUDIT_CASES ? JSON.parse(process.env.UI_AUDIT_CASES) : null;
  if (cases?.some((value) => !allScenarios.some((s) => s.pattern === value)))
    throw Error('UNKNOWN_CASE_FILTER');
  if (cases) report.coverageGaps.push('Case-filtered run: not full release acceptance');
  report.selectedCases = cases;
  report.selectedWidths = widths;
  const scenarios = cases ? allScenarios.filter((s) => cases.includes(s.pattern)) : allScenarios;
  report.expectedPages = scenarios.length * widths.length;
  for (const width of widths) {
    const shared = new Map();
    const canonical = new Map();
    for (const scenario of scenarios) {
      const id = `${width}-${scenarioSlug(scenario.pattern)}`;
      const screenshot = path.join('artifacts', `${id}.png`);
      const entry = {
        route: scenario.pattern,
        path: scenario.path,
        width,
        controls: [],
        screenshot,
        issues: [],
      };
      const context = await browser.newContext({
        viewport: { width, height: 960 },
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        colorScheme: 'light',
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
        permissions: ['clipboard-read', 'clipboard-write'],
      });
      await context.routeWebSocket(
        (url) => url.protocol !== 'ws:' || url.host !== new URL(server.origin).host,
        (socket) => {
          entry.issues.push({
            rule: 'external-websocket-blocked',
            severity: 'P1',
            detail: new URL(socket.url()).origin,
          });
          socket.close({ code: 1008, reason: 'Local audit permits only its own seed websocket' });
        },
      );
      const publicRoute = [
        '/login',
        '/register',
        '/privacy',
        '/terms',
        '/500',
        '/account/closure-recovery',
      ].includes(scenario.path);
      await context.addInitScript(
        ({ authed }) => {
          if (authed) localStorage.setItem('holaday.access_token', 'ui-local-seed');
          if (location.pathname === '/account/closure-recovery')
            sessionStorage.setItem('holaday.closure_recovery', 'local-recovery-only');
          localStorage.setItem('holaday-theme', 'light');
          let randomState = 123456789;
          Math.random = () => {
            randomState = (1664525 * randomState + 1013904223) >>> 0;
            return randomState / 4294967296;
          };
        },
        { authed: !publicRoute },
      );
      await context.route('**/*', (route) =>
        (async () => {
          const req = route.request();
          const u = new URL(req.url());
          if (u.origin === server.origin || ['data:', 'blob:'].includes(u.protocol))
            return route.continue();
          if (
            u.origin === 'https://assets.holaday.ai' &&
            /^\/logo\/(?:HD-logo-black|HD-logo-white|HD-single-logo|HOLA-DAY-text-black|HOLA-DAY-text-white)\.png$/.test(
              u.pathname,
            )
          )
            return route.fulfill({
              status: 200,
              contentType: 'image/svg+xml',
              body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><rect width="40" height="40" rx="8" fill="#FF0061"/><text x="7" y="27" fill="white" font-size="20">HD</text><text x="48" y="27" font-size="20">HOLA DAY</text></svg>',
            });
          if (isPopupNavigation(req, page))
            return route.fulfill({
              status: 200,
              contentType: 'text/html',
              body: '<!doctype html><title>Local external target fixture</title><p>Target navigation reached.</p>',
            });
          entry.issues.push({
            rule: 'external-network-attempt',
            severity: 'P1',
            detail: u.origin + u.pathname,
          });
          await route.abort('blockedbyclient');
        })().catch(async (error) => {
          entry.issues.push({
            rule: 'audit-route-error',
            severity: 'P1',
            detail: String(error.message).slice(0, 240),
          });
          await route.abort('blockedbyclient').catch(() => {});
        }),
      );
      await context.routeWebSocket('**/*', (ws) => {
        if (new URL(ws.url()).origin.replace(/^ws/, 'http') !== server.origin) {
          entry.issues.push({ rule: 'external-websocket', severity: 'P1' });
          ws.close();
        } else ws.connectToServer();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(2500);
      page.setDefaultNavigationTimeout(8000);
      await page.clock.setFixedTime(new Date('2026-10-09T10:00:00Z'));
      page.on('console', (m) => {
        if (
          m.type() === 'error' &&
          !(
            scenario.pattern === '/video/edit/:projectId' &&
            m.location().url.endsWith('/api/trpc/videoEditing.getProject') &&
            m.text().includes('403')
          )
        )
          entry.issues.push({
            rule: 'console-error',
            severity: 'P1',
            detail: m.text().slice(0, 240),
          });
      });
      page.on('pageerror', (e) =>
        entry.issues.push({
          rule: 'unhandled-error',
          severity: 'P1',
          detail: e.message.slice(0, 240),
        }),
      );
      page.on('response', (r) => {
        if (
          r.status() >= 400 &&
          !(
            scenario.pattern === '/video/edit/:projectId' &&
            r.status() === 403 &&
            new URL(r.url()).pathname === '/api/trpc/videoEditing.getProject'
          )
        )
          entry.issues.push({
            rule: r.status() === 501 ? 'seed-contract-error' : 'http-error',
            severity: 'P1',
            detail: `${r.status()} ${new URL(r.url()).pathname}`,
          });
      });
      const captureContracts = async () => {
        const state = await (await fetch(`${server.origin}/__ui_seed/state`)).json();
        for (const gap of state.unhandled) {
          const text = `${scenario.pattern}@${width}: seed contract ${gap.name ?? gap.path}`;
          if (!report.coverageGaps.includes(text)) report.coverageGaps.push(text);
        }
        for (const request of state.requests)
          if (!report.seedContracts.includes(request.name)) report.seedContracts.push(request.name);
      };
      let loaded = false;
      const reset = async () => {
        if (loaded) await captureContracts();
        await fetch(`${server.origin}/__ui_seed/reset`);
        await page
          .evaluate(() => {
            localStorage.clear();
            sessionStorage.clear();
          })
          .catch(() => {});
        await page.goto(server.origin + scenario.path, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        loaded = true;
      };
      try {
        await reset();
        const measured = await measurePage(page);
        await page.screenshot({ path: path.join(out, screenshot), animations: 'disabled' });
        entry.canonicalPath = canonicalUrl(page.url());
        entry.runtimeControls = measured.elements;
        const expectedSeed = {
          '/account/closure-recovery': 'ACR-LOCAL-UI',
          '/files': '测试资料.txt',
          '/settings/roles': '内容创作',
          '/skills': '数据报告解读',
          '/projects': '测试项目',
          '/projects/:projectId': '测试项目',
          '/planned': '每日测试计划',
        }[scenario.pattern];
        if (expectedSeed && !measured.text.includes(expectedSeed))
          report.coverageGaps.push(
            `${scenario.pattern}@${width}: expected seeded content missing: ${expectedSeed}`,
          );
        entry.issues.push(...classifyGeometry(measured.elements, width, 960));
        for (const t of measured.truncatedText)
          if (!t.hasHint)
            entry.issues.push({
              rule: 'unexplained-text-truncation',
              severity: 'P2',
              detail: t.text,
            });
        if (measured.scrollWidth > width + 2)
          entry.issues.push({
            rule: 'horizontal-overflow',
            severity: 'P1',
            detail: `${measured.scrollWidth}>${width}`,
          });
        if (scenario.status)
          entry.issues.push(
            ...taskStateFindings(measured.text, {
              status: scenario.status,
              mode: scenario.taskMode,
              browserPanelVisible: measured.browserPanelVisible,
            }),
          );
        if (scenario.status === 'completed' && /未收到自动审核结论/.test(measured.text))
          entry.issues.push({ rule: 'known-4-alarming-verification-copy', severity: 'P2' });
        if (/eastmoney:stock-news-search/.test(measured.text))
          entry.issues.push({ rule: 'known-5-raw-provider-label', severity: 'P2' });
        if (!measured.text.trim()) entry.issues.push({ rule: 'page-not-rendered', severity: 'P1' });
        if (!screenOnly) {
          if (canonical.has(entry.canonicalPath))
            entry.controls = canonical.get(entry.canonicalPath).map((c) => ({
              ...c,
              status: 'shared-reference',
              reference: entry.canonicalPath,
              referencedStatus: c.status,
            }));
          else {
            entry.controls = await inspectControls(page, {
              reset,
              shared,
              onEvidence: async (n) => {
                const p = path.join('artifacts', `${id}-control-${n}.png`);
                await page.screenshot({ path: path.join(out, p), animations: 'disabled' });
                return p;
              },
            });
            canonical.set(entry.canonicalPath, entry.controls);
          }
        }
        for (const c of entry.controls) {
          if (c.layout)
            entry.issues.push(
              ...c.layout.map((f) => ({ ...f, observedUrl: c.afterUrl, screenshot: c.screenshot })),
            );
          if (c.accessibilityIssue)
            entry.issues.push({
              rule: 'selected-tab-semantics',
              severity: 'P2',
              control: c.label,
              detail: c.accessibilityIssue,
            });
          if (c.status === 'failed')
            entry.issues.push({
              rule: c.reason === 'popup remains about:blank' ? 'blank-popup' : 'dead-control',
              severity: 'P1',
              control: c.label,
              detail: c.reason,
              screenshot: c.screenshot,
            });
          if (c.status === 'uncovered')
            report.coverageGaps.push(
              `${scenario.pattern}@${width}: ${c.label ?? c.id}: ${c.reason}`,
            );
        }
        const baseline = path.join(root, 'baselines', SEED_VERSION, `${id}.png`);
        const baseMeta = `${baseline}.json`;
        fs.mkdirSync(path.dirname(baseline), { recursive: true });
        if (bootstrap) {
          fs.copyFileSync(path.join(out, screenshot), baseline);
          fs.writeFileSync(
            baseMeta,
            JSON.stringify({
              candidate,
              seed: SEED_VERSION,
              width,
              buildHash: report.buildHash,
              browserVersion: report.browserVersion,
              platform: report.platform,
            }),
          );
          entry.visual = { status: 'baseline-created' };
        } else if (!fs.existsSync(baseline) || !fs.existsSync(baseMeta))
          report.coverageGaps.push(`${id}: missing explicit visual baseline`);
        else {
          const meta = JSON.parse(fs.readFileSync(baseMeta, 'utf8'));
          if (
            meta.seed !== SEED_VERSION ||
            meta.width !== width ||
            meta.browserVersion !== report.browserVersion ||
            meta.platform !== report.platform
          )
            report.coverageGaps.push(`${id}: incompatible baseline environment`);
          else {
            const a = PNG.sync.read(fs.readFileSync(path.join(out, screenshot)));
            const b = PNG.sync.read(fs.readFileSync(baseline));
            entry.visual = pixelDifference(a, b);
            if (entry.visual.different) {
              const diff = path.join('artifacts', `${id}-diff.png`);
              if (a.width === b.width && a.height === b.height) {
                const d = new PNG({ width: a.width, height: a.height });
                for (let i = 0; i < a.data.length; i += 4) {
                  const changed = [0, 1, 2].some(
                    (k) => Math.abs(a.data[i + k] - b.data[i + k]) > 30,
                  );
                  d.data.set(
                    changed ? [255, 0, 97, 255] : [a.data[i], a.data[i + 1], a.data[i + 2], 90],
                    i,
                  );
                }
                fs.writeFileSync(path.join(out, diff), PNG.sync.write(d));
              }
              entry.issues.push({
                rule: 'visual-difference',
                severity: 'P2',
                detail: `ratio=${entry.visual.ratio}`,
                screenshot: diff,
              });
            }
          }
        }
        await captureContracts();
      } catch (error) {
        entry.issues.push({
          rule: 'scenario-error',
          severity: 'P1',
          detail: String(error.message).split('\n')[0],
        });
      } finally {
        entry.issues = [
          ...new Map(
            entry.issues.map((f) => [JSON.stringify([f.rule, f.control, f.detail]), f]),
          ).values(),
        ];
        for (const f of entry.issues)
          report.findings.push({
            ...f,
            route: scenario.pattern,
            width,
            screenshot: f.screenshot ?? screenshot,
          });
        report.pages.push(entry);
        saveReport(report, out);
        await context.close();
        console.log(
          JSON.stringify({
            route: scenario.pattern,
            width,
            controls: entry.controls.length,
            findings: entry.issues.length,
          }),
        );
      }
    }
  }
  if (suiteHash() !== report.suiteSourceHash)
    report.coverageGaps.push('Suite source changed during run; rerun from frozen source');
  if (treeHash() !== report.sourceHash)
    report.coverageGaps.push('Frontend source changed during run; rerun from frozen source');
} catch (e) {
  report.coverageGaps.push(String(e.message));
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  report.finishedAt = new Date().toISOString();
  saveReport(report, out);
}
console.log(
  JSON.stringify({
    status: report.status,
    pages: report.pages.length,
    findings: report.findings.length,
    gaps: report.coverageGaps.length,
  }),
);
process.exitCode = report.status === 'passed' ? 0 : 1;
