import { describe, expect, it, vi } from 'vitest';
import {
  buildPayload,
  formatPresetMessage,
  maskWebhookUrl,
  sendWebhook,
  substituteTemplate,
  type WebhookChannel,
  type WebhookContext,
} from './webhook-sender.js';

const CTX: WebhookContext = {
  title: '定时任务完成',
  message: '已成功执行：抓取今日新闻',
  status: 'success',
  taskName: '每日新闻',
};

describe('formatPresetMessage', () => {
  it('composes lines from non-empty fields', () => {
    const out = formatPresetMessage(CTX);
    expect(out).toContain('【定时任务完成】');
    expect(out).toContain('任务：每日新闻');
    expect(out).toContain('已成功执行：抓取今日新闻');
    expect(out).not.toContain('状态');
  });

  it('appends "(状态：失败)" for failed status', () => {
    const out = formatPresetMessage({ ...CTX, status: 'failed' });
    expect(out).toContain('(状态：失败)');
  });

  it('appends "(状态：提醒)" for reminder status', () => {
    const out = formatPresetMessage({ ...CTX, status: 'reminder' });
    expect(out).toContain('(状态：提醒)');
  });

  it('skips empty fields cleanly (no "undefined" in output)', () => {
    const out = formatPresetMessage({ ...CTX, title: '', taskName: '' });
    expect(out).not.toContain('undefined');
    expect(out).not.toContain('【】');
    expect(out).toContain('已成功执行');
  });
});

describe('substituteTemplate', () => {
  it('replaces all four placeholders in a string', () => {
    const out = substituteTemplate('{{title}}: {{message}} [{{status}}] @ {{taskName}}', CTX);
    expect(out).toBe('定时任务完成: 已成功执行：抓取今日新闻 [success] @ 每日新闻');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(substituteTemplate('{{  title  }}', CTX)).toBe('定时任务完成');
  });

  it('walks nested objects + arrays', () => {
    const out = substituteTemplate(
      {
        msgtype: 'markdown',
        content: ['# {{title}}', { line: '{{message}}', tag: '{{status}}' }],
      },
      CTX,
    );
    expect(out).toEqual({
      msgtype: 'markdown',
      content: [
        '# 定时任务完成',
        { line: '已成功执行：抓取今日新闻', tag: 'success' },
      ],
    });
  });

  it('leaves unknown placeholders intact', () => {
    expect(substituteTemplate('{{unknown}} and {{message}}', CTX)).toBe(
      '{{unknown}} and 已成功执行：抓取今日新闻',
    );
  });

  it('passes through numbers / booleans / null', () => {
    expect(substituteTemplate({ n: 42, b: true, x: null }, CTX)).toEqual({
      n: 42,
      b: true,
      x: null,
    });
  });

  it('does not mutate the input', () => {
    const tpl = { line: '{{title}}' };
    substituteTemplate(tpl, CTX);
    expect(tpl).toEqual({ line: '{{title}}' });
  });
});

describe('buildPayload — preset wire shapes', () => {
  const url = 'https://example.test/webhook';
  it('wecom: msgtype=text + text.content', () => {
    const body = buildPayload({ platform: 'wecom', webhookUrl: url }, CTX) as {
      msgtype: string;
      text: { content: string };
    };
    expect(body.msgtype).toBe('text');
    expect(body.text.content).toContain('已成功执行');
  });

  it('feishu: msg_type=text + content.text', () => {
    const body = buildPayload({ platform: 'feishu', webhookUrl: url }, CTX) as {
      msg_type: string;
      content: { text: string };
    };
    expect(body.msg_type).toBe('text');
    expect(body.content.text).toContain('已成功执行');
  });

  it('dingtalk: msgtype=text + text.content', () => {
    const body = buildPayload({ platform: 'dingtalk', webhookUrl: url }, CTX) as {
      msgtype: string;
      text: { content: string };
    };
    expect(body.msgtype).toBe('text');
    expect(body.text.content).toContain('已成功执行');
  });

  it('custom: substitutes placeholders in the template', () => {
    const body = buildPayload(
      {
        platform: 'custom',
        webhookUrl: url,
        customTemplate: { text: '{{title}} - {{message}}' },
      },
      CTX,
    );
    expect(body).toEqual({ text: '定时任务完成 - 已成功执行：抓取今日新闻' });
  });

  it('custom: throws when template is missing', () => {
    expect(() =>
      buildPayload({ platform: 'custom', webhookUrl: url }, CTX),
    ).toThrow(/customTemplate/);
  });
});

describe('sendWebhook — HTTP behaviour', () => {
  const channel: WebhookChannel = {
    platform: 'wecom',
    webhookUrl: 'https://example.test/wecom',
  };

  it('returns ok=true on 200 first attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const res = await sendWebhook(channel, CTX, {
      fetch: fetchMock as typeof fetch,
      maxAttempts: 2,
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.attempt).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries once on 5xx then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const res = await sendWebhook(channel, CTX, {
      fetch: fetchMock as typeof fetch,
      maxAttempts: 2,
    });
    expect(res.ok).toBe(true);
    expect(res.attempt).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 4xx (permanent)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad', { status: 401 }));
    const res = await sendWebhook(channel, CTX, {
      fetch: fetchMock as typeof fetch,
      maxAttempts: 2,
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.attempt).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.error).toContain('permanent');
  });

  it('retries on network error then surfaces failure', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await sendWebhook(channel, CTX, {
      fetch: fetchMock as typeof fetch,
      maxAttempts: 2,
    });
    expect(res.ok).toBe(false);
    expect(res.attempt).toBe(2);
    expect(res.error).toBe('ECONNREFUSED');
  });

  it('never throws on a custom-template-missing channel — returns ok=false', async () => {
    const fetchMock = vi.fn();
    const res = await sendWebhook(
      { platform: 'custom', webhookUrl: 'https://example.test/x' },
      CTX,
      { fetch: fetchMock as typeof fetch },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('customTemplate');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('maskWebhookUrl', () => {
  it('masks a valid URL keeping host + last 6 chars', () => {
    expect(
      maskWebhookUrl(
        'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=ABCD-EFGH',
      ),
    ).toBe('qyapi.weixin.qq.com/...D-EFGH');
  });

  it('handles a malformed URL by trimming to first/last 6', () => {
    // 25-char input → slice(0,6) = 'not_a_', slice(-6) = 'enough'
    expect(maskWebhookUrl('not_a_url_but_long_enough')).toBe('not_a_...enough');
  });

  it('returns short input unchanged', () => {
    expect(maskWebhookUrl('short')).toBe('short');
  });
});
