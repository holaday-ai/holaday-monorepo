/**
 * Dev helper — 渲染 A股盘前/盘后简报示例（用示例 fixtures）.
 *
 * 用途：把渲染器实际输出导出给 BOSS + Claude 评审简报内容/版式/合规，
 * 并保证评审文档 docs/PHASE1_ASHARE_BRIEFING_V1.md 的样张 == 代码真实输出。
 *
 *   pnpm --filter @holaday/orchestrator exec tsx scripts/render-briefing-sample.ts
 */

import { POSTMARKET_SAMPLE, PREMARKET_SAMPLE } from '../src/agent/a-share/briefing-fixtures.js';
import {
  renderPostmarketBriefing,
  renderPremarketBriefing,
} from '../src/agent/a-share/briefing-renderer.js';

const SEP = '\n\n========================================\n\n';

// 用户版（prod，默认）—— 上线投递的就是这个，干净见客。
process.stdout.write('### prod（用户版）盘前\n\n');
process.stdout.write(renderPremarketBriefing(PREMARKET_SAMPLE));
process.stdout.write(SEP);
process.stdout.write('### prod（用户版）盘后\n\n');
process.stdout.write(renderPostmarketBriefing(POSTMARKET_SAMPLE));
process.stdout.write(SEP);
// dev 版（含 [dev] 诊断行）—— 仅评审/排查用。
process.stdout.write('### dev（诊断版）盘前\n\n');
process.stdout.write(renderPremarketBriefing(PREMARKET_SAMPLE, { mode: 'dev' }));
process.stdout.write('\n');
