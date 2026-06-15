/**
 * Phase 2 ⑦ — 总市值「万亿」口径单测（mega-cap 接地一致性，勿删）.
 *
 * 修复前 ⑤ 用 fmtNum 呈现「18,402.50亿」，⑦ 天然说「1.84万亿」→ 合规闸门裸值比 1.84≠18402
 * 误判 ungrounded（千亿级以上个股 ⑦ 必降级）。fmtMvYi 统一为「万亿」口径，⑦ 照抄即接地。
 */

import { describe, expect, it } from 'vitest';
import { fmtMvYi } from './ashare-format.js';

describe('fmtMvYi（总市值万亿口径，勿删）', () => {
  it('≥1万亿 → X.XX万亿；<1万亿 → 沿用 fmtNum 的「亿」格式', () => {
    expect(fmtMvYi(18402.5)).toBe('1.84万亿'); // 宁德时代
    expect(fmtMvYi(16000)).toBe('1.60万亿'); // 贵州茅台量级
    expect(fmtMvYi(10000)).toBe('1.00万亿'); // 阈值边界
    expect(fmtMvYi(9999)).toBe('9,999.00亿'); // 临界下沿，仍走亿
    expect(fmtMvYi(34.47)).toBe('34.47亿'); // 小盘
    expect(fmtMvYi(null)).toBe('—');
  });
});
