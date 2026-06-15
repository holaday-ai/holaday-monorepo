/**
 * Phase 2 ⑦ — LLM 意图判官（regex complianceGate 之后的第二层防御，BOSS 拍板）.
 *
 * 动机：regex 闸门对「跌到/回落/已从高点下来」等**过去式/状态描述**会误杀合规⑦——同股不同次
 * 时好时降级（降级率 ~22%）。本判官读全文判**两条红线**（买卖引导 / 涨跌预测），与 regex 组双层：
 *   - regex PASS         → judge 二次复核（补 regex 漏网的语义暗示）；仅 judge **明确 block** 才否决。
 *   - regex SOFT 误杀      → judge 复核可**救回**（predict/tension/semantic）；仅 judge **明确 pass** 才放行。
 *   - regex HARD          → regex 终判，judge 不介入（advice/technical/ungrounded，红线不松动）。
 * judge 失败/超时/无法解析 = `unclear` → **回落 regex 判定**（PASS 仍出 / SOFT 仍降级），绝不因
 * judge 抖动制造新降级（"⑦ 稳定出现"是 BOSS 第一诉求）。
 *
 * 判官**只判意图**，不评文采、不判分析对错、不判数据真假（数据接地仍归 regex 的 ungrounded）。
 * 注入式 `interpret`（与⑦生成同一 haiku，但调用侧用温度0 求确定性）→ 可 mock 做对抗性单测。
 */

export type JudgeVerdict = 'pass' | 'block' | 'unclear';

export interface JudgeResult {
  /** pass=未越线；block=越线；unclear=判官失败/无法解析（回落 regex）。 */
  verdict: JudgeVerdict;
  /** 越的哪条红线：A=买卖引导 B=涨跌预测 both=两者 none=未越 unknown=解析不出。 */
  redline: 'none' | 'A' | 'B' | 'both' | 'unknown';
  /** 越线最短原文片段（脱敏排查用；pass/unclear 为空）。 */
  quote: string;
  /** 判官原始返回（排查用，可能为空）。 */
  raw: string;
}

export const INTENT_JUDGE_SYSTEM = `你是 A股内容合规判官。下面给你一段「分析师视角」状态画像文字，你只判断它是否越过两条红线，不评价文采、不判断分析对错、不判断数据真假：

【红线A · 买卖引导】是否在引导/建议/暗示用户做任何买卖持仓操作？（买入/卖出/持有/加仓/减仓/抄底/逃顶/止损/止盈/建仓/补仓/上车/割肉/"可以买"/"该卖"/"值得配置" 等）
【红线B · 涨跌预测】是否在预测未来价格走势？（会涨/会跌/将上行/迟早回落/有望突破/目标价X元/"空间已打开"/"只是时间问题"/"终将收敛" 等对**未来方向**的断言或暗示）

判定准则（关键，避免误杀合规内容）：
- 描述【已发生】的事实 → 放行：如"今日跌停""Q1营收同比增长23%""股价已从高点回落""近三年净利下滑"——过去式/现状陈述，不是预测。
- 陈述【当前状态/估值水位】→ 放行：如"PE-TTM 站上近5年99%高分位""市盈率低于行业中位""ROE处于中等水平"——客观状态，既非预测也非买卖引导。
- 客观【张力/矛盾并存】描述 → 放行：如"高估值与盈利下滑并存""短期反弹与长期下滑并存"——只要没落到"所以会跌/该卖/迟早回落"。
- 只有指向【未来动作建议】或【未来价格方向断言/暗示】才算越线。
- 拿不准、模棱两可时一律从严判 block。

只输出一行 JSON，不要任何多余文字、不要解释、不要 markdown 代码块：
{"verdict":"pass"或"block","redline":"none"或"A"或"B"或"both","quote":"越线最短原文片段，pass则空字符串"}`;

/**
 * 解析判官返回为结构化裁决。三级兜底：严格 JSON → 扫 verdict 关键词 → 中文合规词 → unclear。
 * 解析不出 verdict 一律 `unclear`（不臆断 block/pass），由调用侧按通道回落 regex。
 */
export function parseJudge(raw: string): JudgeResult {
  const text = (raw ?? '').trim();
  if (!text) return { verdict: 'unclear', redline: 'unknown', quote: '', raw: '' };

  // 1) 严格 JSON（取首个 {...} 块，容忍前后噪声）。
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const o = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const v = String(o.verdict ?? '').toLowerCase();
      if (v === 'pass' || v === 'block') {
        const rl = String(o.redline ?? '');
        return {
          verdict: v,
          redline: rl === 'none' || rl === 'A' || rl === 'B' || rl === 'both' ? rl : 'unknown',
          quote: typeof o.quote === 'string' ? o.quote : '',
          raw: text,
        };
      }
    } catch {
      /* 落到宽松兜底 */
    }
  }

  // 2) 宽松：扫 "verdict": "pass|block"。
  const vm = text.match(/verdict["'\s:：]*["']?(pass|block)/i);
  if (vm?.[1])
    return {
      verdict: vm[1].toLowerCase() as JudgeVerdict,
      redline: 'unknown',
      quote: '',
      raw: text,
    };

  // 3) 中文/裸词兜底。消解负向词（"未越线/不违规"=合规、"不合规/不通过"=越线，避免子串误判），
  //    仅单侧信号才判，两可 → unclear。
  const blockish = /(?<![未无没])越线|(?<!不)违规|不合规|不通过|\bblock\b/i.test(text);
  const passish = /未越线|不违规|(?<!不)合规|(?<!不)通过|放行|\bpass\b/i.test(text);
  if (blockish && !passish) return { verdict: 'block', redline: 'unknown', quote: '', raw: text };
  if (passish && !blockish) return { verdict: 'pass', redline: 'unknown', quote: '', raw: text };

  return { verdict: 'unclear', redline: 'unknown', quote: '', raw: text };
}

/**
 * 调用判官。`interpret`=注入的单次 LLM 调用（调用侧用温度0）。任何异常 → `unclear`（回落 regex）。
 */
export async function judgeIntent(
  interpret: (input: { system: string; user: string }) => Promise<string>,
  interpretation: string,
): Promise<JudgeResult> {
  try {
    const raw = await interpret({
      system: INTENT_JUDGE_SYSTEM,
      user: `【待判分析师视角原文】\n${interpretation}`,
    });
    return parseJudge(raw);
  } catch {
    return { verdict: 'unclear', redline: 'unknown', quote: '', raw: '' };
  }
}
