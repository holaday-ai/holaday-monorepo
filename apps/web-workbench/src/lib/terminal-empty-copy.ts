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
      body: '这个任务已经结束，但没有收到可用回复。已完成的步骤仍保留在详情里，可以重新执行当前任务。',
    };
  }

  if (status === 'partial_success') {
    return {
      title: '部分完成',
      body: '任务只完成了一部分，但没有生成可用的最终回复。已完成的步骤仍保留在详情里，可以重新执行当前任务继续验证。',
    };
  }

  return {
    title: '没有回复内容',
    body: '这个任务已经结束，但没有收到回复内容。可以重新执行当前任务。',
  };
}

export function terminalInsufficientCopy(): {
  title: string;
  body: string;
} {
  return {
    title: '结果内容不足',
    body: '这次输出几乎没有有效内容。已完成的步骤仍保留在详情里；可以重新执行，或换一种更具体的描述后再试。',
  };
}
