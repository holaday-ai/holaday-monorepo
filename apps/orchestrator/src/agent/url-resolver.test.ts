import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  extractSiteToken,
  injectResolvedUrl,
  resolveIntentUrl,
} from './url-resolver.js';

/**
 * Tests for the url-resolver's surface: token extraction, passthrough
 * when a full URL is present, model-call happy path, and safe-null on
 * failure. No real Anthropic client — we hand-roll a fake `messages`.
 */

function fakeClient(textReply: string): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: textReply }],
        stop_reason: 'end_turn',
      }),
    },
  } as unknown as Anthropic;
}

function throwingClient(): Anthropic {
  return {
    messages: {
      create: async () => {
        throw new Error('anthropic 500');
      },
    },
  } as unknown as Anthropic;
}

describe('extractSiteToken', () => {
  it('strips CN nav verbs and returns the next word', () => {
    expect(extractSiteToken('打开 openclaw 看最新版本')).toBe('openclaw');
    expect(extractSiteToken('访问 BOSS直聘')).toBe('BOSS直聘');
  });

  it('strips EN nav verbs case-insensitively', () => {
    expect(extractSiteToken('Open OpenClaw and check the repo')).toBe('OpenClaw');
    expect(extractSiteToken('go to reddit r/programming')).toBe('reddit');
  });

  it('prefers a domain-shaped token when present', () => {
    expect(extractSiteToken('打开 openclaw.com 的主页')).toBe('openclaw.com');
  });

  it('prefers a quoted name over verb stripping', () => {
    expect(extractSiteToken('帮我打开 "万得金融终端" 首页')).toBe('万得金融终端');
  });

  it('returns empty string for a verb-less intent', () => {
    // "查股价" doesn't imply a specific URL — caller treats '' as skip.
    // We strip "查" as non-verb so the whole thing comes through.
    const out = extractSiteToken('');
    expect(out).toBe('');
  });
});

describe('resolveIntentUrl — passthrough', () => {
  it('returns the embedded URL unchanged when the intent already has one', async () => {
    const r = await resolveIntentUrl('打开 https://example.com/path 看看', {
      client: fakeClient('should not be called'),
    });
    expect(r?.source).toBe('passthrough');
    expect(r?.url).toBe('https://example.com/path');
  });

  it('returns null when no nav verb and no URL (nothing to resolve)', async () => {
    const r = await resolveIntentUrl('帮我查一下今天的天气', {
      client: fakeClient('https://weather.com'),
    });
    expect(r).toBeNull();
  });

  it('returns null when client is null (no API key in env)', async () => {
    const r = await resolveIntentUrl('打开 openclaw', { client: null });
    expect(r).toBeNull();
  });
});

describe('resolveIntentUrl — model-call path', () => {
  it('returns the URL the model picked when intent needs resolution', async () => {
    const r = await resolveIntentUrl('打开 openclaw 看新版本', {
      client: fakeClient('https://openclaw.org'),
    });
    expect(r?.source).toBe('model');
    expect(r?.url).toBe('https://openclaw.org');
    expect(r?.token).toBe('openclaw');
  });

  it('returns null when the model declines (empty reply)', async () => {
    const r = await resolveIntentUrl('打开 somenewsite', {
      client: fakeClient(''),
    });
    expect(r).toBeNull();
  });

  it('returns null (never throws) when the model errors', async () => {
    const r = await resolveIntentUrl('打开 openclaw', {
      client: throwingClient(),
    });
    expect(r).toBeNull();
  });
});

describe('injectResolvedUrl', () => {
  it('no-ops on passthrough resolutions (URL already in intent)', () => {
    const intent = '打开 https://example.com';
    expect(
      injectResolvedUrl(intent, {
        url: 'https://example.com',
        token: 'https://example.com',
        source: 'passthrough',
      }),
    ).toBe(intent);
  });

  it('appends a system-confirmed URL annotation for model resolutions', () => {
    const out = injectResolvedUrl('打开 openclaw', {
      url: 'https://openclaw.org',
      token: 'openclaw',
      source: 'model',
    });
    expect(out).toMatch(/打开 openclaw（系统确认 URL: https:\/\/openclaw\.org）/);
  });

  it('is idempotent — does not append twice if the URL is already present', () => {
    const intent = '打开 openclaw（系统确认 URL: https://openclaw.org）';
    const out = injectResolvedUrl(intent, {
      url: 'https://openclaw.org',
      token: 'openclaw',
      source: 'model',
    });
    expect(out).toBe(intent);
  });
});
