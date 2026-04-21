import * as React from 'react';
import { BrowserPanel } from '@/components/BrowserPanel';
import { MainPanel } from '@/components/MainPanel';
import { Sidebar } from '@/components/Sidebar';
import type { UiTask } from '@/types/task';

/**
 * G2 three-column layout skeleton. State management is purely local
 * with a mock-data seed — G3 replaces `MOCK_TASKS` and the `onSubmit`
 * stub with zustand + tRPC + WS plumbing.
 */

const MOCK_TASKS: UiTask[] = [
  {
    taskId: 'task_mock_1',
    intent: '帮我在小红书发一条关于清明假期的笔记',
    status: 'executing',
    tickCount: 4,
    createdAt: new Date(Date.now() - 2 * 60 * 1000),
  },
  {
    taskId: 'task_mock_2',
    intent: '查一下本周小红书互动最多的 5 条评论并整理成表格',
    status: 'paused',
    tickCount: 7,
    createdAt: new Date(Date.now() - 30 * 60 * 1000),
  },
  {
    taskId: 'task_mock_3',
    intent: '在百度搜索 "claude opus 4" 并把首条结果标题发给我',
    status: 'completed',
    tickCount: 6,
    resultText: '首条结果为 Anthropic 官方介绍页。',
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
  },
  {
    taskId: 'task_mock_4',
    intent: '登录公司邮箱抓取今天未读邮件的标题',
    status: 'failed',
    tickCount: 3,
    resultText: '未检测到登录态，需先完成二次验证。',
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  },
];

export function App(): JSX.Element {
  const [tasks] = React.useState<UiTask[]>(MOCK_TASKS);
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(MOCK_TASKS[0]?.taskId ?? null);
  const selectedTask = tasks.find((t) => t.taskId === selectedTaskId) ?? null;

  function handleNewTask(): void {
    setSelectedTaskId(null);
  }

  function handleSubmit(intent: string): void {
    // G3 swaps this for a tRPC mutation + optimistic store update.
    console.info('[web-workbench] submit (stub)', intent);
  }

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      <Sidebar
        tasks={tasks}
        selectedTaskId={selectedTaskId}
        onSelectTask={setSelectedTaskId}
        onNewTask={handleNewTask}
      />
      <MainPanel task={selectedTask} onSubmit={handleSubmit} />
      <BrowserPanel status={selectedTask?.status === 'executing' ? 'live' : 'idle'} />
    </div>
  );
}
