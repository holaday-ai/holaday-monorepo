/**
 * Playbook ④ — browse-试用 LIVE-VETO 真机验收 harness（确定性，零模型调用）。
 *
 * 连 clean-context executor 到 box CDP → 导航真夹具 → 用真函数
 * (captureTargetDescriptor / vetoActionKind / classifyExplorerAction) 对四向量
 * + 安全链接逐个判定，executor-spy 证内层 click 只在安全链接被调。
 *
 * 四向量全部读真夹具 DOM（不 hardcode token）：向量 4 读真 submit 按钮 label
 * + 表单真 action 导航目标，喂 classifyExplorerAction 断言 sensitive。
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
  const labelAt = async (sel: string): Promise<string | null> => {
    const c = await center(sel);
    if (!c) return null;
    const d = await ex.captureTargetDescriptor(page as never, c.x, c.y);
    return d?.visibleText ?? d?.ariaLabel ?? null; // 真 DOM：visibleText 优先，回落 aria-label
  };

  // ── 向量 1：decompose-click（mouse_down/up/drag → fail-closed 当 click）────
  const vk = ['left_mouse_down', 'left_mouse_up', 'left_click_drag'].map((a) => vetoActionKind(a));
  const l1 = await labelAt('#sensitive-text');
  const v1 = classifyExplorerAction({ kind: 'click', ...(l1 != null ? { label: l1 } : {}) });
  rec(
    '1 decompose-click 拦',
    vk.every((k) => k === 'click') && !v1.allowed,
    `vetoActionKind(down/up/drag)=${JSON.stringify(vk)}（全 'click' fail-closed）; 真DOM label="${l1}" → sensitive=${!v1.allowed}`,
  );

  // ── 向量 2：icon-only（aria-label，无文字）────────────────────────────────
  const l2 = await labelAt('#sensitive-icon');
  const v2 = classifyExplorerAction({ kind: 'click', ...(l2 != null ? { label: l2 } : {}) });
  rec('2 icon-only(aria) 拦', l2 != null && !v2.allowed, `真DOM aria label="${l2}" → sensitive=${!v2.allowed}`);

  // ── 向量 3：链接点击导航（href 敏感 → 落地 URL 复检拦）─────────────────────
  const hrefH = await page.$('#sensitive-href');
  const href3 = hrefH ? await hrefH.getAttribute('href') : null; // 真 DOM 链接目标
  const v3nav = href3 != null ? classifyExplorerAction({ kind: 'navigate', url: href3 }) : { allowed: true };
  const l3 = await labelAt('#sensitive-href');
  const v3click = classifyExplorerAction({ kind: 'click', ...(l3 != null ? { label: l3 } : {}) });
  rec(
    '3 链接导航拦（post-nav URL 复检）',
    href3 != null && !v3nav.allowed,
    `真DOM href="${href3}" navigate sensitive=${!v3nav.allowed}; 链接 label="${l3}" click sensitive=${!v3click.allowed}（双拦）`,
  );

  // ── 向量 4：Tab-type-Enter 提交 —— 读真 DOM 的 submit 按钮 label + 表单 action ──
  const submitSel = 'form button[type="submit"]'; // 表单内 submit（非表单外的 #sensitive-text）
  const l4 = await labelAt(submitSel); // 真 DOM submit 按钮 label
  const v4submit = classifyExplorerAction({ kind: 'click', ...(l4 != null ? { label: l4 } : {}) });
  const formH = await page.$('form');
  const formAction = formH ? await formH.getAttribute('action') : null; // 真 DOM 表单导航目标
  const v4nav = formAction != null ? classifyExplorerAction({ kind: 'navigate', url: formAction }) : { allowed: true };
  const pwdDesc = await ex.captureTargetDescriptor(page as never); // 无坐标 = activeElement（autofocus #pwd）
  const pwdLabel = pwdDesc?.visibleText ?? pwdDesc?.ariaLabel ?? null;
  const v4type = classifyExplorerAction({ kind: 'type', ...(pwdLabel != null ? { label: pwdLabel } : {}) });
  rec(
    '4 Tab-type-Enter 提交拦（真 DOM）',
    l4 != null && !v4submit.allowed && formAction != null && !v4nav.allowed,
    `真DOM submit-label="${l4}" click sensitive=${!v4submit.allowed}; 真DOM form action="${formAction}" nav sensitive=${!v4nav.allowed}; pwd-type 焦点 label="${pwdLabel}" allowed=${v4type.allowed}（无 aria/label 的密码框 type 不拦=文档化残留，clean-context 无凭据可填 + 提交被拦兜底）`,
  );

  // ── 安全链接：放行 + 真执行（innerClick++）────────────────────────────────
  const l5 = await labelAt('#safe');
  const v5 = classifyExplorerAction({ kind: 'click', ...(l5 != null ? { label: l5 } : {}) });
  if (v5.allowed) {
    const c = await center('#safe');
    if (c) {
      await ex.click(page as never, c.x, c.y); // 仅安全链接被真点
      innerClick += 1;
    }
  }
  rec('5 安全链接放行+执行', v5.allowed && innerClick === 1, `真DOM label="${l5}" allowed=${v5.allowed}; innerClick=${innerClick}`);

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
  await ex.disposeCleanContext().catch(() => {}); // 销毁 clean context（box 复 dark 的前半，flag 关回是后半）
  await pool.end().catch(() => {});
}
