import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { PageContainer, PageHeader, Row, Section } from '@/pages/PageShell';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';

/**
 * Read-only user profile view. The previous build had editable nickname /
 * phone / avatar inputs and a "修改密码" form, but neither updateProfile
 * nor changePassword tRPC procedures exist yet — the save handlers just
 * showed a fake "saved locally" toast and dropped the input. Kept the
 * page so /settings/profile doesn't 404, but the editable affordances
 * are stripped to a single disabled save button + a contact note. Lights
 * back on once the backend mutations land.
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
              个人资料修改即将支持
            </span>
            <Button disabled>保存修改</Button>
          </div>
        </Section>

        <Section title="账号安全">
          <Row label="密码" description="最近修改：未知">
            <div className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-3 text-xs text-muted-foreground md:w-96">
              密码修改功能开发中，请联系{' '}
              <a
                href="mailto:support@holaday.ai"
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                support@holaday.ai
              </a>
            </div>
          </Row>
          <Row label="双重验证" description="使用手机或邮箱验证码二次确认登录">
            <span className="text-xs text-muted-foreground">即将推出</span>
          </Row>
        </Section>
      </div>
    </PageContainer>
  );
}
