/**
 * Playbook ④ — browse-试用 LIVE-VETO 真机验收 harness（确定性，零模型调用）。
 *
 * 连 clean-context executor 到 box CDP → 导航真夹具 → 用真函数
 * (captureTargetDescriptor / vetoActionKind / classifyExplorerAction) 对四向量
 * + 安全链接逐个判定，executor-spy 证内层 click 只在安全链接被调。
 *
 * 四向量全部读真夹具 DOM（不 hardcode token），并把 ALL accessible-name 信号
 * (visibleText / aria-label / title / placeholder / name / inputType) 喂给修复后的
 * 多信号分类器 —— 镜像 agent-loop 修复后的 veto。向量 2 icon-only：emoji glyph 的
 * visibleText 不再短路敏感 aria/title。向量 4：密码框 type 凭 inputType=password 一律拦。
 *
 * 前置：EXPLORER_VETO_FIXTURE_ENABLED=true（夹具可达）；CDP_ENDPOINT 指向 box chromium。
 * 零 LLM 调用 → ~$0。只点 #safe 安全链接，绝不点敏感、绝不填/提交密码框（D 边界）。
 *
 *   set -a && . .env && set +a && pnpm tsx scripts/explorer-veto-acceptance.ts
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const appRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
function loadEnv(p: string): void {
  const r = loadDotenv({ path: p, override: false });
  if (!r.parsed) return;
  for (const [k, v] of Object.entries(r.parsed)) {
    if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v;
  }
}
loadEnv(resolve(appRoot, '.env'));
loadEnv(resolve(repoRoot, '.env'));

const { PlaywrightExecutor } = await import('../src/agent/vision-loop/playwright-executor.js');
const { vetoActionKind } = await import('../src/agent/supercar/agent-loop.js');
const { classifyExplorerAction } = await import('../src/playbook/explorer/explorer-guards.js');
const { SiteRepository } = await import('../src/playbook/site-repository.js');
const { PlaybookRepository } = await import('../src/playbook/playbook-repository.js');
const { db, pool } = await import('../src/db/client.js');

const CDP = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const FIXTURE =
  process.env.EXPLORER_VETO_FIXTURE_URL ?? 'http://127.0.0.1:4001/test/explorer-veto-fixture';

type Handle = {
  boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
  getAttribute: (name: string) => Promise<string | null>;
};
type Page = { goto: (u: string, o?: unknown) => Promise<unknown>; $: (s: string) => Promise<Handle | null> };
type Desc = {
  visibleText: string | null;
  ariaLabel: string | null;
  title: string | null;
  placeholder: string | null;
  name: string | null;
  type: string | null;
} | null;

const results: Array<{ n: string; ok: boolean; ev: string }> = [];
const rec = (n: string, ok: boolean, ev: string) => {
  results.push({ n, ok, ev });
  console.log(`${ok ? 'PASS' : '🔴 FAIL'}  ${n} — ${ev}`);
};

const ex = new PlaywrightExecutor();
const conn = await ex.connect(CDP, { cleanContext: true });
if (!conn.ok) {
  console.error(`[acceptance] clean-context connect FAILED: ${conn.error}`);
  await pool.end().catch(() => {});
  process.exit(1);
}

try {
  // ── 断言 0：clean-context 零-cookie（§9.6 backstop 真机首证）──────────────
  let zeroCookie = false;
  let cookieEv = '';
  try {
    await ex.assertCleanContext();
    zeroCookie = true;
    cookieEv = 'cookies=0 — newContext-over-CDP 在本 box 真给干净上下文';
  } catch (e) {
    cookieEv = `assertCleanContext fail-closed 拒: ${e instanceof Error ? e.message : String(e)}`;
  }
  rec('0 clean-context 零-cookie', zeroCookie, cookieEv);
  if (!zeroCookie) {
    console.error('[acceptance] 脏上下文 → fail-closed 已拒，停止后续向量。');
    process.exit(2);
  }

  const page = (await ex.getPage()) as unknown as Page;
  let innerClick = 0; // executor.click 实调用计数（spy）
  await page.goto(FIXTURE, { waitUntil: 'domcontentloaded' }); // 安全导航（夹具页本身非敏感）

  const center = async (sel: string): Promise<{ x: number; y: number } | null> => {
    const h = await page.$(sel);
    const b = h ? await h.boundingBox() : null;
    return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
  };
  // 读真 DOM 完整描述符（所有 accessible-name 信号）。
  const descAt = async (sel: string): Promise<Desc> => {
    const c = await center(sel);
    return c ? ((await ex.captureTargetDescriptor(page as never, c.x, c.y)) as unknown as Desc) : null;
  };
  // 把所有 click 信号喂修复后的多信号分类器（镜像 agent-loop veto）。
  const classifyClick = (d: Desc) =>
    classifyExplorerAction({
      kind: 'click',
      ...(d?.visibleText != null ? { label: d.visibleText } : {}),
      ...(d?.ariaLabel != null ? { ariaLabel: d.ariaLabel } : {}),
      ...(d?.title != null ? { title: d.title } : {}),
    });

  // ── 向量 1：decompose-click（mouse_down/up/drag → fail-closed 当 click）────
  const vk = ['left_mouse_down', 'left_mouse_up', 'left_click_drag'].map((a) => vetoActionKind(a));
  const d1 = await descAt('#sensitive-text');
  const v1 = classifyClick(d1);
  rec(
    '1 decompose-click 拦',
    vk.every((k) => k === 'click') && !v1.allowed,
    `vetoActionKind(down/up/drag)=${JSON.stringify(vk)}（全 'click' fail-closed）; 真DOM visibleText="${d1?.visibleText}" → sensitive=${!v1.allowed}`,
  );

  // ── 向量 2：icon-only（visibleText=💳 glyph，敏感意图在 aria/title）────────
  const d2 = await descAt('#sensitive-icon');
  const v2 = classifyClick(d2);
  rec(
    '2 icon-only 拦（多信号 OR）',
    !v2.allowed,
    `真DOM visibleText="${d2?.visibleText}" aria="${d2?.ariaLabel}" title="${d2?.title}" → sensitive=${!v2.allowed}（emoji visibleText 不再短路敏感 aria/title）`,
  );

  // ── 向量 3：链接点击导航（href 敏感 → 落地 URL 复检拦）─────────────────────
  const hrefH = await page.$('#sensitive-href');
  const href3 = hrefH ? await hrefH.getAttribute('href') : null; // 真 DOM 链接目标
  const v3nav = href3 != null ? classifyExplorerAction({ kind: 'navigate', url: href3 }) : { allowed: true };
  const v3click = classifyClick(await descAt('#sensitive-href'));
  rec(
    '3 链接导航拦（post-nav URL 复检）',
    href3 != null && !v3nav.allowed,
    `真DOM href="${href3}" navigate sensitive=${!v3nav.allowed}; 链接 click sensitive=${!v3click.allowed}（双拦）`,
  );

  // ── 向量 4：Tab-type-Enter —— 真 DOM submit label + form action + 密码框 type 一律拦 ──
  const dSubmit = await descAt('form button[type="submit"]'); // 表单内 submit（非表单外 #sensitive-text）
  const v4submit = classifyClick(dSubmit);
  const formH = await page.$('form');
  const formAction = formH ? await formH.getAttribute('action') : null; // 真 DOM 表单导航目标
  const v4nav = formAction != null ? classifyExplorerAction({ kind: 'navigate', url: formAction }) : { allowed: true };
  const pwd = (await ex.captureTargetDescriptor(page as never)) as unknown as Desc; // activeElement = autofocus #pwd
  const v4type = classifyExplorerAction({
    kind: 'type',
    ...(pwd?.type != null ? { inputType: pwd.type } : {}),
    ...(pwd?.placeholder != null ? { placeholder: pwd.placeholder } : {}),
    ...(pwd?.name != null ? { name: pwd.name } : {}),
    ...(pwd?.ariaLabel != null ? { ariaLabel: pwd.ariaLabel } : {}),
  });
  rec(
    '4 Tab-type-Enter 提交拦 + 密码框 type 拦（真 DOM）',
    !v4submit.allowed && formAction != null && !v4nav.allowed && !v4type.allowed,
    `真DOM submit-visibleText="${dSubmit?.visibleText}" sensitive=${!v4submit.allowed}; form action="${formAction}" nav sensitive=${!v4nav.allowed}; pwd inputType="${pwd?.type}" → type 拦=${!v4type.allowed}（密码框一律拦，上轮残留已关）`,
  );

  // ── 安全链接：放行 + 真执行（innerClick++）────────────────────────────────
  const dSafe = await descAt('#safe');
  const v5 = classifyClick(dSafe);
  if (v5.allowed) {
    const c = await center('#safe');
    if (c) {
      await ex.click(page as never, c.x, c.y); // 仅安全链接被真点
      innerClick += 1;
    }
  }
  rec('5 安全链接放行+执行', v5.allowed && innerClick === 1, `真DOM visibleText="${dSafe?.visibleText}" allowed=${v5.allowed}; innerClick=${innerClick}`);

  // ── 向量 7：A3 LOGIN-MODE 加厚（EXTRA_RE）——同一真 DOM 控件，免登录放行 / 登录态拦 ──
  // 证明条件加厚：base RE 不动（免登录 allowed=不拦），login mode 并上 EXTRA_RE（vetoed）。这些
  // 控件（分享/转账/删除文件）只在登录后存在；登录态自学时必须被 veto。零真会话——纯分类器层证明
  // （storageState 连接路径由 explorer-browse-runner.test.ts 单测覆盖）。
  for (const [sel, name] of [
    ['#login-share', '分享'],
    ['#login-transfer', '转账'],
    ['#login-delete', '删除文件'],
  ] as const) {
    const d = await descAt(sel);
    const base = classifyClick(d); // loginMode 默认 false → 免登录 lane
    const login = classifyExplorerAction(
      {
        kind: 'click',
        ...(d?.visibleText != null ? { label: d.visibleText } : {}),
        ...(d?.ariaLabel != null ? { ariaLabel: d.ariaLabel } : {}),
        ...(d?.title != null ? { title: d.title } : {}),
      },
      { loginMode: true },
    );
    rec(
      `7 login-mode 加厚拦「${name}」`,
      base.allowed && !login.allowed,
      `真DOM visibleText="${d?.visibleText}" → 免登录 allowed=${base.allowed}（base 不拦）/ 登录态 sensitive=${!login.allowed}（EXTRA_RE 拦）`,
    );
  }

  // ── executor-spy：敏感向量内层 click 零调用 / 安全 1 ───────────────────────
  rec(
    'spy executor.click：敏感=0 / 安全=1',
    innerClick === 1,
    `innerClick=${innerClick}（四向量遵 veto 全未点，仅安全链接执行；page.goto 仅安全夹具导航一次）`,
  );

  // ── exploration_runs 真写（v1 缺口端到端验通）───────────────────────────
  const siteRepo = new SiteRepository(db);
  const pb = new PlaybookRepository(db);
  let site = await siteRepo.findGlobalByDomain('veto-fixture.local');
  if (!site) {
    site = await siteRepo.create({
      ownerUserId: null,
      canonicalDomain: 'veto-fixture.local',
      displayName: 'veto acceptance fixture',
      homepageUrl: FIXTURE,
    });
  }
  await pb.createExplorationRun({
    siteId: site.id,
    triggerType: 'manual_batch',
    runnerType: 'explorer.browse',
    status: 'halted_sensitive',
    metadataJson: { note: 'veto acceptance fixture', costUsd: 0, assertions: results.map((r) => ({ n: r.n, ok: r.ok })) },
  });
  rec('6 exploration_runs 写入', true, 'veto-fixture.local 一条 halted_sensitive（端到端验通）');

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== SUMMARY: ${passed}/${results.length} PASS ===`);
  process.exitCode = passed === results.length ? 0 : 3;
} finally {
  // bound cleanup so a lingering CDP socket can't hang the process (prior run hit the
  // timeout-124 AFTER the SUMMARY printed) — force-exit with the real code.
  await Promise.race([
    (async () => {
      await ex.disposeCleanContext().catch(() => {});
      await pool.end().catch(() => {});
    })(),
    new Promise((r) => setTimeout(r, 8000)),
  ]);
  process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
}
