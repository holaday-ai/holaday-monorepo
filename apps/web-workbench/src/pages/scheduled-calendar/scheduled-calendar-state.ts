import { pageErrorMessage } from '@/lib/page-error-copy';

export function scheduledCalendarSummary({
  loading,
  error,
  count,
}: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly count: number;
}): string {
  if (loading && count === 0) return '定时任务加载中…';
  if (error && count > 0) return `刷新失败 · 显示 ${count} 个计划`;
  if (error) return '定时任务暂时无法加载';
  if (count === 0) return '本视图暂无计划';
  return `本视图 ${count} 个计划`;
}

export function scheduledCalendarStatusCopy({
  loading,
  error,
  count,
}: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly count: number;
}): { readonly title: string; readonly body: string } | null {
  if (error && count > 0) {
    return {
      title: '刷新失败，正在显示上次成功加载的计划',
      body: error,
    };
  }
  if (error) {
    return {
      title: '定时任务暂时无法加载',
      body: error,
    };
  }
  if (loading && count === 0) {
    return {
      title: '定时任务加载中…',
      body: '正在读取当前日历范围内的执行计划。',
    };
  }
  if (count === 0) {
    return {
      title: '当前视图暂无定时任务',
      body: '点击日历日期可快速创建，也可以使用右上角的新建按钮。',
    };
  }
  return null;
}

export function scheduledCalendarErrorMessage(err: unknown, fallback = '请稍后重试'): string {
  return pageErrorMessage(err, fallback);
}
