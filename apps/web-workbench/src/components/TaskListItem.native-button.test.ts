import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiTask } from '@/types/task';

const jsxProbe = vi.hoisted(() => ({
  taskButtonProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('react/jsx-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react/jsx-runtime')>();
  const wrap =
    (factory: typeof actual.jsx) =>
    (type: Parameters<typeof actual.jsx>[0], props: Record<string, unknown>, key?: string) => {
      if (
        type === 'button' &&
        typeof props.className === 'string' &&
        props.className.includes('min-w-0 flex-1')
      ) {
        jsxProbe.taskButtonProps.push(props);
      }
      return factory(type, props, key);
    };
  return {
    ...actual,
    jsx: wrap(actual.jsx),
    jsxs: wrap(actual.jsxs),
  };
});

vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react/jsx-dev-runtime')>();
  return {
    ...actual,
    jsxDEV: (...args: Parameters<typeof actual.jsxDEV>) => {
      const [type, rawProps] = args;
      const props = rawProps as Record<string, unknown>;
      if (
        type === 'button' &&
        typeof props.className === 'string' &&
        props.className.includes('min-w-0 flex-1')
      ) {
        jsxProbe.taskButtonProps.push(props);
      }
      return actual.jsxDEV(...args);
    },
  };
});

import { TaskListItem } from './TaskListItem';

function task(): UiTask {
  return {
    taskId: 'tsk_keyboard',
    intent: 'Keyboard selection',
    title: null,
    status: 'completed',
    tickCount: 1,
    createdAt: new Date('2026-07-30T00:00:00.000Z'),
  };
}

describe('TaskListItem native button activation', () => {
  beforeEach(() => {
    jsxProbe.taskButtonProps = [];
  });

  it('relies on the native button click for Enter and Space exactly once', () => {
    renderToStaticMarkup(
      React.createElement(TaskListItem, {
        task: task(),
        selected: false,
        batchMode: true,
        onSelect: vi.fn(),
        onBatchToggle: vi.fn(),
      }),
    );

    expect(jsxProbe.taskButtonProps).toHaveLength(1);
    expect(jsxProbe.taskButtonProps[0]?.onClick).toBeTypeOf('function');
    expect(jsxProbe.taskButtonProps[0]?.onKeyDown).toBeUndefined();
  });
});
