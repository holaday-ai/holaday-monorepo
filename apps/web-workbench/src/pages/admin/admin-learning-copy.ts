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
    return '本期无高风险域名（≥ 3 次任务且失败 / 成功+失败 > 50%）';
  }
  if (filter === 'recentFail') return '本周无失败任务';
  return '暂无域名执行数据';
}
