import type { UiTask } from '@/types/task';

export function terminalEmptyCopy(status: UiTask['status']): {
  title: string;
  body: string;
} {
  if (status === 'cancelled') {
    return {
      title: '已取消',
      body: '任务已取消，没有生成最终回复。已完成的步骤仍保留在详情里。',
    };
  }

  if (status === 'failed') {
    return {
      title: '任务未能完成',
      body: '这个任务已经结束，但没有收到可用回复。重新发送一次相同意图通常就行。',
    };
  }

  return {
    title: '没有回复内容',
    body: '这个任务已经结束，但没有收到回复内容。重新发送一次相同意图通常就行。',
  };
}
