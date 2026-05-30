/**
 * F1 — guards the `classifyReplyIntent` heuristic that drives whether
 * `tasks.reply` lands in supercarHandoffToGenerate (user supplied
 * data, exit browser path) or supercarReply (continue browser).
 * False-positives on manual_data abort a working browser session, so
 * the bar for handoff is intentionally high.
 */

import { describe, expect, it } from 'vitest';
import { classifyReplyIntent, normalizeModeBPingOutcome } from './tasks.js';

describe('classifyReplyIntent', () => {
  describe('manual_data', () => {
    it('matches "数据如下" phrase', () => {
      expect(classifyReplyIntent('数据如下: 一些数字')).toBe('manual_data');
    });

    it('matches "我直接给你数据"', () => {
      expect(classifyReplyIntent('我直接给你数据')).toBe('manual_data');
    });

    it('matches "用我上传的表格"', () => {
      expect(classifyReplyIntent('用我上传的表格做复盘')).toBe('manual_data');
    });

    it('matches "不用登录" — user opts out of browser', () => {
      expect(classifyReplyIntent('不用登录，我自己给数据')).toBe('manual_data');
    });

    it('matches English "here is the data"', () => {
      expect(classifyReplyIntent("Here's the data: GMV 156k")).toBe('manual_data');
    });

    it('matches ≥3 numeric figures with unit hints', () => {
      const msg = 'GMV ¥156,832, UV 28,592, ROI 1:3.2, 转化率 2.8%';
      expect(classifyReplyIntent(msg)).toBe('manual_data');
    });

    it('matches multiple key:value lines', () => {
      const msg = ['GMV: 156832', 'UV: 28592', 'ROI: 3.2'].join('\n');
      expect(classifyReplyIntent(msg)).toBe('manual_data');
    });
  });

  describe('login_completed', () => {
    it('matches "扫完了"', () => {
      expect(classifyReplyIntent('扫完了')).toBe('login_completed');
    });

    it('matches "登录好了"', () => {
      expect(classifyReplyIntent('登录好了')).toBe('login_completed');
    });

    it('matches "已登录"', () => {
      expect(classifyReplyIntent('已登录')).toBe('login_completed');
    });

    it('matches English "logged in"', () => {
      expect(classifyReplyIntent('logged in')).toBe('login_completed');
    });

    it('does NOT match a long message that mentions login as part of context', () => {
      // The 30-char cap dodges this false positive.
      const long =
        '我已经登录进去了，但页面显示访问被拒绝，可能是账号权限不够，需要换一个号';
      expect(classifyReplyIntent(long)).not.toBe('login_completed');
    });
  });

  describe('still_awaiting (Fix 2)', () => {
    it('matches "还没登录"', () => {
      expect(classifyReplyIntent('还没登录')).toBe('still_awaiting');
    });

    it('matches "等一下"', () => {
      expect(classifyReplyIntent('等一下')).toBe('still_awaiting');
    });

    it('matches "稍等"', () => {
      expect(classifyReplyIntent('稍等')).toBe('still_awaiting');
    });

    it('matches "稍等，我还在操作"', () => {
      expect(classifyReplyIntent('稍等，我还在操作')).toBe('still_awaiting');
    });

    it('matches "还没登录，等一下"', () => {
      expect(classifyReplyIntent('还没登录，等一下')).toBe('still_awaiting');
    });

    it('matches "马上好"', () => {
      expect(classifyReplyIntent('马上好')).toBe('still_awaiting');
    });

    it('matches "我还在登录"', () => {
      expect(classifyReplyIntent('我还在登录')).toBe('still_awaiting');
    });

    it('matches English "wait a sec"', () => {
      expect(classifyReplyIntent('wait a sec')).toBe('still_awaiting');
    });

    it('matches English "hold on"', () => {
      expect(classifyReplyIntent('hold on')).toBe('still_awaiting');
    });

    it('matches English "not yet"', () => {
      expect(classifyReplyIntent('not yet')).toBe('still_awaiting');
    });

    it('does NOT match "登录好了" (login completed wins)', () => {
      expect(classifyReplyIntent('登录好了')).toBe('login_completed');
    });

    it('does NOT match a long message that incidentally contains "稍等"', () => {
      // Realistic paste: user types substantive content that happens to
      // include "稍等" as a polite preamble. Length cap (50 chars) keeps
      // still_awaiting bound to short acks; this 80+-char message
      // classifies on the numeric structural signal instead.
      const long =
        '请稍等片刻，下面是昨晚直播的核心数据。GMV ¥156,832，UV 28,592，ROI 1:3.2，转化率 2.8%，主播话术节奏稳定。';
      expect(classifyReplyIntent(long)).not.toBe('still_awaiting');
    });
  });

  describe('default', () => {
    it('treats casual short replies as default', () => {
      expect(classifyReplyIntent('好的')).toBe('default');
      expect(classifyReplyIntent('继续')).toBe('default');
      expect(classifyReplyIntent('OK')).toBe('default');
    });

    it('treats numbered step list as default (not manual_data)', () => {
      // 1. / 2. / 3. without unit hints — bare list, not metrics.
      const msg = ['1. 先打开页面', '2. 然后点登录', '3. 输入密码'].join('\n');
      expect(classifyReplyIntent(msg)).toBe('default');
    });

    it('treats free-form clarifications as default', () => {
      const msg = '我希望复盘的是带货直播，不是知识分享类的';
      expect(classifyReplyIntent(msg)).toBe('default');
    });

    it('handles empty message', () => {
      expect(classifyReplyIntent('')).toBe('default');
      expect(classifyReplyIntent('   ')).toBe('default');
    });
  });
});

describe('normalizeModeBPingOutcome', () => {
  it('accepts a complete extension navigate result', () => {
    expect(
      normalizeModeBPingOutcome({
        ok: true,
        result: {
          finalUrl: ' https://example.com/path ',
          title: ' Example Domain ',
          bodyText: ' hello ',
        },
      }),
    ).toEqual({
      ok: true,
      finalUrl: 'https://example.com/path',
      title: 'Example Domain',
      bodyText: 'hello',
    });
  });

  it('preserves extension failures with stable fallback codes', () => {
    expect(
      normalizeModeBPingOutcome({
        ok: false,
        error: { message: '浏览器当前没有活动标签页', code: 'no_active_tab' },
      }),
    ).toEqual({
      ok: false,
      error: { message: '浏览器当前没有活动标签页', code: 'no_active_tab' },
    });
    expect(normalizeModeBPingOutcome({ ok: false })).toEqual({
      ok: false,
      error: { message: '浏览器扩展执行失败，请稍后重试', code: 'unknown' },
    });
  });

  it('rejects malformed success payloads instead of reporting a false pass', () => {
    expect(normalizeModeBPingOutcome({ ok: true, result: null })).toEqual({
      ok: false,
      error: { message: '浏览器扩展返回结果不完整，请重试', code: 'malformed_result' },
    });
    expect(
      normalizeModeBPingOutcome({
        ok: true,
        result: { finalUrl: 'chrome://extensions', title: 'Extensions', bodyText: '' },
      }),
    ).toEqual({
      ok: false,
      error: { message: '浏览器扩展没有返回有效页面地址，请重试', code: 'malformed_result' },
    });
  });

  it('bounds returned title, body, and url fields', () => {
    const normalized = normalizeModeBPingOutcome({
      ok: true,
      result: {
        finalUrl: `https://example.com/${'a'.repeat(3000)}`,
        title: 't'.repeat(400),
        bodyText: 'b'.repeat(13_000),
      },
    });

    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.finalUrl).toHaveLength(2048);
      expect(normalized.title).toHaveLength(300);
      expect(normalized.bodyText).toHaveLength(12_000);
    }
  });
});
