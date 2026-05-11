/**
 * Optimization #2 — OpenAI response layer unit tests.
 *
 * Coverage matches the spec:
 *   - Flag off → no LLM call, fallback original (metadata.fallbackReason=flag_off)
 *   - Short response → skipped (unless expert workflow)
 *   - Expert workflow short response → still triggers
 *   - Timeout → fallback original
 *   - Happy path → formatted text returned, no fallback
 *   - Post-check: new URL → fallback / new number → fallback /
 *     removed ⚠️ → fallback / removed source badge → fallback /
 *     removed follow-up marker → fallback / clean rewrite → pass
 */

import { describe, expect, it, vi } from 'vitest';
import {
  format,
  isResponseLayerEnabled,
  postCheck,
  shouldFormat,
  TRIGGER_MIN_LENGTH,
} from './openai-response-layer.js';

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

/** Build a fake OpenAI client whose chat.completions.create returns a fixed string. */
function makeFakeOpenAI(content: string | (() => Promise<string>)) {
  return {
    chat: {
      completions: {
        create: vi.fn(async () => {
          const c = typeof content === 'string' ? content : await content();
          return { choices: [{ message: { content: c } }] };
        }),
      },
    },
  };
}

const longOriginal =
  '抖音直播昨晚 GMV 50000 元，UV 3500，转化率 4.1%。'.repeat(8);

describe('shouldFormat — trigger rules', () => {
  it('flag off → false even for long expert workflow', () => {
    const env = { OPENAI_RESPONSE_LAYER_ENABLED: 'false', OPENAI_API_KEY: 'sk-x' };
    expect(
      shouldFormat(
        { original: longOriginal, terminalStatus: 'completed', expertWorkflowId: 'ecom-daily' },
        env,
      ),
    ).toBe(false);
  });

  it('flag on + no API key → false (missing_api_key path)', () => {
    const env = { OPENAI_RESPONSE_LAYER_ENABLED: 'true' };
    expect(
      shouldFormat({ original: longOriginal, terminalStatus: 'completed' }, env),
    ).toBe(false);
  });

  it('flag on + long response → true', () => {
    const env = { OPENAI_RESPONSE_LAYER_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' };
    expect(
      shouldFormat({ original: longOriginal, terminalStatus: 'completed' }, env),
    ).toBe(true);
  });

  it('flag on + short response + no workflow → false', () => {
    const env = { OPENAI_RESPONSE_LAYER_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' };
    expect(
      shouldFormat({ original: 'short answer', terminalStatus: 'completed' }, env),
    ).toBe(false);
  });

  it('flag on + short response + expert workflow → true (always trigger)', () => {
    const env = { OPENAI_RESPONSE_LAYER_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' };
    expect(
      shouldFormat(
        { original: 'short', terminalStatus: 'completed', expertWorkflowId: 'ecom-daily' },
        env,
      ),
    ).toBe(true);
  });

  it('failed / cancelled status still triggers (spec: 失败/取消结果也触发)', () => {
    const env = { OPENAI_RESPONSE_LAYER_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' };
    expect(
      shouldFormat({ original: longOriginal, terminalStatus: 'failed' }, env),
    ).toBe(true);
    expect(
      shouldFormat({ original: longOriginal, terminalStatus: 'cancelled' }, env),
    ).toBe(true);
  });
});

describe('format — runtime', () => {
  it('flag off → returns original unchanged, fallbackReason=flag_off, no API call', async () => {
    const client = makeFakeOpenAI('SHOULD NEVER FIRE');
    const r = await format(
      { original: longOriginal, terminalStatus: 'completed' },
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_RESPONSE_LAYER_ENABLED: 'false', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.formatted).toBe(longOriginal);
    expect(r.metadata.fallbackReason).toBe('flag_off');
    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });

  it('short response → skipped (fallbackReason=short_response, no API call)', async () => {
    const client = makeFakeOpenAI('SHOULD NEVER FIRE');
    const r = await format(
      { original: 'short', terminalStatus: 'completed' },
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_RESPONSE_LAYER_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.formatted).toBe('short');
    expect(r.metadata.fallbackReason).toBe('short_response');
    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });

  it('expert workflow short response → triggers (no skip)', async () => {
    const client = makeFakeOpenAI('polished short report');
    const r = await format(
      {
        original: 'short report',
        terminalStatus: 'completed',
        expertWorkflowId: 'ecom-daily',
      },
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_RESPONSE_LAYER_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.formatted).toBe('polished short report');
    expect(r.metadata.fallbackReason).toBeUndefined();
    expect(client.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('timeout / API error → fallback original with fallbackReason=timeout', async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            throw new Error('Request timeout after 10000ms');
          }),
        },
      },
    };
    const r = await format(
      { original: longOriginal, terminalStatus: 'completed' },
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_RESPONSE_LAYER_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.formatted).toBe(longOriginal);
    expect(r.metadata.fallbackReason).toBe('timeout');
  });

  it('generic API error → fallbackReason=api_error', async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            throw new Error('429 rate limited');
          }),
        },
      },
    };
    const r = await format(
      { original: longOriginal, terminalStatus: 'completed' },
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_RESPONSE_LAYER_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.metadata.fallbackReason).toBe('api_error');
  });

  it('empty output → fallback original (fallbackReason=empty_output)', async () => {
    const client = makeFakeOpenAI('   \n  ');
    const r = await format(
      { original: longOriginal, terminalStatus: 'completed' },
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_RESPONSE_LAYER_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.metadata.fallbackReason).toBe('empty_output');
    expect(r.formatted).toBe(longOriginal);
  });

  it('happy path: clean polish → returns formatted, no fallback', async () => {
    // Formatter rewrites with same URLs + numbers, no new content.
    const original =
      '昨日 GMV 是 50000 元，UV 3500。详情见 https://compass.example/report。';
    const polished =
      '昨日 GMV 50000 元，UV 3500。\n详情：https://compass.example/report';
    const client = makeFakeOpenAI(polished);
    const r = await format(
      { original, terminalStatus: 'completed', expertWorkflowId: 'ecom-daily' },
      { logger: fakeLogger, openaiClient: client },
      { OPENAI_RESPONSE_LAYER_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' },
    );
    expect(r.formatted).toBe(polished);
    expect(r.metadata.fallbackReason).toBeUndefined();
  });
});

describe('postCheck — deterministic guards', () => {
  it('clean rewrite (same URLs + numbers + markers) → ok', () => {
    const original = '⚠️ 数据异常\n详情见 https://example.com 总额 1000 元。';
    const formatted = '⚠️ 数据异常\n详情：https://example.com，金额 1000 元。';
    expect(postCheck(original, formatted)).toEqual({ ok: true });
  });

  it('new URL introduced → fallback (reason=new_url_introduced)', () => {
    const original = '抓取数据见 https://a.example';
    const formatted = '抓取数据见 https://a.example 和 https://b.example';
    const r = postCheck(original, formatted);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('new_url_introduced');
  });

  it('new number introduced → fallback (reason=new_number_introduced)', () => {
    const original = '昨日 GMV 50000 元';
    const formatted = '昨日 GMV 50000 元（同比 +3.2%）';
    const r = postCheck(original, formatted);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('new_number_introduced');
  });

  it('removed ⚠️ warning marker → fallback', () => {
    const original = '⚠️ 数据有异常\n报告内容...';
    const formatted = '数据有异常\n报告内容...'; // ⚠️ stripped
    const r = postCheck(original, formatted);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('warning_marker_removed');
  });

  it('removed 🟢 source badge → fallback', () => {
    const original = '🟢 用户提供\nGMV 50000 元';
    const formatted = '用户提供\nGMV 50000 元';
    const r = postCheck(original, formatted);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('source_badge_removed');
  });

  it('removed follow-up marker → fallback', () => {
    const original = '报告完成。\n<!-- HOLA_FOLLOW_UP_ACTIONS_START -->["再跑一次"]<!-- HOLA_FOLLOW_UP_ACTIONS_END -->';
    const formatted = '报告完成。';
    const r = postCheck(original, formatted);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('followup_marker_removed');
  });

  it('number normalization: "100,000" → "100000" still recognized', () => {
    // Formatter rewrote the comma-grouped form as bare digits.
    // Both should be recognized as the same value.
    const original = 'GMV 100,000 元';
    const formatted = 'GMV 100000 元';
    expect(postCheck(original, formatted)).toEqual({ ok: true });
  });

  it('URL re-quote (same URL, different surrounding punctuation) → ok', () => {
    const original = '详情见 https://example.com/path 。';
    const formatted = '详情见：https://example.com/path';
    expect(postCheck(original, formatted)).toEqual({ ok: true });
  });

  it('marker count can change as long as kind survives (formatter merged paragraphs)', () => {
    // Two ⚠️ paragraphs in original, one in formatted — still ok
    // because the marker KIND is preserved.
    const original = '⚠️ 异常一\n详情。\n\n⚠️ 异常二\n详情。';
    const formatted = '⚠️ 异常综述：异常一 + 异常二';
    expect(postCheck(original, formatted)).toEqual({ ok: true });
  });

  it('markdown ordered-list ordinals at line start are NOT treated as new numbers', () => {
    // Codex P2 follow-up — the formatter is allowed to re-number an
    // ordered list. "1." / "2." at line start are list markers, not
    // facts. Without this exclusion, the formatter adding an
    // ordered list (or renumbering one) silently fell back.
    const original = '主要发现：\n- GMV 50000 元\n- 转化率 4.1%';
    const formatted =
      '## 主要发现\n\n1. GMV 50000 元\n2. 转化率 4.1%';
    expect(postCheck(original, formatted)).toEqual({ ok: true });
  });

  it('markdown ordinals with leading indent (nested lists) are also stripped', () => {
    const original = 'GMV 50000';
    const formatted = '- 类别 A\n   1. 子项目\n   2. 另一项\nGMV 50000';
    expect(postCheck(original, formatted)).toEqual({ ok: true });
  });

  it('sentence-internal "1." (no surrounding ordinal pattern) still counts as a real number', () => {
    // "排名第 1. 抖音" has "1." mid-sentence — should still register
    // as the number 1; if the formatter adds a different number, fail.
    const original = '排名第 1 的是抖音';
    const formatted = '排名第 7 的是抖音'; // formatter "fixed" 1 → 7 (fabrication)
    const r = postCheck(original, formatted);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('new_number_introduced');
  });
});

describe('TRIGGER_MIN_LENGTH constant', () => {
  it('is 200 chars (matches spec)', () => {
    expect(TRIGGER_MIN_LENGTH).toBe(200);
  });
});

describe('isResponseLayerEnabled — caller-side flag gate (Codex P2)', () => {
  // Hoisted out of shouldFormat so the tasks.ts integration block
  // can short-circuit BEFORE touching the response layer (zero DB
  // writes for users who haven't opted into the feature).
  it('flag off → false (canonical reason for skipping the entire block)', () => {
    expect(isResponseLayerEnabled({ OPENAI_RESPONSE_LAYER_ENABLED: 'false', OPENAI_API_KEY: 'sk-x' })).toBe(false);
  });
  it('flag missing entirely → false', () => {
    expect(isResponseLayerEnabled({ OPENAI_API_KEY: 'sk-x' })).toBe(false);
  });
  it('flag on but missing API key → false (caller skips, no fallback metadata leaks)', () => {
    expect(isResponseLayerEnabled({ OPENAI_RESPONSE_LAYER_ENABLED: 'true' })).toBe(false);
  });
  it('flag on + key set → true (caller proceeds)', () => {
    expect(isResponseLayerEnabled({ OPENAI_RESPONSE_LAYER_ENABLED: 'true', OPENAI_API_KEY: 'sk-x' })).toBe(true);
  });
  it('accepts "1" as truthy (matches shouldFormat\'s flag parsing)', () => {
    expect(isResponseLayerEnabled({ OPENAI_RESPONSE_LAYER_ENABLED: '1', OPENAI_API_KEY: 'sk-x' })).toBe(true);
  });
  it('case-insensitive on flag value ("TRUE" / "True")', () => {
    expect(isResponseLayerEnabled({ OPENAI_RESPONSE_LAYER_ENABLED: 'TRUE', OPENAI_API_KEY: 'sk-x' })).toBe(true);
    expect(isResponseLayerEnabled({ OPENAI_RESPONSE_LAYER_ENABLED: 'True', OPENAI_API_KEY: 'sk-x' })).toBe(true);
  });
});
