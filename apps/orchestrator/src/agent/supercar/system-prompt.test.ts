import { describe, expect, it } from 'vitest';

import { PLAN_SYSTEM } from './plan-service.js';
import { SUPERCAR_CORE_PROMPT, buildSupercarSystemPrompt } from './system-prompt.js';

describe('supercar system prompt safety boundaries', () => {
  it('keeps legacy operation tasks at the final confirmation boundary', () => {
    expect(SUPERCAR_CORE_PROMPT).toContain('取消订阅 / 填表');
    expect(SUPERCAR_CORE_PROMPT).toContain('最终确认页或草稿预览页');
    expect(SUPERCAR_CORE_PROMPT).toContain('Place order / Pay / Send / Confirm / Delete / Unsubscribe');
    expect(SUPERCAR_CORE_PROMPT).toContain('未点击最终提交/支付/发送/删除/退订');
    expect(SUPERCAR_CORE_PROMPT).toContain('不要替用户点击最终确认按钮');
  });

  it('keeps the composed legacy prompt aligned with the core guardrail', () => {
    const prompt = buildSupercarSystemPrompt({ intent: '帮我取消订阅这个会员' });
    expect(prompt).toContain('最终确认页或草稿预览页');
    expect(prompt).toContain('不要替用户点击最终确认按钮');
  });

  it('keeps first-frame plans from promising high-risk final clicks', () => {
    expect(PLAN_SYSTEM).toContain('到达最终确认页 / 草稿预览页并展示明细');
    expect(PLAN_SYSTEM).toContain('不要把"点击确认 / Place order / Pay / Send / Delete / Unsubscribe"列为步骤');
  });
});
