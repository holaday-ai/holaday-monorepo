import { AlertCircle, Loader2, Mail } from 'lucide-react';
import * as React from 'react';
import { PageContainer, PageHeader, Row, Section } from '@/pages/PageShell';
import { Button } from '@/components/ui/button';
import {
  normalizeProfileSnapshot,
  profileDisplayName,
  profileInitial,
  profileLoadErrorMessage,
  profilePageSummary,
  profileUpdateMailBody,
} from '@/lib/profile-page-state';
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
  const mountedRef = React.useRef(false);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = normalizeProfileSnapshot(await trpc.auth.me.query());
      if (!mountedRef.current) return;
      setEmail(res.email);
      setDisplayName(res.displayName);
    } catch (err) {
      if (!mountedRef.current) return;
      setLoadError(profileLoadErrorMessage(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const summary = profilePageSummary({ loading, error: loadError, email });
  const preferredName = profileDisplayName({ displayName, email });
  const initial = profileInitial({ displayName, email });

  if (loading || loadError) {
    return (
      <PageContainer width="form">
        <PageHeader
          title="个人资料"
          description="管理你的基本信息"
          action={
            <div className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-[12px] font-medium text-foreground">
              {summary}
            </div>
          }
        />
        {loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card/40 px-6 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-primary" aria-hidden />
            <div className="text-sm font-medium text-foreground/80">资料加载失败</div>
            <div className="max-w-md text-xs leading-5 text-muted-foreground">
              {loadError}
            </div>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" onClick={() => void refresh()}>
                重试
              </Button>
              <Button asChild variant="outline" size="sm">
                <a
                  href={supportMailtoHref({
                    subject: '个人资料加载失败',
                    body: '个人资料加载失败，请协助排查。\n\n注册邮箱：\n出现时间：',
                  })}
                >
                  联系支持
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </PageContainer>
    );
  }

  return (
    <PageContainer width="form">
      <PageHeader
        title="个人资料"
        description="管理你的基本信息"
        action={
          <div className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-[12px] font-medium text-foreground">
            {summary}
          </div>
        }
      />
      <div className="space-y-6">
        <Section>
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-center">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-pink-400 to-pink-600 text-2xl font-semibold text-white">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold">{preferredName}</div>
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
                  body: profileUpdateMailBody(email),
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
