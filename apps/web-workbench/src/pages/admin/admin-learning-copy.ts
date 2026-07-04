export type AdminLearningFilter = 'all' | 'highRisk' | 'recentFail';

export function learningEmptyCopy({
  search,
  filter,
}: {
  search: string;
  filter: AdminLearningFilter;
}): string {
  if (search.trim().length > 0) return '没有匹配的域名';
  if (filter === 'highRisk') {
    return '本期无高风险域名（≥ 3 次任务且未成功 / 成功+未成功 > 50%）';
  }
  if (filter === 'recentFail') return '本周无失败/需复核任务';
  return '暂无域名执行数据';
}
