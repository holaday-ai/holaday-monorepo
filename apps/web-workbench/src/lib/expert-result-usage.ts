import type { UiTask } from '@/types/task';

export const EXPERT_RESULT_LABELS: Record<string, string> = {
  'content-topic': '选题分析',
  'ecom-daily': '电商日报',
  'douyin-review': '抖音稿件复盘',
};

export function expertResultUsageCopy({
  expertWorkflowId,
  expertMode,
}: {
  expertWorkflowId?: string;
  expertMode?: UiTask['expertMode'];
}): string | null {
  if (expertWorkflowId) {
    const label = EXPERT_RESULT_LABELS[expertWorkflowId];
    return `本次使用了 1 个技能${label ? `（${label}）` : ''}`;
  }
  if (expertMode === 'expert') {
    return '本次按专家模式处理';
  }
  return null;
}
