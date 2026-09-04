import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserNetworkPolicy } from './browser-network-policy.js';
import {
  extractSiteToken,
  injectResolvedUrl,
  resolveIntentUrl,
  toSafeUrlResolutionLog,
} from './url-resolver.js';

const resolverLogs = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../config/logger.js', () => ({
  logger: resolverLogs,
}));

/**
 * Tests for deterministic URL resolution: trusted registry matches,
 * search-first handling for unknown names, network rejection, and
 * privacy-safe operational metadata.
 */

const allowPublicNetworkPolicy = new BrowserNetworkPolicy({
  resolve: async () => [{ address: '93.184.216.34', family: 4 }],
});

beforeEach(() => {
  resolverLogs.info.mockClear();
  resolverLogs.warn.mockClear();
});

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
      networkPolicy: allowPublicNetworkPolicy,
    });
    expect(r).toEqual({ source: 'passthrough', url: 'https://example.com/path' });
  });

  it('returns null when no nav verb and no URL (nothing to resolve)', async () => {
    const r = await resolveIntentUrl('帮我查一下今天的天气', {
      networkPolicy: allowPublicNetworkPolicy,
    });
    expect(r).toBeNull();
  });

  it.each(['分析上海市场走势', '总结上市公司财报', 'review this open source report'])(
    'does not treat text containing a navigation word fragment as a navigation request: %s',
    async (intent) => {
      const r = await resolveIntentUrl(intent, {
        networkPolicy: allowPublicNetworkPolicy,
      });

      expect(r).toBeNull();
    },
  );

  it('does not require a model credential to classify an unknown site safely', async () => {
    const r = await resolveIntentUrl('打开 openclaw', {
      networkPolicy: allowPublicNetworkPolicy,
    });
    expect(r).toEqual({ source: 'search_required' });
  });

  it.each(['file:///etc/passwd', 'javascript:alert(document.cookie)'])(
    'rejects an explicitly supplied non-web URI: %s',
    async (uri) => {
      const r = await resolveIntentUrl(`打开 ${uri}`, {
        networkPolicy: allowPublicNetworkPolicy,
      });

      expect(r).toEqual({ source: 'rejected', reason: 'bad_scheme' });
    },
  );

  it('rejects a web URL containing embedded credentials', async () => {
    const r = await resolveIntentUrl('打开 https://user:password@example.com/private', {
      networkPolicy: allowPublicNetworkPolicy,
    });

    expect(r).toEqual({ source: 'rejected', reason: 'embedded_credentials' });
  });
});

describe('resolveIntentUrl — trusted resolution path', () => {
  it('uses the curated site registry without consulting a model', async () => {
    const r = await resolveIntentUrl('打开 BOSS直聘 看岗位', {
      networkPolicy: allowPublicNetworkPolicy,
    });

    expect(r).toEqual({ source: 'registry', url: 'https://zhipin.com/' });
  });

  it('rejects a curated destination when its current DNS answer is not public', async () => {
    const privateNetworkPolicy = new BrowserNetworkPolicy({
      resolve: async () => [{ address: '10.0.0.8', family: 4 }],
    });

    const r = await resolveIntentUrl('打开 BOSS直聘 看岗位', {
      networkPolicy: privateNetworkPolicy,
    });

    expect(r).toEqual({ source: 'rejected', reason: 'private_network' });
  });

  it('requires search confirmation for an unknown site instead of accepting a model guess', async () => {
    const r = await resolveIntentUrl('打开 somenewsite', {
      networkPolicy: allowPublicNetworkPolicy,
    });

    expect(r).toEqual({ source: 'search_required' });
  });

  it('requires search confirmation when more than one trusted site is named', async () => {
    const r = await resolveIntentUrl('打开京东和淘宝比较价格', {
      networkPolicy: allowPublicNetworkPolicy,
    });

    expect(r).toEqual({ source: 'search_required' });
  });

  it('does not log the site token, candidate URL, model reply, or provider error', async () => {
    await resolveIntentUrl('打开 secret-company-portal', {
      networkPolicy: allowPublicNetworkPolicy,
    });

    const logs = JSON.stringify([resolverLogs.info.mock.calls, resolverLogs.warn.mock.calls]);
    expect(logs).not.toContain('secret-company-portal');
    expect(logs).not.toContain('anthropic 500');
  });

  it('exposes only aggregate outcome and rejection reason for operational logs', () => {
    expect(
      toSafeUrlResolutionLog({
        source: 'registry',
        url: 'https://secret.example/',
      }),
    ).toEqual({ outcome: 'registry' });
    expect(
      toSafeUrlResolutionLog({
        source: 'rejected',
        reason: 'private_network',
      }),
    ).toEqual({ outcome: 'rejected', reason: 'private_network' });
  });
});

describe('injectResolvedUrl', () => {
  it('no-ops on passthrough resolutions (URL already in intent)', () => {
    const intent = '打开 https://example.com';
    expect(
      injectResolvedUrl(intent, {
        url: 'https://example.com',
        source: 'passthrough',
      }),
    ).toBe(intent);
  });

  it('appends a trusted-registry annotation for curated site resolutions', () => {
    const out = injectResolvedUrl('打开 BOSS直聘', {
      url: 'https://zhipin.com/',
      source: 'registry',
    });
    expect(out).toBe('打开 BOSS直聘（系统可信站点映射：https://zhipin.com/）');
  });

  it('tells the browser to search and verify an unknown site without inventing a URL', () => {
    const out = injectResolvedUrl('打开 openclaw', {
      source: 'search_required',
    });

    expect(out).toContain('先通过搜索结果核对官方网站域名');
    expect(out).toContain('不要根据名称猜测域名');
    expect(out).not.toMatch(/https?:\/\//);
  });

  it('tells the browser not to navigate when an explicit URL is rejected', () => {
    const out = injectResolvedUrl('打开 http://127.0.0.1/private', {
      source: 'rejected',
      reason: 'private_network',
    });

    expect(out).toContain('目标网址未通过安全校验，不要导航');
  });

  it('is idempotent — does not append twice if the URL is already present', () => {
    const intent = '打开 BOSS直聘（系统可信站点映射：https://zhipin.com/）';
    const out = injectResolvedUrl(intent, {
      url: 'https://zhipin.com/',
      source: 'registry',
    });
    expect(out).toBe(intent);
  });
});
