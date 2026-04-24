import { Check } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageShell } from '@/pages/PageShell';

type PlanId = 'free' | 'basic' | 'pro';

interface Plan {
  id: PlanId;
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  features: string[];
  featured?: boolean;
}

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '¥0',
    cadence: '试用',
    tagline: '体验 AI 浏览器的基础能力',
    features: [
      '每月 20 个任务额度',
      '单任务最长 10 分钟',
      '仅支持中文搜索引擎',
      '任务记录保留 7 天',
    ],
  },
  {
    id: 'basic',
    name: 'Basic',
    price: '¥39',
    cadence: '/ 月',
    tagline: '日常轻度使用的最佳选择',
    features: [
      '每月 200 个任务额度',
      '单任务最长 30 分钟',
      '全球搜索引擎 + 电商站点',
      '任务记录保留 30 天',
      '邮件客服支持',
    ],
    featured: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '¥129',
    cadence: '/ 月',
    tagline: '重度使用与团队协作',
    features: [
      '每月 1000 个任务额度',
      '单任务最长 2 小时',
      '所有站点 + Zapier / Apify 集成',
      '任务记录永久保留',
      '7×24 优先客服',
      '自定义角色 Prompt 库',
    ],
  },
];

/**
 * Pricing page. Fetches the current plan via auth.me so the user's
 * active tier is highlighted and the CTA text reflects state
 * (current / upgrade / downgrade). All upgrades are stubbed — the
 * billing backend isn't wired yet, so "升级" opens a toast that tells
 * the user to contact sales.
 */
export function PlanPage(): JSX.Element {
  const toast = useToast();
  const [currentPlan, setCurrentPlan] = React.useState<string>('free');

  React.useEffect(() => {
    trpc.auth.me.query().then(
      (res) => setCurrentPlan(res.plan),
      () => {
        /* silently fall back to free */
      },
    );
  }, []);

  function handleChoose(plan: PlanId): void {
    if (plan === currentPlan) return;
    toast.show(`${plan.toUpperCase()} 套餐即将开放，现在升级请联系客服`);
  }

  return (
    <PageShell title="套餐与定价" subtitle="选择适合你的版本" width="6xl">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
          让 AI 替你搞定浏览器里的一切
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          所有套餐都包含高质量模型、实时 VNC 观察、随时接管。按月付费，随时取消。
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          return (
            <div
              key={plan.id}
              className={cn(
                'relative flex flex-col rounded-2xl border bg-card p-6 shadow-sm transition-shadow',
                plan.featured
                  ? 'border-primary/60 shadow-md ring-1 ring-primary/20'
                  : 'border-border',
              )}
            >
              {plan.featured && !isCurrent && (
                <div className="absolute -top-2.5 left-6 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary-foreground">
                  推荐
                </div>
              )}
              {isCurrent && (
                <div className="absolute -top-2.5 left-6 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background">
                  当前套餐
                </div>
              )}
              <div className="mb-5">
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{plan.tagline}</p>
              </div>
              <div className="mb-6 flex items-baseline gap-1">
                <span className="text-3xl font-semibold tracking-tight">{plan.price}</span>
                <span className="text-xs text-muted-foreground">{plan.cadence}</span>
              </div>
              <ul className="mb-6 flex-1 space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="text-muted-foreground">{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                onClick={() => handleChoose(plan.id)}
                variant={isCurrent ? 'outline' : plan.featured ? 'default' : 'outline'}
                disabled={isCurrent}
                className="w-full"
              >
                {isCurrent ? '当前使用中' : plan.id === 'free' ? '降级到 Free' : '升级'}
              </Button>
            </div>
          );
        })}
      </div>

      <div className="mt-10 rounded-xl border border-border bg-card p-6 text-center">
        <h3 className="text-sm font-semibold">需要企业或团队方案？</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          多席位、独立部署、SLA — 联系我们获取定制报价
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => toast.show('请发送邮件到 sales@holaday.ai')}>
          联系销售
        </Button>
      </div>
    </PageShell>
  );
}
