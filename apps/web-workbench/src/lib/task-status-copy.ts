import type { UiTaskStatus } from '@/types/task';
import { awaitingUserCopy, type AwaitingKind } from './awaiting-user-copy';
import { deriveTaskProductState } from './task-product-state';

export function taskStatusLabel(
  status: UiTaskStatus | string,
  awaitingKind?: AwaitingKind | null,
): string {
  if (!status) return '未知状态';
  if (!awaitingKind && !isKnownTaskStatus(status)) return status;

  const productState = deriveTaskProductState({
    status,
    awaitingKind: awaitingKind ?? null,
  });
  switch (productState.lifecycle) {
    case 'queued':
      return '排队中';
    case 'running':
      if (productState.phase === 'planning') return '规划中';
      return '执行中';
    case 'waiting_user':
      return awaitingUserCopy(
        productState.blocker === 'max_steps' ||
          productState.blocker === 'retries_exhausted'
          ? undefined
          : productState.blocker,
      ).toolbarLabel;
    case 'paused':
      return '已暂停';
    case 'terminal':
      if (productState.outcome === 'completed') return '已完成';
      if (productState.outcome === 'partial_success') return '部分完成';
      if (productState.outcome === 'failed') return '失败';
      if (productState.outcome === 'cancelled') return '已取消';
      return '未知状态';
    case 'unknown':
      return '未知状态';
    default:
      return status || '未知状态';
  }
}

function isKnownTaskStatus(status: string): boolean {
  return status === 'pending' ||
    status === 'planning' ||
    status === 'queued' ||
    status === 'executing' ||
    status === 'awaiting_user' ||
    status === 'paused' ||
    status === 'completed' ||
    status === 'partial_success' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'unknown';
}

export function pausedTaskNoticeCopy(reason?: string | null): {
  title: string;
  body: string;
  hint: string;
} {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (trimmed) {
    return {
      title: '任务已暂停',
      body: trimmed,
      hint: '当前进度已保留，可以补充说明或稍后继续处理。',
    };
  }
  return {
    title: '任务已暂停',
    body: '执行已暂停，当前进度已保留。',
    hint: '可以补充说明或稍后继续处理。',
  };
}

export function historyEmptyCopy({
  query,
  status,
  range,
}: {
  query: string;
  status: string;
  range: string;
}): { title: string; body: string } {
  const hasFilters = Boolean(query.trim()) || status !== 'all' || range !== 'all';
  if (!hasFilters) {
    return {
      title: '还没有历史任务',
      body: '开始一个任务后，执行记录会出现在这里。',
    };
  }
  if (query.trim()) {
    return {
      title: '没有找到匹配任务',
      body: '换一个关键词，或放宽状态和时间范围。',
    };
  }
  return {
    title: '没有符合条件的任务',
    body: '放宽状态或时间范围再试试。',
  };
}

export function taskSearchEmptyCopy({
  query,
  searching,
  error,
}: {
  query: string;
  searching: boolean;
  error: boolean;
}): { title: string; body: string } {
  if (error) {
    return {
      title: '搜索失败',
      body: '网络或服务暂时不可用，请稍后重试。',
    };
  }
  if (searching) {
    return {
      title: '正在搜索…',
      body: '正在查找历史任务。',
    };
  }
  if (query.trim()) {
    return {
      title: '没有匹配的任务',
      body: '换个关键词，或去任务历史里放宽筛选。',
    };
  }
  return {
    title: '暂无最近任务',
    body: '开始一个任务后，可以在这里快速跳转。',
  };
}
