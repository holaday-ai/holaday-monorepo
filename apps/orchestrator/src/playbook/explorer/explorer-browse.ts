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
  url?: string | null;
}

export interface BrowseVerdict {
  allowed: boolean;
  reason?: string;
}

/**
 * The live-veto decision: classify a proposed live action via the Sensitive Site
 * Protocol / D-boundary. This is what gets wired into the agent-loop `onBeforeAction`.
 */
export function explorerOnBeforeAction(action: BrowseAction): BrowseVerdict {
  const verdict = classifyExplorerAction({
    kind: action.kind,
    ...(action.label != null ? { label: action.label } : {}),
    ...(action.url != null ? { url: action.url } : {}),
  });
  return verdict.allowed ? { allowed: true } : { allowed: false, reason: verdict.reason };
}

/** Read-only browse intent — the soft guard (the hard guard is the live-veto). */
export function browseIntent(domain: string): string {
  return [
    `打开 https://${domain}/ 并只读浏览，了解这个网站能做什么、怎么用。`,
    '只做：导航、点击非敏感的浏览/查看类元素、阅读页面内容、必要的检索。',
    '绝不：登录、注册、提交表单、下单、支付、填写真实身份或任何写操作。',
    '遇到登录墙 / 提交 / 下单 / 支付这类按钮就停下，不要点（系统也会硬拦）。',
  ].join('\n');
}

export interface BrowseRunResult {
  status: 'completed' | 'failed' | 'cancelled' | 'awaiting_user' | string;
  /** internal task id of the dispatched supercar task, for the cost lookup. */
  taskInternalId?: number | null;
  reason?: string;
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
  /** Real spend of the dispatched task — sum llm_calls (supercar.turn) for it. */
  readTaskCostUsd: (taskInternalId: number) => Promise<number>;
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
      const v = explorerOnBeforeAction(action);
      if (!v.allowed) state.vetoed = { reason: v.reason ?? 'sensitive action' };
      return v;
    };

    let result: BrowseRunResult;
    try {
      result = await deps.runBrowseTask({ domain, intent: browseIntent(domain), onBeforeAction });
    } catch (err) {
      return {
        domain,
        status: 'failed',
        costUsd: 0,
        note: `browse: runBrowseTask threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const costUsd =
      result.taskInternalId != null
        ? await deps.readTaskCostUsd(result.taskInternalId).catch(() => 0)
        : 0;

    if (state.vetoed) {
      return {
        domain,
        status: 'halted_sensitive',
        costUsd,
        note: `live-veto: ${state.vetoed.reason} — action refused (not executed), site stopped`,
      };
    }
    if (result.status === 'completed') {
      return { domain, status: 'completed', costUsd, note: 'browse: live exploration completed' };
    }
    return {
      domain,
      status: 'failed',
      costUsd,
      note: `browse: task ${result.status}${result.reason ? ` — ${result.reason}` : ''}`,
    };
  };
}
