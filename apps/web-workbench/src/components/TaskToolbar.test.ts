import { describe, expect, it } from 'vitest';
import type { UiTask } from '@/types/task';
import {
  browserToolbarLabel,
  browserToolbarShortLabel,
  isBrowserLikely,
} from './TaskToolbar';

function task(overrides: Partial<UiTask> = {}): UiTask {
  return {
    taskId: 'tsk_test',
    intent: '打开 https://example.com',
    title: null,
    status: 'executing',
    tickCount: 0,
    createdAt: new Date('2026-05-21T00:00:00Z'),
    executionMode: 'browser',
    ...overrides,
  };
}

describe('TaskToolbar helpers', () => {
  it('detects browser-like legacy tasks', () => {
    expect(isBrowserLikely(task({ executionMode: 'browser', intent: '' }))).toBe(
      true,
    );
    expect(
      isBrowserLikely(task({ executionMode: undefined, intent: '访问 https://example.com' })),
    ).toBe(true);
    expect(
      isBrowserLikely(task({ executionMode: undefined, intent: '总结这段文字' })),
    ).toBe(false);
  });

  it('labels terminal browser tasks as browser entries when the panel is closed', () => {
    expect(browserToolbarLabel(task({ status: 'completed' }), 'closed')).toBe('查看浏览器');
    expect(browserToolbarLabel(task({ status: 'failed' }), 'closed')).toBe('查看浏览器');
    expect(browserToolbarLabel(task({ status: 'executing' }), 'closed')).toBe('查看浏览器');
  });

  it('uses live and close labels for open panel states', () => {
    expect(browserToolbarLabel(task({ status: 'executing' }), 'browser-live')).toBe('浏览器进行中');
    expect(browserToolbarLabel(task({ status: 'completed' }), 'browser-record')).toBe(
      '收起浏览器面板',
    );
  });

  it('prioritizes attention-needed browser labels', () => {
    expect(
      browserToolbarLabel(
        task({ status: 'awaiting_user', awaitingKind: 'login' }),
        'browser-live',
        true,
      ),
    ).toBe('需要登录');
    expect(
      browserToolbarLabel(
        task({ status: 'awaiting_user', awaitingKind: 'captcha' }),
        'browser-live',
        true,
      ),
    ).toBe('需要验证');
    expect(
      browserToolbarLabel(
        task({ status: 'awaiting_user', awaitingKind: 'browser_action' }),
        'browser-live',
        true,
      ),
    ).toBe('需要操作浏览器');
  });

  it('uses compact mobile labels that expose the browser entry', () => {
    expect(browserToolbarShortLabel(task({ status: 'completed' }), 'closed')).toBe(
      '浏览器',
    );
    expect(browserToolbarShortLabel(task({ status: 'executing' }), 'closed')).toBe(
      '浏览器',
    );
    expect(browserToolbarShortLabel(task({ status: 'completed' }), 'browser-record')).toBe(
      '收起',
    );
    expect(
      browserToolbarShortLabel(
        task({ status: 'awaiting_user', awaitingKind: 'login' }),
        'browser-live',
        true,
      ),
    ).toBe('需要登录');
  });
});
