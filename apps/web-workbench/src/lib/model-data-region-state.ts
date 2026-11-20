export type ModelDataRegion = 'cn' | 'intl';

export const MODEL_DATA_REGION_COPY = {
  cn: {
    label: '中国大陆',
    description: '任务内容由中国大陆区域的千问服务处理。',
  },
  intl: {
    label: '国际',
    description: '任务内容由新加坡区域的千问服务处理。',
  },
} as const;

/**
 * Whether a task can go straight to the server. FIX-60 BOSS 决定: with the region selection off
 * (the default) it always can — the server runs an account that never chose in its default
 * region; with it on, an account without a region chooses first, as before.
 */
export function modelTaskSubmitDecision(
  region: unknown,
  selectionEnabled = false,
): 'submit' | 'choose_region' {
  if (!selectionEnabled) return 'submit';
  return region === 'cn' || region === 'intl' ? 'submit' : 'choose_region';
}
