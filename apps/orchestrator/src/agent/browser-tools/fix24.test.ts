import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { intentHosts, runUnifiedBrowserLoop } from './unified-browser-loop.js';

/** FIX-24: Deploy-24 production failures (core-08). */
const P = '请使用云端浏览器，';
const CORE08 = `${P}httpbin.org/forms/post 或 the-internet.herokuapp.com 填表单与日期控件，只填不提交并截图`;

function scripted(calls: Array<{ name: string; input: Record<string, unknown> }>) {
  let turn = 0;
  const seen: string[] = [];
  const adapter: MessagesAdapter = {
    metadata: { provider: 'anthropic', model: 'fixture' },
    async create(request) {
      seen.push(JSON.stringify(request.messages.at(-1)));
      const call = calls[Math.min(turn++, calls.length - 1)]!;
      return {
        id: String(turn),
        metadata: { provider: 'anthropic', model: 'fixture' },
        content: [{ type: 'tool_use', id: String(turn), ...call }],
        stopReason: 'tool_use',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
  return { adapter, seen };
}

/** A browser whose page is whatever the last navigate opened. */
function site(dateRefs: string[], staleOnce: string[] = []) {
  let url = 'about:blank';
  const stale = new Set(staleOnce);
  const execute = async (action: {
    tool: string;
    url?: string;
    ref?: string;
  }): Promise<UnifiedToolResult> => {
    if (action.tool === 'navigate') {
      url = action.url!;
      return { ok: true, text: `已打开 ${url}`, url };
    }
    if (action.tool === 'type') {
      if (stale.delete(action.ref!))
        return {
          ok: false,
          text: '该 cursor/ref 已失效，请重新 read_page / snapshot 后操作',
          errorCode: 'stale_ref',
          errorMessage: 'stale_observation',
        };
      return {
        ok: true,
        text: '已输入',
        form: {
          ref: action.ref!,
          filled: true,
          submitted: false,
          ...(dateRefs.includes(action.ref!) ? { date: true } : {}),
        },
      };
    }
    if (action.tool === 'screenshot')
      return { ok: true, text: '截图', image: { mediaType: 'image/jpeg', data: 'AA==' } };
    return { ok: true, text: `textbox "Customer name" textbox "Date" 2026-10-28 @ ${url}`, url };
  };
  return { execute, currentPageUrl: () => url };
}

const finish = (summary: string) => ({ name: 'finish', input: { status: 'completed', summary } });

describe('core-08: a named site bounds where the form may be filled', () => {
  it('reads the hosts a task names', () => {
    expect(intentHosts(CORE08)).toEqual(['httpbin.org', 'the-internet.herokuapp.com']);
    expect(intentHosts(`${P}从一个页面打开3个链接到新标签`)).toEqual([]);
  });

  it('a date filled on another site does not count; the named site without one is 部分完成', async () => {
    const { adapter, seen } = scripted([
      { name: 'navigate', input: { url: 'https://demoqa.com/date-picker' } },
      { name: 'snapshot', input: {} },
      { name: 'type', input: { ref: 'e11', text: '10/28/2026' } },
      finish('已在 demoqa.com 填写日期 10/28/2026，未提交并截图。'),
      { name: 'navigate', input: { url: 'https://httpbin.org/forms/post' } },
      { name: 'snapshot', input: {} },
      { name: 'type', input: { ref: 'e21', text: 'Test' } },
      { name: 'screenshot', input: {} },
      finish('已在 httpbin.org 填写姓名 Test，未提交并截图。'),
      finish('已在 httpbin.org 填写姓名 Test，未提交并截图；点名的两个网站都没有日期控件。'),
    ]);
    const browser = site(['e11']);
    const outcome = await runUnifiedBrowserLoop({
      intent: CORE08,
      adapter,
      maxSteps: 14,
      execute: browser.execute as never,
      currentPageUrl: browser.currentPageUrl,
    });
    const log = seen.join('\n');
    expect(log).toContain(
      '任务点名了 httpbin.org、the-internet.herokuapp.com，只能在这些网站内填写',
    );
    expect(log).toContain('demoqa.com 上的填写不算');
    expect(log).toContain('只在这些网站内找日期控件，不要换到别的网站');
    expect(log).not.toContain('w3schools');
    expect(outcome).toMatchObject({ status: 'completed', partial: { missing: '日期控件' } });
  });

  it('a date filled on the named site completes without any nudge', async () => {
    const { adapter, seen } = scripted([
      { name: 'navigate', input: { url: 'https://httpbin.org/forms/post' } },
      { name: 'snapshot', input: {} },
      { name: 'type', input: { ref: 'e11', text: '2026-10-28' } },
      { name: 'screenshot', input: {} },
      finish('已在 httpbin.org 填写日期 2026-10-28，未提交并截图。'),
    ]);
    const browser = site(['e11']);
    const outcome = await runUnifiedBrowserLoop({
      intent: CORE08,
      adapter,
      maxSteps: 8,
      execute: browser.execute as never,
      currentPageUrl: browser.currentPageUrl,
    });
    expect(outcome).toMatchObject({ status: 'completed' });
    expect('partial' in outcome && outcome.partial).toBeFalsy();
    expect(seen.join('\n')).not.toContain('只能在这些网站内填写');
  });

  it('without a named site, a date control on any public page still counts', async () => {
    const { adapter, seen } = scripted([
      { name: 'navigate', input: { url: 'https://demoqa.com/date-picker' } },
      { name: 'snapshot', input: {} },
      { name: 'type', input: { ref: 'e11', text: '10/28/2026' } },
      { name: 'screenshot', input: {} },
      finish('已填写日期 10/28/2026，未提交并截图。'),
    ]);
    const browser = site(['e11']);
    const outcome = await runUnifiedBrowserLoop({
      intent: `${P}找一个公开表单填写日期控件，只填不提交并截图`,
      adapter,
      maxSteps: 8,
      execute: browser.execute as never,
      currentPageUrl: browser.currentPageUrl,
    });
    expect(outcome).toMatchObject({ status: 'completed' });
    expect('partial' in outcome && outcome.partial).toBeFalsy();
    expect(seen.join('\n')).not.toContain('只能在这些网站内填写');
  });
});

describe('core-08: a stale ref is redone after a fresh snapshot', () => {
  it('tells the model to snapshot and redo the same type', async () => {
    const { adapter, seen } = scripted([
      { name: 'navigate', input: { url: 'https://httpbin.org/forms/post' } },
      { name: 'snapshot', input: {} },
      { name: 'type', input: { ref: 'e11', text: '2026-10-28' } },
      { name: 'snapshot', input: {} },
      { name: 'type', input: { ref: 'e12', text: '2026-10-28' } },
      { name: 'screenshot', input: {} },
      finish('已填写日期 2026-10-28，未提交并截图。'),
    ]);
    const browser = site(['e12'], ['e11']);
    const outcome = await runUnifiedBrowserLoop({
      intent: CORE08,
      adapter,
      maxSteps: 8,
      execute: browser.execute as never,
      currentPageUrl: browser.currentPageUrl,
    });
    expect(seen.join('\n')).toContain(
      '先 snapshot，再用新 ref 重做这次 type（同一个元素、同一个值）',
    );
    expect(outcome).toMatchObject({ status: 'completed' });
  });
});
