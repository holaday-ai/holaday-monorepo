import { describe, expect, it } from 'vitest';

import { PLAN_SYSTEM } from './plan-service.js';
import { SUPERCAR_CORE_PROMPT, buildSupercarSystemPrompt } from './system-prompt.js';

describe('supercar system prompt safety boundaries', () => {
  it('keeps legacy operation tasks at the final confirmation boundary', () => {
    expect(SUPERCAR_CORE_PROMPT).toContain('取消订阅 / 填表 / 上传 / 下载 / 导出 / 分享文件');
    expect(SUPERCAR_CORE_PROMPT).toContain('最终确认页或草稿预览页');
    expect(SUPERCAR_CORE_PROMPT).toContain('Place order / Pay / Send / Confirm / Share / Change access / Delete / Unsubscribe');
    expect(SUPERCAR_CORE_PROMPT).toContain('未点击最终提交/支付/发送/分享/改权限/删除/退订');
    expect(SUPERCAR_CORE_PROMPT).toContain('不要替用户点击最终确认按钮');
  });

  it('keeps the composed legacy prompt aligned with the core guardrail', () => {
    const prompt = buildSupercarSystemPrompt({ intent: '帮我取消订阅这个会员' });
    expect(prompt).toContain('最终确认页或草稿预览页');
    expect(prompt).toContain('不要替用户点击最终确认按钮');
  });

  it('requires an exact identity before attributing fresh fund news', () => {
    expect(SUPERCAR_CORE_PROMPT).toContain('基金全称 + 代码 / ISIN / ticker 或官方产品页');
    expect(SUPERCAR_CORE_PROMPT).toContain('不得把泛市场新闻、相似名称或相关机构动态写成目标对象的近况');
  });

  it('keeps first-frame plans from promising high-risk final clicks', () => {
    expect(PLAN_SYSTEM).toContain('到达最终确认页 / 草稿预览页并展示明细');
    expect(PLAN_SYSTEM).toContain('不要把"点击确认 / Place order / Pay / Send / Share / Change access / Delete / Unsubscribe"列为步骤');
  });

  it('appends plan-aware file-format guidance verbatim (P1 honest degrade)', () => {
    const guidance = '【文件生成】TEST-GUIDANCE-MARKER';
    const layered = buildSupercarSystemPrompt({ intent: '生成一个 PDF', layered: true, fileFormatGuidance: guidance });
    expect(layered).toContain('TEST-GUIDANCE-MARKER');
    const legacy = buildSupercarSystemPrompt({ intent: '生成一个 PDF', fileFormatGuidance: guidance });
    expect(legacy).toContain('TEST-GUIDANCE-MARKER');
    // No guidance → no trailing marker, prompt still builds.
    const none = buildSupercarSystemPrompt({ intent: '生成一个 PDF', layered: true });
    expect(none).not.toContain('TEST-GUIDANCE-MARKER');
  });

  it('keeps the forced expert quality contract in browser-mode prompts', () => {
    const prompt = buildSupercarSystemPrompt({
      intent: '研究竞品落地页并给出优化建议',
      layered: true,
      expertMode: 'expert',
    });

    expect(prompt).toContain('专家模式质量合同');
    expect(prompt).toContain('[模型假设]');
  });
});
