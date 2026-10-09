import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  token: vi.fn(async () => 'TEST_OWNER'),
  validate: vi.fn(async () => ({ url: 'https://fixture.test/' })),
}));
vi.mock('../shared/storage.js', () => ({ getAccessToken: mocks.token }));
vi.mock('./selected-tab-read.js', () => ({ validateSelectedTab: mocks.validate }));
vi.mock('../shared/config.js', () => ({
  ORCHESTRATOR_HTTP: 'https://api.fixture.test',
  LOCAL_CHROME_QA: false,
}));
import { importSelectedSession } from './session-import.js';
afterEach(() => vi.unstubAllGlobals());
describe('selected site import direct HTTP boundary', () => {
  it('only collects selected-site cookies and returns metadata, never values', async () => {
    const cookie = {
      name: 'sid',
      value: 'SYNTHETIC_ONLY',
      domain: 'fixture.test',
      path: '/',
      secure: true,
      httpOnly: true,
      hostOnly: true,
      session: true,
      sameSite: 'lax',
    };
    const getAll = vi.fn(async () => [cookie, { ...cookie, domain: 'other.test' }]);
    vi.stubGlobal('chrome', {
      cookies: { getAll, getAllCookieStores: async () => [{ id: 'selected-store', tabIds: [1] }] },
      scripting: { executeScript: vi.fn() },
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            origin: 'https://fixture.test',
            storageKeys: [],
            purposes: ['session-import'],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'grant',
            status: 'connected',
            cookieCount: 1,
            value: 'MALICIOUS_ECHO',
          }),
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    const result = await importSelectedSession({
      grantId: '11111111-1111-4111-8111-111111111111',
      target: { tabId: 1, selectionId: 'selection', expectedUrl: 'https://fixture.test' },
    });
    expect(getAll).toHaveBeenCalledWith({
      domain: 'fixture.test',
      storeId: 'selected-store',
      partitionKey: {},
    });
    const submitted = fetcher.mock.calls[1];
    if (!submitted) throw new Error('import request missing');
    expect(JSON.parse(submitted[1].body).cookies).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_ONLY');
    expect(JSON.stringify(result)).not.toContain('MALICIOUS_ECHO');
    expect(result.status).toBe('connected');
  });
  it('never reads cookies when the backend grant origin differs', async () => {
    const getAll = vi.fn();
    vi.stubGlobal('chrome', { cookies: { getAll } });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              origin: 'https://other.test',
              storageKeys: [],
              purposes: ['session-import'],
            }),
          ),
      ),
    );
    await expect(
      importSelectedSession({
        grantId: '11111111-1111-4111-8111-111111111111',
        target: { tabId: 1, selectionId: 'selection', expectedUrl: 'https://fixture.test' },
      }),
    ).rejects.toThrow('session_import_failed');
    expect(getAll).not.toHaveBeenCalled();
  });
});
