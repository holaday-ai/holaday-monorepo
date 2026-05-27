export type QuotaExhaustedActionKind = 'addon' | 'upgrade';

export interface QuotaExhaustedAction {
  readonly kind: QuotaExhaustedActionKind;
  readonly label: string;
  readonly path: string;
  readonly primary: boolean;
}

export interface QuotaExhaustedCopy {
  readonly headline: string;
  readonly subline: string;
  readonly badge: string;
  readonly actions: readonly QuotaExhaustedAction[];
}

export function quotaExhaustedCopy(plan: string): QuotaExhaustedCopy {
  if (plan === 'pro') {
    return {
      headline: '本月额度已用完',
      subline: '购买加量包后本周期立即生效，适合临时高峰继续执行任务。',
      badge: '专业版',
      actions: [
        {
          kind: 'addon',
          label: '购买加量包',
          path: '/plan#addons',
          primary: true,
        },
      ],
    };
  }
  if (plan === 'basic') {
    return {
      headline: '本月额度已用完',
      subline: '可以购买加量包继续本周期任务，或升级专业版获得更高月度额度。',
      badge: '基础版',
      actions: [
        {
          kind: 'addon',
          label: '购买加量包',
          path: '/plan#addons',
          primary: true,
        },
        {
          kind: 'upgrade',
          label: '升级专业版',
          path: '/plan',
          primary: false,
        },
      ],
    };
  }
  return {
    headline: '今日额度已用完',
    subline: '免费版每天 3 次任务。升级基础版后可立即继续使用，并解锁更多月度额度。',
    badge: '体验版',
    actions: [
      {
        kind: 'upgrade',
        label: '升级基础版',
        path: '/plan',
        primary: true,
      },
    ],
  };
}
