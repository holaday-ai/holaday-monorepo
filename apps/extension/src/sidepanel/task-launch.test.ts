import { BrowserTaskLaunches, resolveBrowserTaskMode } from '@holaday/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { prepareSidePanelLaunch } from './task-launch.js';

describe('browser launch mode', () => {
  it.each([
    ['整理这个网站的报表', 'independent'],
    ['处理当前页', 'current'],
    ['处理当前页的搜索按钮', 'current'],
    ['不要开新标签页，处理当前页', 'current'],
    ['不要处理当前页，帮我查询资料', 'independent'],
    ['解释“处理当前页”这个按钮', 'independent'],
    ["解释'处理当前页'这个按钮", 'independent'],
    ['解释‘处理当前页’的意思', 'independent'],
    ['处理当前页是什么意思', 'independent'],
    ['不要在当前页面操作', 'independent'],
    ['work on the current tab', 'current'],
    ['do not use the current tab', 'independent'],
  ])('%s -> %s', (intent, expected) => {
    expect(resolveBrowserTaskMode(intent)).toBe(expected);
  });
  it('honors the explicit UI choice', () => {
    expect(resolveBrowserTaskMode('处理当前页', 'independent')).toBe('independent');
    expect(resolveBrowserTaskMode('整理报表', 'current')).toBe('current');
  });
});

describe('retry identity', () => {
  it('shares in-flight preparation and retains IDs after an unknown timeout', async () => {
    const launches = new BrowserTaskLaunches<number>();
    const first = launches.attempt('same launch');
    const prepare = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(91);
    await expect(launches.prepare('same launch', prepare)).rejects.toThrow('timeout');
    expect(launches.attempt('same launch')).toBe(first);
    const a = launches.prepare('same launch', prepare);
    const b = launches.prepare('same launch', prepare);
    expect(await a).toBe(91);
    expect(await b).toBe(91);
    expect(prepare).toHaveBeenCalledTimes(2);
    launches.clear();
    expect(launches.attempt('same launch').preparationId).not.toBe(first.preparationId);
  });
});

const source = {
  extensionClientId: 'this-profile',
  tabId: 42,
  expectedUrl: 'https://work.example',
  selectionId: 'source-nonce',
  title: 'Work',
  taskTabStart: true,
};
const prepared = { ...source, tabId: 91, selectionId: 'task-nonce' };
function fixture() {
  return {
    discover: vi.fn(async () => ({
      backgroundTaskTabs: true,
      tabs: [source, { ...source, extensionClientId: 'other-profile' }],
    })),
    connection: vi.fn(async () => 'this-profile'),
    prepare: vi.fn(async () => prepared),
    assertSession: vi.fn(async () => {}),
    legacyContext: vi.fn(async () => null),
    launches: new BrowserTaskLaunches<typeof prepared>(),
  };
}
const input = {
  intent: '整理报表',
  page: {
    tabId: 42,
    url: 'https://work.example/path',
    title: 'Work',
    selectedText: 'PRIVATE selection',
    metaDescription: 'PRIVATE summary',
  },
  session: 1,
};
describe('sidepanel launcher', () => {
  it('binds its exact extension, prepares a task tab and sends no original page content', async () => {
    const deps = fixture();
    const a = await prepareSidePanelLaunch(input, deps);
    const b = await prepareSidePanelLaunch(input, deps);
    expect(a.body.intent).toBe('整理报表');
    expect(JSON.stringify(a.body)).not.toContain('PRIVATE');
    expect(a.body.localChrome).toEqual({
      extensionClientId: 'this-profile',
      tabId: 91,
      expectedUrl: 'https://work.example',
      selectionId: 'task-nonce',
    });
    expect(a.body.clientRequestId).toBe(b.body.clientRequestId);
    expect(deps.prepare).toHaveBeenCalledTimes(1);
    expect(deps.legacyContext).not.toHaveBeenCalled();
  });
  it('uses the captured original target only for an explicit current-page task', async () => {
    const deps = fixture();
    const result = await prepareSidePanelLaunch({ ...input, intent: '处理当前页' }, deps);
    expect(result.body.localChrome?.tabId).toBe(42);
    expect(deps.prepare).not.toHaveBeenCalled();
  });
  it('rejects another profile rather than guessing by numeric tab ID or using cloud', async () => {
    const deps = fixture();
    deps.connection.mockResolvedValue('missing-profile');
    await expect(prepareSidePanelLaunch(input, deps)).rejects.toThrow(/连接/);
    expect(deps.prepare).not.toHaveBeenCalled();
  });
  it('does not create on an account switch while discovery is pending', async () => {
    const deps = fixture();
    deps.assertSession.mockRejectedValueOnce(new Error('session changed'));
    await expect(prepareSidePanelLaunch(input, deps)).rejects.toThrow('session changed');
    expect(deps.prepare).not.toHaveBeenCalled();
  });
});
