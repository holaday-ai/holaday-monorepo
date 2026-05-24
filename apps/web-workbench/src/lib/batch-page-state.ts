export function batchListSummary({
  loading,
  error,
  count,
}: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly count: number;
}): string {
  if (loading && count === 0) return '批量任务加载中…';
  if (error && count > 0) return `刷新失败 · 显示 ${count} 个批量`;
  if (error) return '批量任务加载失败';
  if (count === 0) return '暂无批量任务';
  return `共 ${count} 个批量任务`;
}

export function batchDetailSummary({
  loading,
  error,
  total,
  finished,
}: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly total: number | null;
  readonly finished: number;
}): string {
  if (loading && total == null) return '详情加载中…';
  if (error && total != null) return '刷新失败 · 显示上次详情';
  if (error) return '详情加载失败';
  if (total == null) return '暂无详情';
  return `${finished} / ${total} 已处理`;
}

export function batchStatusCopy({
  loading,
  error,
  hasData,
  target,
}: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly hasData: boolean;
  readonly target: 'list' | 'detail';
}): { readonly title: string; readonly body: string } | null {
  const label = target === 'list' ? '批量任务' : '批量任务详情';
  if (error && hasData) {
    return {
      title: `刷新失败，正在显示上次成功加载的${label}`,
      body: error,
    };
  }
  if (error) {
    return {
      title: `${label}加载失败`,
      body: error,
    };
  }
  if (loading && !hasData) {
    return {
      title: `${label}加载中…`,
      body: target === 'list' ? '正在读取你的批量任务。' : '正在读取批量任务进度和每一项状态。',
    };
  }
  return null;
}

export function batchProgressPercent({
  total,
  done,
  failed,
  cancelled,
}: {
  readonly total: number;
  readonly done: number;
  readonly failed: number;
  readonly cancelled?: number | null;
}): number {
  if (total <= 0) return 0;
  const finished = Math.max(0, done) + Math.max(0, failed) + Math.max(0, cancelled ?? 0);
  return Math.min(100, Math.max(0, Math.round((finished / total) * 100)));
}

export function batchErrorMessage(err: unknown, fallback = '请稍后重试'): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}
