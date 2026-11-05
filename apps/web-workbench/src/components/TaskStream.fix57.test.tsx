import { useTaskStore } from '@/stores/task-store';
// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskStream } from './TaskStream';

/** FIX-57: the task page reads like a chat with your assistant. */
const mocks = vi.hoisted(() => ({ toast: { show: vi.fn() } }));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    tasks: { abort: { mutate: vi.fn() } },
    taskRecovery: {
      failureContext: {
        query: vi.fn().mockResolvedValue({
          refund: { state: 'not_charged' },
          inputFiles: [],
          unavailableInputCount: 0,
        }),
      },
    },
  },
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => mocks.toast }));
afterEach(() => {
  cleanup();
  useTaskStore.getState().reset();
});

function show(task: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  useTaskStore.setState({
    tasks: [{ title: 't', tickCount: 3, createdAt: new Date(), ...task } as never],
    ...extra,
  });
  const send = vi.fn();
  const pick = vi.fn();
  function Harness() {
    const t = useTaskStore((s) => s.tasks[0]);
    return t ? <TaskStream task={t} onSendSuggestion={send} onPickSuggestion={pick} /> : null;
  }
  render(<Harness />);
  return { send, pick };
}

it('a completed answer is a plain message: no review box, a quiet 「查看过程」, light next steps', async () => {
  const { send, pick } = show(
    {
      taskId: 'tsk_ok',
      intent: '上证指数最新收盘',
      status: 'completed',
      resultText:
        '上证昨天收在 3686.17，涨了 2.16%（[东方财富](https://quote.eastmoney.com/zs000001.html)）。',
      finalUrl: 'https://quote.eastmoney.com/zs000001.html',
      verificationPassed: true,
    },
    {
      suggestionsByTask: {
        tsk_ok: [
          { label: '开盘后我再拉一次实时点位对比？', prompt: '今天开盘后查上证实时点位并对比' },
        ],
      },
    },
  );
  expect(screen.getByText(/上证昨天收在 3686.17/)).toBeTruthy();
  expect(screen.queryByText('结果复核')).toBeNull();
  expect(screen.queryByText('下一步建议')).toBeNull();
  expect(screen.queryByText('打开页面链接')).toBeNull();
  expect(screen.queryByText(/自动审核|结构性问题/)).toBeNull();
  const footer = screen.getByRole('button', { name: /参考了 1 个来源 · 查看过程/ });
  await userEvent.click(footer);
  expect(screen.getAllByText('结束页面').length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('button', { name: /^开盘后我再拉一次实时点位对比/ }));
  expect(send).toHaveBeenCalledWith('今天开盘后查上证实时点位并对比');
  await userEvent.click(screen.getByRole('button', { name: /改一改再发/ }));
  expect(pick).toHaveBeenCalledWith('今天开盘后查上证实时点位并对比');
});

it('a failed run says what it did not get and offers ways on — no red box, no 拆成小步骤', async () => {
  const { send } = show({
    taskId: 'tsk_jd',
    intent: '打开 https://item.jd.com/1.html 读商品标题和价格',
    status: 'failed',
    resultText:
      '任务执行失败：无法读取该京东商品的标题和价格。被京东风控拦截，需要人工验证或登录后才可能正常展示。建议：简化任务描述后重试。',
    finalUrl: 'https://pc-frequent-pro.pf.jd.com/?from=pc_item&reason=403',
    failureLevel: 'hard_fail',
  });
  expect(
    screen.getByText(
      '京东把这个页面拦下了，要登录或验证后才显示，所以没拿到京东商品的标题和价格。',
    ),
  ).toBeTruthy();
  for (const gone of ['浏览器遇到问题', '拆成小步骤', '任务未完成，结果不能当作完成产物使用。'])
    expect(screen.queryByText(gone)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /你在浏览器里登录京东，我接着帮你看/ }));
  expect(send.mock.calls[0]?.[0]).toContain('等我登录好再继续');
  await userEvent.click(screen.getByRole('button', { name: /^查看过程/ }));
  expect(screen.getByText('核对记录')).toBeTruthy();
  expect(screen.getByText('失败详情')).toBeTruthy();
});

it('a partial result is said in words', () => {
  show({
    taskId: 'tsk_part',
    intent: '在亚马逊新加坡站搜 usb c cable，列出前三个的名称和价格',
    status: 'partial_success',
    resultText: '部分完成：前两个有价格，第 3 个页面只显示 See options，没有价格。',
  });
  expect(screen.queryByText('这次只拿到了一部分，缺的我写在下面了。')).toBeNull();
  expect(screen.queryByText(/^部分完成：/)).toBeNull();
  expect(screen.getByText(/第 3 个页面只显示 See options/)).toBeTruthy();
});

it('while running: one live status line from the steps, not a stack of tool rows', () => {
  show(
    { taskId: 'tsk_run', intent: '上证指数', status: 'executing' },
    {
      stepsByTask: {
        tsk_run: [
          {
            tickIndex: 1,
            status: 'done',
            actionKind: 'navigate',
            actionSummary: '打开 https://quote.eastmoney.com/zs000001.html',
            startedAt: Date.now(),
          },
          { tickIndex: 2, status: 'running', actionKind: 'snapshot', startedAt: Date.now() },
        ],
      },
    },
  );
  expect(screen.getByTestId('live-status-line').textContent).toContain('在读东方财富的内容…');
  expect(screen.queryByText(/snapshot|navigate/)).toBeNull();
});
