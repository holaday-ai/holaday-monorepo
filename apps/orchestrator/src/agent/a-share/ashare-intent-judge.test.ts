/**
 * Phase 2 ⑦ — 意图判官单测（regex 之后第二层）.
 *
 * parseJudge 三级兜底解析 + judgeIntent 异常→unclear（回落 regex，绝不臆断 block/pass）。
 * 越线泄漏对抗（buy/sell/predict 文本→judge 应 block）由 runner 双层测 + 产品路径对抗复审覆盖。
 */

import { describe, expect, it } from 'vitest';
import { INTENT_JUDGE_SYSTEM, judgeIntent, parseJudge } from './ashare-intent-judge.js';

describe('parseJudge（判官裁决解析，三级兜底，勿删）', () => {
  it('严格 JSON：pass / block + redline + quote', () => {
    const p = parseJudge('{"verdict":"pass","redline":"none","quote":""}');
    expect(p.verdict).toBe('pass');
    expect(p.redline).toBe('none');
    const b = parseJudge('{"verdict":"block","redline":"B","quote":"迟早会回落"}');
    expect(b.verdict).toBe('block');
    expect(b.redline).toBe('B');
    expect(b.quote).toBe('迟早会回落');
  });

  it('容忍前后噪声 / 代码块包裹的 JSON', () => {
    expect(
      parseJudge('```json\n{"verdict":"block","redline":"A","quote":"建议买入"}\n```').verdict,
    ).toBe('block');
    expect(parseJudge('结论：{"verdict":"pass","redline":"none","quote":""} 完毕').verdict).toBe(
      'pass',
    );
  });

  it('宽松：裸 verdict 关键词', () => {
    expect(parseJudge('verdict: block').verdict).toBe('block');
    expect(parseJudge('"verdict":"pass"').verdict).toBe('pass');
  });

  it('中文兜底：仅单侧信号词才判', () => {
    expect(parseJudge('该段越线，预测了涨跌').verdict).toBe('block');
    expect(parseJudge('内容合规，未越线').verdict).toBe('pass');
  });

  it('无法判定 → unclear（不臆断）', () => {
    expect(parseJudge('').verdict).toBe('unclear');
    expect(parseJudge('我不太确定这段内容怎么算').verdict).toBe('unclear');
    expect(parseJudge('既像合规又像越线，模棱两可').verdict).toBe('unclear'); // 两侧都有→不判
    expect(parseJudge('{"verdict":"maybe"}').verdict).toBe('unclear'); // 非法 verdict 值
  });
});

describe('judgeIntent（注入式调用，异常→unclear，勿删）', () => {
  it('interpret 返回 block JSON → block', async () => {
    const r = await judgeIntent(
      async () => '{"verdict":"block","redline":"B","quote":"会涨"}',
      '会涨到 50 元',
    );
    expect(r.verdict).toBe('block');
  });

  it('interpret 抛错 → unclear（回落 regex，不制造新降级）', async () => {
    const r = await judgeIntent(async () => {
      throw new Error('timeout');
    }, '任意文本');
    expect(r.verdict).toBe('unclear');
  });

  it('interpret 返回垃圾 → unclear', async () => {
    const r = await judgeIntent(async () => '抱歉，我无法回答这个问题', '任意文本');
    expect(r.verdict).toBe('unclear');
  });

  it('判官收到 INTENT_JUDGE_SYSTEM + user 含待判原文', async () => {
    let seen: { system: string; user: string } | undefined;
    await judgeIntent(async (i) => {
      seen = i;
      return '{"verdict":"pass","redline":"none","quote":""}';
    }, '迪生力估值处历史高位');
    expect(seen?.system).toBe(INTENT_JUDGE_SYSTEM);
    expect(seen?.system).toContain('合规判官');
    expect(seen?.user).toContain('迪生力估值处历史高位');
  });
});
