import { describe, expect, it } from 'vitest';
import { processors } from './processors.js';

const PROCESSOR_IDS = [
  'holaday_internal',
  'anthropic',
  'openai',
  'google',
  'dashscope',
  'fal_ai',
  'divineapi',
  'firecrawl',
  'apify',
  'zapier',
  'resend',
  'sms_gateway',
  'paypal',
  'china_payment',
  'wecom',
  'feishu',
  'dingtalk',
  'custom_webhook',
  'vultr',
  'cloudflare_r2',
  'aliyun',
] as const;

describe('processor registry', () => {
  it('registers the approved processor inventory exactly once', () => {
    expect(processors.map((item) => item.id)).toEqual(PROCESSOR_IDS);
  });

  it('records conditions as config key names without values', () => {
    const json = JSON.stringify(processors);
    expect(json).toContain('DIVINE_API_KEY');
    expect(json).toContain('APIFY_API_TOKEN');
    expect(json).not.toMatch(/sk-[A-Za-z0-9]{12,}|-----BEGIN .*PRIVATE KEY-----/);
  });

  it('keeps legal status separate from code verification', () => {
    for (const processor of processors.filter((item) => item.id !== 'holaday_internal')) {
      expect(['unknown', 'pending_legal_review']).toContain(processor.legalReviewStatus);
    }
  });
});
