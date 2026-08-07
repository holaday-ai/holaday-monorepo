import { describe, expect, it } from 'vitest';
import {
  extractDirectOpenUrl,
  extractRunnableDirectOpenUrl,
  directOpenUrlSafetyMessage,
  verifyDirectOpenUrlSafety,
  offlineBrowserUnavailableMessage,
  runDirectOpen,
} from './direct-open.js';

describe('extractDirectOpenUrl', () => {
  it('extracts an explicit URL from a simple open command', () => {
    expect(extractDirectOpenUrl('打开 https://example.com')).toBe('https://example.com/');
    expect(extractDirectOpenUrl('Open http://example.com/path')).toBe(
      'http://example.com/path',
    );
  });

  it('does not claim multi-step browser work', () => {
    expect(extractDirectOpenUrl('打开 https://example.com 然后搜索新闻')).toBeNull();
    expect(extractDirectOpenUrl('比较 https://a.example 和 https://b.example')).toBeNull();
  });

  it('does not absorb Chinese instructions after the URL into a direct-open command', () => {
    expect(
      extractDirectOpenUrl(
        '打开 https://www.zhihu.com/signin；如果需要登录就停下来，不要填写账号密码',
      ),
    ).toBeNull();
    expect(
      extractDirectOpenUrl(
        '打开 https://httpbin.org/status/403，看看返回了什么。如果没有权限，请停下来',
      ),
    ).toBeNull();
  });

  it('rejects non-http protocols', () => {
    expect(extractDirectOpenUrl('打开 javascript:alert(1)')).toBeNull();
    expect(extractDirectOpenUrl('打开 file:///etc/passwd')).toBeNull();
  });

  it('preserves valid URL punctuation while accepting Chinese sentence punctuation', () => {
    expect(extractDirectOpenUrl('打开 https://example.com/release.')).toBe(
      'https://example.com/release.',
    );
    expect(extractDirectOpenUrl('打开 https://example.com/path。')).toBe(
      'https://example.com/path',
    );
    expect(extractDirectOpenUrl('打开 https://example.com/path！')).toBe(
      'https://example.com/path',
    );
  });

  it('blocks loopback, private-network, and metadata targets', () => {
    expect(directOpenUrlSafetyMessage('http://localhost:3000/')).toMatch(/本机.*内网/);
    expect(directOpenUrlSafetyMessage('http://127.0.0.1:4001/healthz')).toMatch(
      /本机.*内网/,
    );
    expect(directOpenUrlSafetyMessage('http://10.0.0.8/')).toMatch(/本机.*内网/);
    expect(directOpenUrlSafetyMessage('http://169.254.169.254/latest/meta-data/')).toMatch(
      /本机.*内网/,
    );
    expect(directOpenUrlSafetyMessage('http://[::1]/')).toMatch(/本机.*内网/);
    expect(directOpenUrlSafetyMessage('http://[::ffff:127.0.0.1]/')).toMatch(
      /本机.*内网/,
    );
    expect(directOpenUrlSafetyMessage('https://example.com/')).toBeNull();
  });

  it('blocks a public-looking hostname when DNS resolves it to an internal address', async () => {
    await expect(
      verifyDirectOpenUrlSafety('https://public-looking.example/', {
        check: async () => ({
          allowed: false,
          reason: 'private_network',
          message: 'blocked after DNS verification',
        }),
      }),
    ).resolves.toBe('blocked after DNS verification');
  });
});

describe('extractRunnableDirectOpenUrl', () => {
  it('never bypasses the user confirmation required by plan mode', () => {
    expect(
      extractRunnableDirectOpenUrl('打开 https://example.com', 'plan'),
    ).toBeNull();
    expect(
      extractRunnableDirectOpenUrl('打开 https://example.com', 'auto'),
    ).toBe('https://example.com/');
    expect(
      extractRunnableDirectOpenUrl('打开 https://example.com', undefined),
    ).toBe('https://example.com/');
  });
});

describe('offlineBrowserUnavailableMessage', () => {
  it('rejects model-dependent browser work before a fake task is created', () => {
    expect(offlineBrowserUnavailableMessage(false)).toMatch(/未创建任务/);
    expect(offlineBrowserUnavailableMessage(true)).toBeNull();
  });
});

describe('runDirectOpen', () => {
  it('navigates, captures the live page, and returns terminal evidence', async () => {
    const calls: string[] = [];
    const page = {
      url: () => 'https://example.com/final',
    };
    const result = await runDirectOpen(
      {
        resetPageForTask: async () => {
          calls.push('reset');
        },
        getPage: async () => page,
        navigate: async (_page, url) => {
          calls.push(`navigate:${url}`);
          return { ok: true };
        },
        screenshot: async () => ({
          base64: 'real-frame',
          viewportWidth: 1280,
          viewportHeight: 800,
        }),
      },
      'https://example.com',
    );

    expect(calls).toEqual(['reset', 'navigate:https://example.com']);
    expect(result).toEqual({
      finalUrl: 'https://example.com/final',
      finalScreenshot: 'real-frame',
      finalViewport: { width: 1280, height: 800 },
    });
  });

  it('keeps the current page context when continuing in an adopted browser', async () => {
    const calls: string[] = [];
    const page = { url: () => 'https://example.com/continued' };

    await runDirectOpen(
      {
        resetPageForTask: async () => {
          calls.push('reset');
        },
        getPage: async () => page,
        navigate: async (_page, url) => {
          calls.push(`navigate:${url}`);
          return { ok: true };
        },
        screenshot: async () => ({ base64: 'continued-frame' }),
      },
      'https://example.com/continued',
      { preserveExistingPage: true },
    );

    expect(calls).toEqual(['navigate:https://example.com/continued']);
  });

  it('fails immediately when navigation does not succeed', async () => {
    const page = { url: () => 'about:blank' };
    await expect(
      runDirectOpen(
        {
          resetPageForTask: async () => {},
          getPage: async () => page,
          navigate: async () => ({ ok: false, message: 'DNS failed' }),
          screenshot: async () => ({}),
        },
        'https://example.invalid',
      ),
    ).rejects.toThrow('DNS failed');
  });
});
