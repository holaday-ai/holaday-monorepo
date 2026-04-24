import { CreditCard, Download, Plus } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { PageShell, Row, Section } from '@/pages/PageShell';

interface Invoice {
  id: string;
  date: string;
  amount: string;
  status: '已支付' | '待支付' | '退款';
}

// Placeholder data — real billing backend not wired yet.
const MOCK_INVOICES: Invoice[] = [
  { id: 'INV-2026-0003', date: '2026-04-01', amount: '¥39.00', status: '已支付' },
  { id: 'INV-2026-0002', date: '2026-03-01', amount: '¥39.00', status: '已支付' },
  { id: 'INV-2026-0001', date: '2026-02-01', amount: '¥39.00', status: '已支付' },
];

export function BillingPage(): JSX.Element {
  const toast = useToast();
  const [plan, setPlan] = React.useState<string>('free');

  React.useEffect(() => {
    trpc.auth.me.query().then(
      (res) => setPlan(res.plan),
      () => {
        /* ignore */
      },
    );
  }, []);

  const planLabel = plan === 'pro' ? 'Pro' : plan === 'basic' ? 'Basic' : 'Free · 试用';
  const nextBillingDate = plan === 'free' ? '—' : '2026-05-01';
  const nextAmount = plan === 'pro' ? '¥129.00' : plan === 'basic' ? '¥39.00' : '—';

  return (
    <PageShell title="账单与订阅" subtitle="支付方式和历史发票" width="4xl">
      <div className="space-y-6">
        <Section title="当前订阅">
          <Row label="套餐" description="查看完整对比">
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                {planLabel}
              </span>
              <Link to="/plan" className="text-xs text-primary underline-offset-2 hover:underline">
                升级
              </Link>
            </div>
          </Row>
          <Row label="下次扣款日期">
            <span className="text-sm text-muted-foreground">{nextBillingDate}</span>
          </Row>
          <Row label="下次扣款金额">
            <span className="text-sm text-muted-foreground">{nextAmount}</span>
          </Row>
          {plan !== 'free' && (
            <div className="mt-4 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:text-red-700"
                onClick={() => toast.show('取消订阅功能后端 API 接入中')}
              >
                取消订阅
              </Button>
            </div>
          )}
        </Section>

        <Section title="支付方式">
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border bg-background p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-sm font-medium">暂未绑定支付方式</div>
                  <div className="text-[11px] text-muted-foreground">支持信用卡、支付宝、微信支付</div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toast.show('支付集成开发中，敬请期待')}
              >
                <Plus className="h-3.5 w-3.5" />
                添加
              </Button>
            </div>
          </div>
        </Section>

        <Section title="发票历史" description="最近的付款记录">
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">发票号</th>
                  <th className="px-4 py-2 text-left font-medium">日期</th>
                  <th className="px-4 py-2 text-left font-medium">金额</th>
                  <th className="px-4 py-2 text-left font-medium">状态</th>
                  <th className="px-4 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {MOCK_INVOICES.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-xs text-muted-foreground">
                      还没有账单记录
                    </td>
                  </tr>
                ) : (
                  MOCK_INVOICES.map((inv) => (
                    <tr key={inv.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs">{inv.id}</td>
                      <td className="px-4 py-3 text-muted-foreground">{inv.date}</td>
                      <td className="px-4 py-3">{inv.amount}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => toast.show('下载发票功能开发中')}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Download className="h-3 w-3" />
                          PDF
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            以上为示例数据。真实的订单和发票将在接入支付系统后显示。
          </p>
        </Section>
      </div>
    </PageShell>
  );
}
