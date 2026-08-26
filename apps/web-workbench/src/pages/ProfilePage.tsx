import { TrustNavigation } from '@/components/TrustNavigation';
import { Button } from '@/components/ui/button';
import { setAccessToken } from '@/lib/auth';
import {
  normalizeProfileSnapshot,
  profileDisplayName,
  profileInitial,
  profileLoadErrorCopy,
  profileLoadErrorMessage,
  profilePageSummary,
  profileUpdateMailBody,
} from '@/lib/profile-page-state';
import { supportMailtoHref } from '@/lib/support-links';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader, Row, Section } from '@/pages/PageShell';
import { AlertCircle, Copy, KeyRound, Loader2, Mail, ShieldCheck } from 'lucide-react';
import * as QRCode from 'qrcode';
import * as React from 'react';

/** Account profile with real password and authenticator security controls. */
export function ProfilePage(): JSX.Element {
  const mountedRef = React.useRef(false);
  const requestIdRef = React.useRef(0);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [passwordOpen, setPasswordOpen] = React.useState(false);
  const [passwordCode, setPasswordCode] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [passwordPending, setPasswordPending] = React.useState<'send' | 'change' | null>(null);
  const [passwordMessage, setPasswordMessage] = React.useState<string | null>(null);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [passwordCooldown, setPasswordCooldown] = React.useState(0);
  const [mfaStatus, setMfaStatus] = React.useState<{
    enabled: boolean;
    recoveryCodesRemaining: number;
  } | null>(null);
  const [mfaSetup, setMfaSetup] = React.useState<{
    secret: string;
    qrCodeUrl: string;
  } | null>(null);
  const [mfaCode, setMfaCode] = React.useState('');
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = React.useState<string[]>([]);
  const [mfaManageMode, setMfaManageMode] = React.useState<'regenerate' | 'disable' | null>(null);
  const [mfaBusy, setMfaBusy] = React.useState(false);
  const [mfaError, setMfaError] = React.useState<string | null>(null);
  const [mfaMessage, setMfaMessage] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [profileResult, securityResult] = await Promise.all([
        trpc.auth.me.query(),
        trpc.auth.mfaStatus.query(),
      ]);
      const res = normalizeProfileSnapshot(profileResult);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setEmail(res.email);
      setDisplayName(res.displayName);
      setMfaStatus(securityResult);
    } catch (err) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setLoadError(profileLoadErrorMessage(err));
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [refresh]);

  React.useEffect(() => {
    if (passwordCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setPasswordCooldown((remaining) => Math.max(0, remaining - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [passwordCooldown]);

  const sendPasswordCode = async () => {
    if (!email || passwordPending || passwordCooldown > 0) return;
    setPasswordPending('send');
    setPasswordError(null);
    setPasswordMessage(null);
    try {
      const result = await trpc.auth.sendPasswordChangeCode.mutate();
      setPasswordCooldown(Math.max(1, Math.ceil(result.cooldownMs / 1000)));
      setPasswordMessage('验证码已发送至当前账号邮箱，5 分钟内有效。');
    } catch (error) {
      setPasswordError(profileLoadErrorMessage(error));
    } finally {
      setPasswordPending(null);
    }
  };

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);
    if (!/^\d{6}$/.test(passwordCode)) {
      setPasswordError('请输入 6 位邮箱验证码');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('新密码至少需要 8 个字符');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致');
      return;
    }
    setPasswordPending('change');
    try {
      const result = await trpc.auth.changePasswordWithCode.mutate({
        code: passwordCode,
        password: newPassword,
      });
      setAccessToken(result.accessToken);
      setPasswordCode('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('密码已修改，其他设备需要重新登录。');
    } catch (error) {
      setPasswordError(profileLoadErrorMessage(error));
    } finally {
      setPasswordPending(null);
    }
  };

  const beginMfaSetup = async () => {
    if (mfaBusy) return;
    setPasswordOpen(false);
    setMfaBusy(true);
    setMfaError(null);
    setMfaMessage(null);
    setMfaRecoveryCodes([]);
    try {
      const result = await trpc.auth.beginMfaSetup.mutate();
      const qrCodeUrl = await QRCode.toDataURL(result.otpauthUri, {
        width: 208,
        margin: 1,
        color: { dark: '#3F3A3C', light: '#FFFFFF' },
      });
      setMfaSetup({ secret: result.secret, qrCodeUrl });
      setMfaCode('');
    } catch (error) {
      setMfaError(profileLoadErrorMessage(error, '双重验证暂时无法设置，请稍后重试。'));
    } finally {
      setMfaBusy(false);
    }
  };

  const confirmMfaSetup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mfaBusy || !mfaSetup) return;
    if (!/^\d{6}$/.test(mfaCode)) {
      setMfaError('请输入身份验证器中的 6 位动态验证码');
      return;
    }
    setMfaBusy(true);
    setMfaError(null);
    try {
      const result = await trpc.auth.confirmMfaSetup.mutate({ code: mfaCode });
      setAccessToken(result.accessToken);
      setMfaRecoveryCodes(result.recoveryCodes);
      setMfaStatus({ enabled: true, recoveryCodesRemaining: result.recoveryCodes.length });
      setMfaSetup(null);
      setMfaCode('');
      setMfaMessage('双重验证已开启，其他设备需要重新登录。');
    } catch (error) {
      setMfaError(profileLoadErrorMessage(error, '验证码校验失败，请重新尝试。'));
    } finally {
      setMfaBusy(false);
    }
  };

  const manageMfa = async (action: 'regenerate' | 'disable') => {
    if (mfaBusy) return;
    const cleanCode = mfaCode.trim().toUpperCase();
    if (!/^(?:\d{6}|[A-Z0-9]{5}-?[A-Z0-9]{5})$/.test(cleanCode)) {
      setMfaError('请输入 6 位动态码或一条恢复码');
      return;
    }
    setMfaBusy(true);
    setMfaError(null);
    try {
      if (action === 'regenerate') {
        const result = await trpc.auth.regenerateMfaRecoveryCodes.mutate({ code: cleanCode });
        setMfaRecoveryCodes(result.recoveryCodes);
        setMfaStatus({ enabled: true, recoveryCodesRemaining: result.recoveryCodes.length });
        setMfaMessage('旧恢复码已失效，请保存这组新恢复码。');
      } else {
        const result = await trpc.auth.disableMfa.mutate({ code: cleanCode });
        setAccessToken(result.accessToken);
        setMfaStatus({ enabled: false, recoveryCodesRemaining: 0 });
        setMfaRecoveryCodes([]);
        setMfaMessage('双重验证已关闭，其他设备需要重新登录。');
      }
      setMfaCode('');
      setMfaManageMode(null);
    } catch (error) {
      setMfaError(profileLoadErrorMessage(error, '安全验证失败，请重新尝试。'));
    } finally {
      setMfaBusy(false);
    }
  };

  const copyRecoveryCodes = async () => {
    if (mfaRecoveryCodes.length === 0) return;
    try {
      await navigator.clipboard.writeText(mfaRecoveryCodes.join('\n'));
      setMfaMessage('恢复码已复制。');
    } catch {
      setMfaError('复制失败，请逐条保存恢复码。');
    }
  };

  const summary = profilePageSummary({ loading, error: loadError, email });
  const preferredName = profileDisplayName({ displayName, email });
  const initial = profileInitial({ displayName, email });
  const loadErrorCopy = profileLoadErrorCopy(loadError);

  if (loading || loadError) {
    return (
      <PageContainer width="form">
        <PageHeader
          title="个人资料"
          description="管理你的基本信息"
          action={
            <div className="inline-flex items-center rounded-full border border-[#DCDDDD] bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              {summary}
            </div>
          }
        />
        {loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-[8px] border border-[#DCDDDD] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <AlertCircle className="h-8 w-8 text-[#EA1F59]" aria-hidden />
            <div className="text-sm font-medium text-foreground/80">{loadErrorCopy.title}</div>
            <div className="max-w-md text-xs leading-5 text-muted-foreground">
              {loadErrorCopy.body}
            </div>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" onClick={() => void refresh()}>
                重试
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
              >
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
            <Loader2 className="h-5 w-5 animate-spin text-[#EA1F59]" />
          </div>
        )}
      </PageContainer>
    );
  }

  return (
    <PageContainer width="form">
      <PageHeader
        title="个人资料"
        description="管理基本信息、密码和双重验证"
        action={
          <div className="inline-flex items-center rounded-full border border-[#DCDDDD] bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            {summary}
          </div>
        }
      />
      <div className="space-y-6">
        <Section className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-center">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[8px] border border-[#EA1F59]/35 bg-white text-2xl font-semibold text-[#EA1F59] shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="break-all text-base font-semibold">{preferredName}</div>
              <div className="mt-0.5 break-all text-xs text-muted-foreground">{email}</div>
            </div>
          </div>
        </Section>

        <Section
          title="基本信息"
          className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
        >
          <Row label="昵称" description="显示在左下角和任务通知里">
            <input
              type="text"
              value={displayName}
              readOnly
              disabled
              className="w-full rounded-[8px] border border-[#DCDDDD] bg-[#EFEFEF]/45 px-3 py-2 text-sm text-muted-foreground md:w-64"
            />
          </Row>
          <Row label="邮箱" description="用于登录和安全通知">
            <input
              type="email"
              value={email}
              readOnly
              disabled
              className="w-full rounded-[8px] border border-[#DCDDDD] bg-[#EFEFEF]/45 px-3 py-2 text-sm text-muted-foreground md:w-64"
            />
          </Row>
          <div className="mt-4 flex items-center justify-end gap-3">
            <span className="text-[11px] text-muted-foreground">如需更新资料，请联系支持</span>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:bg-white hover:text-[#EA1F59]"
            >
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

        <Section
          title="账号安全"
          className="rounded-[8px] border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
        >
          <Row label="密码" description="使用邮箱验证码验证当前账号">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setPasswordOpen((open) => {
                  const nextOpen = !open;
                  if (nextOpen) {
                    setMfaSetup(null);
                    setMfaManageMode(null);
                    setMfaRecoveryCodes([]);
                  }
                  return nextOpen;
                });
                setPasswordError(null);
                setPasswordMessage(null);
              }}
              className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#EA1F59]/45 hover:bg-[#FFF7F9] hover:text-[#EA1F59]"
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden />
              修改密码
            </Button>
          </Row>
          {passwordOpen ? (
            <form
              aria-label="修改密码"
              aria-busy={passwordPending === 'change'}
              onSubmit={changePassword}
              className="mt-4 rounded-[8px] border border-[#EA1F59]/15 bg-[#FFF9FA] p-4"
            >
              <div className="mb-4 flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-white text-[#EA1F59] shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                </div>
                <div>
                  <div className="text-sm font-medium text-[#3F3A3C]">验证当前账号后更新密码</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    验证码将发送到 {email}。修改成功后，其他设备需要重新登录。
                  </p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="text-xs font-medium text-[#595757] md:col-span-2">
                  <label htmlFor="password-code">邮箱验证码</label>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      id="password-code"
                      name="password-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={passwordCode}
                      onChange={(event) =>
                        setPasswordCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                      }
                      className="min-w-0 flex-1 rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-2 text-sm outline-none transition focus:border-[#EA1F59]/60 focus:ring-2 focus:ring-[#EA1F59]/10"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={passwordPending !== null || passwordCooldown > 0 || !email}
                      onClick={() => void sendPasswordCode()}
                      className="shrink-0 border-[#DCDDDD] bg-white text-[#595757] hover:border-[#EA1F59]/45 hover:bg-white hover:text-[#EA1F59]"
                    >
                      {passwordPending === 'send' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : null}
                      {passwordCooldown > 0 ? `${passwordCooldown} 秒后重发` : '发送验证码'}
                    </Button>
                  </div>
                </div>
                <label className="text-xs font-medium text-[#595757]" htmlFor="new-password">
                  新密码
                  <input
                    id="new-password"
                    name="new-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className="mt-1.5 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-2 text-sm outline-none transition focus:border-[#EA1F59]/60 focus:ring-2 focus:ring-[#EA1F59]/10"
                  />
                </label>
                <label className="text-xs font-medium text-[#595757]" htmlFor="confirm-password">
                  确认新密码
                  <input
                    id="confirm-password"
                    name="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="mt-1.5 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-2 text-sm outline-none transition focus:border-[#EA1F59]/60 focus:ring-2 focus:ring-[#EA1F59]/10"
                  />
                </label>
              </div>
              {passwordError ? (
                <p role="alert" className="mt-3 text-xs text-[#C5164B]">
                  {passwordError}
                </p>
              ) : null}
              {passwordMessage ? (
                <output className="mt-3 block text-xs text-[#16775A]">{passwordMessage}</output>
              ) : null}
              <div className="mt-4 flex justify-end">
                <Button type="submit" size="sm" disabled={passwordPending !== null}>
                  {passwordPending === 'change' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : null}
                  确认修改
                </Button>
              </div>
            </form>
          ) : null}
          <Row label="双重验证" description="使用身份验证器生成动态验证码">
            {mfaStatus?.enabled ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="rounded-full bg-[#EAF8F1] px-2.5 py-1 text-[11px] font-medium text-[#16775A]">
                  已开启 · {mfaStatus.recoveryCodesRemaining} 条恢复码
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPasswordOpen(false);
                    setMfaManageMode((mode) => (mode ? null : 'regenerate'));
                    setMfaError(null);
                    setMfaMessage(null);
                  }}
                >
                  管理
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!mfaStatus || mfaBusy}
                onClick={() => void beginMfaSetup()}
                className="border-[#DCDDDD] bg-white text-[#595757] hover:border-[#EA1F59]/45 hover:bg-[#FFF7F9] hover:text-[#EA1F59]"
              >
                {mfaBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                开启双重验证
              </Button>
            )}
          </Row>
          {mfaSetup ? (
            <form
              aria-label="开启双重验证"
              onSubmit={confirmMfaSetup}
              className="mt-4 rounded-[8px] border border-[#EA1F59]/15 bg-[#FFF9FA] p-4"
            >
              <div className="grid gap-5 md:grid-cols-[208px_1fr] md:items-center">
                <img
                  src={mfaSetup.qrCodeUrl}
                  alt="双重验证二维码"
                  className="h-[208px] w-[208px] rounded-[8px] border border-[#EFEFEF] bg-white p-2"
                />
                <div>
                  <h3 className="text-sm font-semibold text-[#3F3A3C]">连接身份验证器</h3>
                  <ol className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">
                    <li>1. 用身份验证器 App 扫描二维码</li>
                    <li>2. 输入 App 显示的 6 位动态验证码</li>
                    <li>3. 开启后立即保存一次性恢复码</li>
                  </ol>
                  <details className="mt-3 text-xs text-muted-foreground">
                    <summary className="cursor-pointer font-medium text-[#595757]">
                      无法扫码？查看设置密钥
                    </summary>
                    <code className="mt-2 block break-all rounded-[6px] border border-[#DCDDDD] bg-white px-2.5 py-2 text-[11px] text-[#3F3A3C]">
                      {mfaSetup.secret}
                    </code>
                  </details>
                  <label
                    className="mt-4 block text-xs font-medium text-[#595757]"
                    htmlFor="mfa-setup-code"
                  >
                    身份验证器验证码
                    <input
                      id="mfa-setup-code"
                      name="mfa-setup-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={mfaCode}
                      onChange={(event) =>
                        setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                      }
                      className="mt-1.5 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-2 text-sm outline-none transition focus:border-[#EA1F59]/60 focus:ring-2 focus:ring-[#EA1F59]/10"
                    />
                  </label>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setMfaSetup(null)}
                    >
                      取消
                    </Button>
                    <Button type="submit" size="sm" disabled={mfaBusy}>
                      {mfaBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : null}
                      确认开启
                    </Button>
                  </div>
                </div>
              </div>
            </form>
          ) : null}
          {mfaManageMode ? (
            <div className="mt-4 rounded-[8px] border border-[#DCDDDD] bg-[#FAFAFA] p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <label
                  className="min-w-0 flex-1 text-xs font-medium text-[#595757]"
                  htmlFor="mfa-manage-code"
                >
                  当前动态码或恢复码
                  <input
                    id="mfa-manage-code"
                    name="mfa-manage-code"
                    autoComplete="one-time-code"
                    maxLength={11}
                    value={mfaCode}
                    onChange={(event) => setMfaCode(event.target.value.slice(0, 11))}
                    className="mt-1.5 w-full rounded-[8px] border border-[#DCDDDD] bg-white px-3 py-2 text-sm outline-none transition focus:border-[#EA1F59]/60 focus:ring-2 focus:ring-[#EA1F59]/10"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={mfaBusy}
                    onClick={() => void manageMfa('regenerate')}
                  >
                    生成新恢复码
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={mfaBusy}
                    onClick={() => void manageMfa('disable')}
                    className="text-[#C5164B]"
                  >
                    关闭双重验证
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          {mfaRecoveryCodes.length > 0 ? (
            <div className="mt-4 rounded-[8px] border border-[#F2C66D]/55 bg-[#FFFBEF] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#3F3A3C]">保存恢复码</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    每条只能使用一次。关闭此区域后不会再次显示。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyRecoveryCodes()}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  复制全部
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-3">
                {mfaRecoveryCodes.map((code) => (
                  <code
                    key={code}
                    className="rounded-[6px] border border-[#F2C66D]/45 bg-white px-2.5 py-2 text-center text-[#3F3A3C]"
                  >
                    {code}
                  </code>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <Button type="button" size="sm" onClick={() => setMfaRecoveryCodes([])}>
                  我已安全保存
                </Button>
              </div>
            </div>
          ) : null}
          {mfaError ? (
            <p role="alert" className="mt-3 text-xs text-[#C5164B]">
              {mfaError}
            </p>
          ) : null}
          {mfaMessage ? (
            <output className="mt-3 block text-xs text-[#16775A]">{mfaMessage}</output>
          ) : null}
        </Section>
        <TrustNavigation destinations={['billing', 'terms', 'privacy']} />
      </div>
    </PageContainer>
  );
}
