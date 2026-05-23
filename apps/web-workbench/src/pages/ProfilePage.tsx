import { Loader2, Mail } from 'lucide-react';
import * as React from 'react';
import { PageContainer, PageHeader, Row, Section } from '@/pages/PageShell';
import { Button } from '@/components/ui/button';
import { SUPPORT_EMAIL, supportMailtoHref } from '@/lib/support-links';
import { trpc } from '@/lib/trpc';

/**
 * Read-only user profile view. The previous build had editable nickname /
 * phone / avatar inputs and a "修改密码" form, but neither updateProfile
 * nor changePassword tRPC procedures exist yet — the save handlers just
 * showed a fake "saved locally" toast and dropped the input. Keep the
 * page read-only and route account changes through support until the
 * backend mutations land.
 */
export function ProfilePage(): JSX.Element {
  const [loading, setLoading] = React.useState(true);
  const [email, setEmail] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');

  React.useEffect(() => {
    let active = true;
    trpc.auth.me.query().then(
      (res) => {
        if (!active) return;
        setEmail(res.email ?? '');
        setDisplayName(res.displayName ?? '');
        setLoading(false);
      },
      () => {
        if (!active) return;
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const initial = (displayName || email || '?').slice(0, 1).toUpperCase();

  if (loading) {
    return (
      <PageContainer width="form">
        <PageHeader title="个人资料" />
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer width="form">
      <PageHeader title="个人资料" description="管理你的基本信息" />
      <div className="space-y-6">
        <Section>
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-center">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-pink-400 to-pink-600 text-2xl font-semibold text-white">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold">{displayName || email}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{email}</div>
            </div>
          </div>
        </Section>

        <Section title="基本信息">
          <Row label="昵称" description="显示在左下角和任务通知里">
            <input
              type="text"
              value={displayName}
              readOnly
              disabled
              className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground md:w-64"
            />
          </Row>
          <Row label="邮箱" description="用于登录和安全通知">
            <input
              type="email"
              value={email}
              readOnly
              disabled
              className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground md:w-64"
            />
          </Row>
          <div className="mt-4 flex items-center justify-end gap-3">
            <span className="text-[11px] text-muted-foreground">
              如需更新资料，请联系支持
            </span>
            <Button asChild variant="outline" size="sm">
              <a
                href={supportMailtoHref({
                  subject: '更新 HOLA DAY 个人资料',
                  body: '请协助更新我的 HOLA DAY 个人资料。\n\n注册邮箱：\n需要更新的内容：',
                })}
              >
                <Mail className="h-3.5 w-3.5" />
                联系支持
              </a>
            </Button>
          </div>
        </Section>

        <Section title="账号安全">
          <Row label="密码" description="最近修改：未知">
            <div className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-3 text-xs text-muted-foreground md:w-96">
              密码修改功能开发中，请联系{' '}
              <a
                href={supportMailtoHref({ subject: 'HOLA DAY 账号安全支持' })}
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                {SUPPORT_EMAIL}
              </a>
            </div>
          </Row>
          <Row label="双重验证" description="使用手机或邮箱验证码二次确认登录">
            <span className="text-xs text-muted-foreground">未开启</span>
          </Row>
        </Section>
      </div>
    </PageContainer>
  );
}
