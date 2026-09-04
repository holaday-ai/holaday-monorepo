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

export function modelTaskSubmitDecision(region: unknown): 'submit' | 'choose_region' {
  return region === 'cn' || region === 'intl' ? 'submit' : 'choose_region';
}
