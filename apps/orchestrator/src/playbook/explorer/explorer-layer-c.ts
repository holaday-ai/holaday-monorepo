/**
 * Playbook ④ — LAYER C: model-fallback veto for logged-in transaction sites.
 *
 * WHY: on a transaction SPA (trip.com) the URL never transitions to /checkout, so the URL-based
 * 交易页反转 (Layer 反转) is blind, and a NEUTRAL "Continue" button isn't a detectable submit-type
 * (Layer B blind). When the deterministic layers (A keyword / B structural / 反转 page-stage) all
 * PASS but the click is in a 交易可疑区 (proceed-word OR the page shows transaction fields), this
 * cheap model call gets the FINAL say.
 *
 * SECURITY CONTRACT (all enforced here):
 *  - FAIL-CLOSED everywhere: non-ALLOW reply / timeout / call error / unparseable / quota exhausted
 *    → BLOCK. ALLOW only on an explicit, clean ALLOW.
 *  - The model NEVER executes anything — it returns BLOCK/ALLOW; the action is still gated by the
 *    onBeforeAction hook (the model's verdict only feeds that decision).
 *  - INPUT IS MINIMAL + REDACTED: action kind + control label/tag + page title + visible tx-field
 *    NAMES only. NEVER cookies / storageState / typed input values / id numbers / the full page.
 *  - PER-RUN QUOTA: at most `maxCalls` model calls; the (maxCalls+1)-th and beyond do NOT call and
 *    BLOCK (fail-closed). Each real call is metered by the injected `callModel` (llm_calls accounting).
 *
 * The flag (LAYER_C_MODEL_VETO_ENABLED) gates whether the CLI wires this at all — OFF → this module
 * is never constructed, the veto falls back to A/B/反转 (today's behaviour), zero model spend.
 */

export interface LayerCInput {
  kind: string;
  label: string | null;
  tagName: string | null;
  pageTitle: string | null;
  /** Visible transaction-field NAMES on the page (e.g. "出行人,证件,价格明细") — never values. */
  pageTxFields: string | null;
}

export interface LayerCDeps {
  /** Calls the cheap model (haiku, temp 0, tiny max_tokens) with the prompt; returns its raw text.
   *  MUST meter cost into llm_calls (explorer accounting). Throwing → fail-closed BLOCK here. */
  callModel: (prompt: string) => Promise<string>;
  /** Per-run hard cap on model calls (BOSS authorised ≤15/run). */
  maxCalls: number;
  /** Per-call wall-clock timeout (ms). Timeout → fail-closed BLOCK. Default 8000. */
  timeoutMs?: number;
  logger?: { warn: (o: unknown, m: string) => void };
}

/** Build the FIXED prompt. ONLY redacted structural fields — see SECURITY CONTRACT. */
export function buildLayerCPrompt(input: LayerCInput): string {
  return [
    '你是"登录态自动浏览"的安全闸。判断下面这个【点击】是否会【推进交易 / 提交订单 / 确认支付 / 提交个人或支付资料】。',
    `动作类型：${input.kind}`,
    `控件文案：${(input.label ?? '(无)').slice(0, 80)}`,
    `控件标签：${input.tagName ?? '(无)'}`,
    `页面标题：${(input.pageTitle ?? '(无)').slice(0, 80)}`,
    `页面可见交易字段：${(input.pageTxFields ?? '(无)').slice(0, 120)}`,
    '规则：推进交易/提交订单/确认支付/提交个人或支付资料 → BLOCK；只是浏览/搜索/查看/筛选/返回/上一步 → ALLOW；判不准 → BLOCK。',
    '只回一行，以 BLOCK 或 ALLOW 开头，后跟一句中文理由。',
  ].join('\n');
}

/** Parse STRICTLY + fail-closed: must START with ALLOW to allow; anything else (incl. BLOCK,
 *  ambiguous, empty) → BLOCK. */
export function parseLayerCVerdict(raw: string): { block: boolean; reason: string } {
  const t = (raw ?? '').trim();
  const head = t.slice(0, 24).toUpperCase();
  if (head.startsWith('ALLOW')) return { block: false, reason: `Layer C ALLOW: ${t.slice(0, 80)}` };
  if (head.startsWith('BLOCK')) return { block: true, reason: `Layer C BLOCK: ${t.slice(0, 80)}` };
  return { block: true, reason: `Layer C 返回不明确("${t.slice(0, 32)}") → fail-closed 拦` };
}

export interface LayerCVeto {
  /** Returns block=true to veto, block=false to allow. NEVER throws (all paths fail-closed). */
  veto: (input: LayerCInput) => Promise<{ block: boolean; reason: string }>;
  callsUsed: () => number;
}

export function makeLayerCVeto(deps: LayerCDeps): LayerCVeto {
  const timeoutMs = deps.timeoutMs ?? 8000;
  let calls = 0;
  const veto = async (input: LayerCInput): Promise<{ block: boolean; reason: string }> => {
    // QUOTA — fail-closed once exhausted (do NOT call).
    if (calls >= deps.maxCalls) {
      return { block: true, reason: `Layer C 限额满 (${deps.maxCalls}/run) → fail-closed 拦` };
    }
    calls += 1;
    let raw: string;
    try {
      raw = await Promise.race([
        deps.callModel(buildLayerCPrompt(input)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Layer C model timeout ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      deps.logger?.warn({ reason }, 'Layer C: model call failed/timeout → fail-closed BLOCK');
      return { block: true, reason: `Layer C 调用失败/超时 → fail-closed 拦 (${reason.slice(0, 40)})` };
    }
    return parseLayerCVerdict(raw);
  };
  return { veto, callsUsed: () => calls };
}
