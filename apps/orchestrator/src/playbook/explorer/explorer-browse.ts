import { classifyExplorerAction } from './explorer-guards.js';
import type { ExploreSiteOutcome } from './explorer.js';

/**
 * Playbook ④ explorer — Capability-2 BROWSE-试用 lane (v1, 免登录 live browse).
 *
 * Reuses the supercar agent-loop (via the injected `runBrowseTask`) for a real,
 * login-free live browse, with the Sensitive Site Protocol wired as a PRE-ACTION
 * LIVE-VETO through the agent-loop's `onBeforeAction` hook: every click / navigate /
 * type is classified BEFORE it executes; a sensitive one (login / order / pay /
 * submit) is REFUSED (never executed) and the task halts → site `halted_sensitive`.
 *
 * v1 scope: navigate + click non-sensitive elements + read + search. NO login /
 * credential / submit / pay — those are hard-vetoed; the Credential Vault + dedicated
 * accounts are a later phase. The heavy wiring (a connected executor + runSupercarTask
 * + the llm_calls cost read) is INJECTED so this module is pure-logic + unit-testable.
 */

export interface BrowseAction {
  kind: 'click' | 'navigate' | 'type';
  label?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  placeholder?: string | null;
  name?: string | null;
  inputType?: string | null;
  url?: string | null;
  /** 预订站加固 — structural signals (tagName/inputType = 提交型; pageUrl = 交易阶段). login-mode only. */
  tagName?: string | null;
  pageUrl?: string | null;
}

export interface BrowseVerdict {
  allowed: boolean;
  reason?: string;
}

/**
 * The live-veto decision: classify a proposed live action via the Sensitive Site
 * Protocol / D-boundary. This is what gets wired into the agent-loop `onBeforeAction`.
 */
export function explorerOnBeforeAction(
  action: BrowseAction,
  opts: { loginMode?: boolean } = {},
): BrowseVerdict {
  const verdict = classifyExplorerAction(
    {
      kind: action.kind,
      ...(action.label != null ? { label: action.label } : {}),
      ...(action.ariaLabel != null ? { ariaLabel: action.ariaLabel } : {}),
      ...(action.title != null ? { title: action.title } : {}),
      ...(action.placeholder != null ? { placeholder: action.placeholder } : {}),
      ...(action.name != null ? { name: action.name } : {}),
      ...(action.inputType != null ? { inputType: action.inputType } : {}),
      ...(action.url != null ? { url: action.url } : {}),
      ...(action.tagName != null ? { tagName: action.tagName } : {}), // 预订站加固: 提交型控件判定
      ...(action.pageUrl != null ? { pageUrl: action.pageUrl } : {}), // 预订站加固: 交易阶段反转
    },
    opts, // A3: login-mode thickens the veto (EXTRA_RE) — default empty = 免登录 lane unchanged
  );
  return verdict.allowed ? { allowed: true } : { allowed: false, reason: verdict.reason };
}

/** Read-only browse intent — the soft guard (the hard guard is the live-veto). */
/**
 * Per-domain SEED TASK hints (intent-deepening v2). 1-2 representative, concrete tasks per
 * site so the browse has an evaluable goal ("摸清这个任务怎么走到边界") instead of a shallow
 * marketing scroll. The model MAY pick one OR identify another common task for the site.
 * Unknown domains → a generic "find the site's core task + try it". Static map (additive, no
 * DB); a per-site DB-driven seed list is a later phase.
 */
const SEED_TASKS: Record<string, string[]> = {
  'figma.com': ['新建一个设计文件', '打开模板库 / 找一个模板'],
  'ctrip.com': ['查一段行程的机票（出发/到达/日期 → 看搜索结果）', '查某城市的酒店列表'],
  'todoist.com': ['新建一个任务清单 / 添加一条任务', '找到怎么给任务设提醒'],
  'douyin.com': ['搜索一个话题、看视频列表', '打开某个创作者主页'],
};

/**
 * Read-only browse intent — the soft guard (the hard guard is the live-veto + clean-context).
 * v2 = TASK/CAPABILITY-ORIENTED: drive ONE concrete task's flow to the ACTION BOUNDARY (stop
 * before login/order/pay) and report the breakpoint — so a path carries real "how to do X" value
 * instead of a shallow marketing crawl, AND we collect evidence on where "免登录" runs out.
 */
/**
 * ① LOGIN-MODE single create-task (hard-drive). The 免登录 task-oriented intent's "任选其一 / 或你
 * 识别出的另一个" extensibility let the logged-in agent REVERSE into Community/templates instead of
 * executing the task (figma run #1). Login mode gets ONE task, strongly driven, reverse-browsing
 * forbidden, steered straight at the share/delete boundary (where EXTRA_RE halts). figma-specific
 * here; unknown login domains get a generic "execute the core CREATE task, no reverse-browse".
 */
const LOGIN_TASKS: Record<string, string> = {
  'figma.com':
    '在 figma 新建一个空白设计文件并进入编辑器：第一步就找 "New design file" / "新建" 按钮点进去——不要逆向去 Community / 模板 / 推荐 / 帮助。进编辑器后：加一个元素（画一个矩形或加一段文本）、触发一次保存。然后走向 "分享 / Share" 按钮但停在点击前。',
  // todoist = 表单站（"加一条任务" 是简单输入框，比 figma 画布好走通）→ 拿第一条真 post-login path。
  'todoist.com':
    '在 todoist 新建一条任务：第一步就找快速添加 / "Add task" / "添加任务" 输入框点进去 → 输入一条任务文本（如 "买牛奶"）→ 按回车 / 点保存提交这一条。然后走向 "分享项目 / Share project" 或 "删除任务 / Delete" 控件但停在点击前。绝不逆向去 Settings / 设置 / 集成 / 升级 / 别处。',
};

function loginBrowseIntent(domain: string): string {
  const task =
    LOGIN_TASKS[domain] ??
    '执行这个网站最核心的一个【创建类】任务（用户登录后最常做的事）：第一步就直接进入这个任务的创建流程，绝不逆向去浏览 Community / 模板 / 推荐 / 帮助。';
  return [
    `打开 https://${domain}/ （已登录测试号）。你的【唯一任务】，强执行、不准逆向：`,
    task,
    '只做这一个任务的执行步骤：导航 + 点击该任务流程上的元素 + 必要输入。【禁止】去逛 Community / 模板 / 推荐 / 营销页——那是逆向、本轮严禁。',
    '红线（系统会硬拦、你也绝不真点成）：分享 / 发布 / 删除 / 提交 / 支付 / 转账 / 解绑 / 注销 等不可逆或对外动作——走到它【停在点击前】，绝不真点。',
    '【断点报告】最终总结写出：任务走到第几步、停在哪个动作上、为什么停（撞红线？走完？）。',
    '收敛：尽量少步数把这一个任务走到红线边界为止，到了就停、输出【任务流程 + 断点报告】并宣告完成（done），不要凑步数乱逛。',
  ].join('\n');
}

export function browseIntent(domain: string, opts: { loginMode?: boolean } = {}): string {
  // ① login mode → single hard-driven create-task (no reverse-browse). 免登录 lane unchanged below.
  if (opts.loginMode === true) return loginBrowseIntent(domain);
  const seeds = SEED_TASKS[domain];
  const seedLine = seeds?.length
    ? `这个网站的代表任务（任选其一，或你识别出的另一个该站常见任务）：\n  - ${seeds.join('\n  - ')}`
    : '先识别这个网站最核心的一个常见任务（用户最常来干的事），选一个具体任务深入。';
  return [
    `打开 https://${domain}/ ，目标是【摸清"做一件具体任务"在这个网站怎么走】，不是泛泛浏览。`,
    seedLine,
    '只读试做：导航、点击非敏感的浏览/查看/搜索/筛选类元素、阅读页面、必要检索——把这个任务的操作流程一步步走出来。',
    '走到【动作边界】为止：一旦下一步需要 登录/注册/下单/支付/提交真实信息，就【停在那一步之前】、不要点（系统也会硬拦）。本轮全程免登录、绝不碰登录态。',
    '【断点报告】最终总结里明确写出：这个任务走到第几步、停在哪个动作上、为什么停（需登录？需下单？需支付？还是已走完）——这是判断"免登录够不够"的关键证据。',
    '收敛：用尽量少的步数（目标 ≤15 步）把这一个任务的流程摸到边界为止，看够了就停、输出【任务流程 + 能力清单 + 断点报告】并明确宣告完成（done），不要凑步数乱逛。',
  ].join('\n');
}

export interface BrowseRunResult {
  status: 'completed' | 'failed' | 'cancelled' | 'awaiting_user' | string;
  /**
   * Cost-source A: the in-process accumulated supercar.turn cost (USD) for THIS browse,
   * summed in-memory from each turn's token usage (see CostAccumulatingRecorder). This
   * is what the per-site $5 breaker reads — a fail-closed number, never a DB read-back.
   */
  costUsd: number;
  reason?: string;
  /** The model's final report (incl. the 任务流程 / 能力清单 / 断点报告). Persisted into
   *  exploration_runs.metadata for the "免登录够不够" evidence review (intent-deepening v2). */
  summary?: string;
}

export interface BrowseDeps {
  /**
   * Dispatch ONE live browse task through runSupercarTask with the given veto hook
   * wired to `onBeforeAction`. The CLI provides this (connects an executor, calls
   * runSupercarTask). The hook MUST be passed straight through to the agent-loop.
   */
  runBrowseTask: (args: {
    domain: string;
    intent: string;
    onBeforeAction: (action: BrowseAction) => BrowseVerdict;
  }) => Promise<BrowseRunResult>;
  /**
   * A2/A3 login-self-learning: when true the live-veto thickens (EXTRA_RE — money / irreversible
   * / publish). Default undefined/false → 免登录 public-skeleton lane is byte-identical. The CLI
   * sets it ONLY when LOGIN_EXPLORER_ENABLED is on (orthogonal to EXPLORER_ENABLED).
   */
  loginMode?: boolean;
}

/**
 * Build the browse-试用 `exploreSite`. On a veto the action was NOT executed (the
 * agent-loop refused it) and the task halted → `halted_sensitive`. Otherwise the
 * outcome mirrors the task's terminal status. Cost is the task's real supercar.turn
 * spend (so the per-site $5 breaker fences an abnormal multi-turn burn).
 */
export function makeBrowseExploreSite(
  deps: BrowseDeps,
): (domain: string) => Promise<ExploreSiteOutcome> {
  return async (domain: string): Promise<ExploreSiteOutcome> => {
    // object wrapper so the closure mutation is visible after the await (a plain
    // `let` would be narrowed to null by the type-checker).
    const state: { vetoed: { reason: string } | null } = { vetoed: null };
    const onBeforeAction = (action: BrowseAction): BrowseVerdict => {
      const v = explorerOnBeforeAction(action, { loginMode: deps.loginMode === true });
      if (!v.allowed) state.vetoed = { reason: v.reason ?? 'sensitive action' };
      return v;
    };

    let result: BrowseRunResult;
    try {
      result = await deps.runBrowseTask({
        domain,
        intent: browseIntent(domain, { loginMode: deps.loginMode === true }), // ① login → single create-task
        onBeforeAction,
      });
    } catch (err) {
      return {
        domain,
        status: 'failed',
        costUsd: 0,
        note: `browse: runBrowseTask threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Cost-source A: the in-process accumulated cost the runner returns (fail-closed;
    // never a DB read-back). Feeds the per-site $5 breaker via ExploreSiteOutcome.costUsd.
    const costUsd = Number.isFinite(result.costUsd) && result.costUsd > 0 ? result.costUsd : 0;

    if (state.vetoed) {
      return {
        domain,
        status: 'halted_sensitive',
        costUsd,
        note: `live-veto: ${state.vetoed.reason} — action refused (not executed), site stopped`,
        ...(result.summary ? { summary: result.summary } : {}), // ③ breakpoint evidence (走到哪/被 veto 停) — MUST survive the veto path
      };
    }
    if (result.status === 'completed') {
      return {
        domain,
        status: 'completed',
        costUsd,
        note: 'browse: live exploration completed',
        ...(result.summary ? { summary: result.summary } : {}), // 任务流程 + 断点报告 evidence
      };
    }
    return {
      domain,
      status: 'failed',
      costUsd,
      note: `browse: task ${result.status}${result.reason ? ` — ${result.reason}` : ''}`,
      ...(result.summary ? { summary: result.summary } : {}), // ③ breakpoint evidence (走到哪/为什么停) — MUST survive the failed path too
    };
  };
}
