import { Eye, EyeOff } from 'lucide-react';
import * as React from 'react';
import { FullBrandLogo } from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { setAccessToken } from '@/lib/auth';
import { cn } from '@/lib/utils';
import {
  authErrorMessage,
  isValidChinaPhone,
  isValidEmail,
  maskChinaPhone,
  normaliseCodeInput,
  normaliseEmailInput,
  normalisePhoneInput,
} from '@/lib/login-gate-validation';
import { trpc } from '@/lib/trpc';

interface Props {
  onAuthenticated: () => void;
  /** Initial form mode. Defaults to `login`. Used by /register route. */
  initialMode?: Mode;
}

type Mode = 'login' | 'register' | 'emailCode' | 'forgot' | 'phone';

const LOGIN_SURFACE =
  'border-[#DCDDDD] bg-white shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-card/90';
const LOGIN_INPUT =
  'border-[#DCDDDD] bg-white shadow-none placeholder:text-muted-foreground/55 focus-visible:border-[#EA1F59]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/10 dark:border-white/10 dark:bg-card';
const LOGIN_PRIMARY =
  'bg-[#EA1F59] text-white shadow-[0_4px_12px_rgba(234,31,89,0.16)] hover:bg-[#EA1F59]/90';
const LOGIN_LINK = 'text-[#EA1F59] underline-offset-2 hover:underline';

/**
 * Login / register / forgot-password card. Modes:
 *   - login        : email + password → auth.login
 *   - register     : email + password + confirm → auth.register → auto-login
 *   - emailCode    : email → auth.sendCode → 6-digit code → auth.verifyCode
 *   - forgot       : email → auth.sendCode → code + new password → auth.resetPassword
 *   - phone        : 11-digit mobile → auth.smsSend → 6-digit code → auth.smsVerify
 *
 * Google OAuth button only appears when the server advertises the
 * feature via `auth.loginOptions` (env-gated on GOOGLE_CLIENT_ID).
 */
export function LoginGate({ onAuthenticated, initialMode = 'login' }: Props): JSX.Element {
  // Chinese-locale visitors default to the SMS tab — phone+code is the
  // dominant onboarding path in mainland China; email/password feels
  // foreign. Other locales keep the existing email/password default.
  // The /register route still forces register mode (initialMode prop
  // explicitly passed), so this only affects the bare /login path.
  const [mode, setMode] = React.useState<Mode>(() => {
    if (initialMode !== 'login') return initialMode;
    if (typeof navigator !== 'undefined' && navigator.language?.startsWith('zh')) {
      return 'phone';
    }
    return initialMode;
  });
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [code, setCode] = React.useState('');
  const [codeSent, setCodeSent] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(0);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [loginOptions, setLoginOptions] = React.useState<{
    google: boolean;
    emailCode: boolean;
    sms: boolean;
  }>({ google: false, emailCode: false, sms: false });

  // Fetch server-side login options once on mount.
  React.useEffect(() => {
    void (async () => {
      try {
        const res = await trpc.auth.loginOptions.query();
        setLoginOptions({
          google: !!res.google,
          emailCode: !!res.emailCode,
          sms: !!(res as { sms?: boolean }).sms,
        });
      } catch {
        /* defaults: no optional methods */
      }
    })();
  }, []);

  // Resend-cooldown ticker for the email-code / forgot flow.
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const resetTransient = (): void => {
    setError(null);
    setNotice(null);
  };

  function switchMode(m: Mode): void {
    setMode(m);
    resetTransient();
    setPassword('');
    setConfirm('');
    setCode('');
    setCodeSent(false);
    // Clear `phone` only when leaving phone mode so the user doesn't
    // lose what they typed mid-tab-switch within the phone flow.
    if (m !== 'phone') setPhone('');
  }

  async function handleLogin(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    resetTransient();
    const cleanEmail = normaliseEmailInput(email);
    if (!isValidEmail(cleanEmail)) {
      setError('请输入有效邮箱');
      return;
    }
    if (!password) {
      setError('请输入密码');
      return;
    }
    setPending(true);
    try {
      const res = await trpc.auth.login.mutate({ email: cleanEmail, password });
      setAccessToken(res.accessToken);
      onAuthenticated();
    } catch (err) {
      setError(authErrorMessage(err, '登录失败，请稍后重试。'));
    } finally {
      setPending(false);
    }
  }

  async function handleRegister(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    resetTransient();
    const cleanEmail = normaliseEmailInput(email);
    if (!isValidEmail(cleanEmail)) {
      setError('请输入有效邮箱');
      return;
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    if (password.length < 8) {
      setError('密码至少 8 位');
      return;
    }
    setPending(true);
    try {
      const res = await trpc.auth.register.mutate({ email: cleanEmail, password });
      setAccessToken(res.accessToken);
      onAuthenticated();
    } catch (err) {
      setError(authErrorMessage(err, '注册失败，请稍后重试。'));
    } finally {
      setPending(false);
    }
  }

  async function handleSendCode(): Promise<void> {
    resetTransient();
    const cleanEmail = normaliseEmailInput(email);
    if (!isValidEmail(cleanEmail)) {
      setError('请输入有效邮箱');
      return;
    }
    setPending(true);
    try {
      await trpc.auth.sendCode.mutate({ email: cleanEmail });
      setCodeSent(true);
      setCooldown(60);
      setNotice(`验证码已发送到 ${cleanEmail}，5 分钟内有效`);
    } catch (err) {
      setError(authErrorMessage(err, '验证码发送失败，请稍后重试。'));
    } finally {
      setPending(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    resetTransient();
    const cleanEmail = normaliseEmailInput(email);
    if (!isValidEmail(cleanEmail)) {
      setError('请输入有效邮箱');
      return;
    }
    if (code.length !== 6) {
      setError('请输入 6 位验证码');
      return;
    }
    setPending(true);
    try {
      const res = await trpc.auth.verifyCode.mutate({ email: cleanEmail, code });
      setAccessToken(res.accessToken);
      onAuthenticated();
    } catch (err) {
      setError(authErrorMessage(err, '验证码校验失败，请稍后重试。'));
    } finally {
      setPending(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    resetTransient();
    const cleanEmail = normaliseEmailInput(email);
    if (!isValidEmail(cleanEmail)) {
      setError('请输入有效邮箱');
      return;
    }
    if (code.length !== 6) {
      setError('请输入 6 位验证码');
      return;
    }
    if (password.length < 8) {
      setError('新密码至少 8 位');
      return;
    }
    if (password !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    setPending(true);
    try {
      const res = await trpc.auth.resetPassword.mutate({ email: cleanEmail, code, password });
      setAccessToken(res.accessToken);
      onAuthenticated();
    } catch (err) {
      setError(authErrorMessage(err, '重置密码失败，请稍后重试。'));
    } finally {
      setPending(false);
    }
  }

  // ---------------------------------------------------------------
  // Phase 12 — SMS login. Two phases:
  //   1. send   → trpc.auth.smsSend → starts the 60s cooldown
  //   2. verify → trpc.auth.smsVerify → returns { user, accessToken }
  // The phone state is kept separate from `email` so the input
  // doesn't collide with email-mode validation when the user
  // tab-switches mid-flow.
  // ---------------------------------------------------------------
  async function handleSendSms(): Promise<void> {
    resetTransient();
    if (!isValidChinaPhone(phone)) {
      setError('请输入 11 位中国大陆手机号');
      return;
    }
    const cleanPhone = normalisePhoneInput(phone);
    setPending(true);
    try {
      await trpc.auth.smsSend.mutate({ phone: cleanPhone });
      setCodeSent(true);
      setCooldown(60);
      setNotice(`验证码已发送到 ${maskChinaPhone(cleanPhone)}，5 分钟内有效`);
    } catch (err) {
      setError(authErrorMessage(err, '短信发送失败，请稍后重试。'));
    } finally {
      setPending(false);
    }
  }

  async function handleVerifySms(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    resetTransient();
    if (!isValidChinaPhone(phone)) {
      setError('请输入 11 位中国大陆手机号');
      return;
    }
    if (code.length !== 6) {
      setError('请输入 6 位验证码');
      return;
    }
    const cleanPhone = normalisePhoneInput(phone);
    setPending(true);
    try {
      const res = await trpc.auth.smsVerify.mutate({ phone: cleanPhone, code });
      setAccessToken(res.accessToken);
      onAuthenticated();
    } catch (err) {
      setError(authErrorMessage(err, '验证码校验失败，请稍后重试。'));
    } finally {
      setPending(false);
    }
  }

  const handleGoogle = (): void => {
    window.location.href = '/api/auth/google';
  };

  return (
    <div className="flex h-full items-center justify-center bg-[#EFEFEF]/45 px-4 py-8 dark:bg-background">
      <div className={cn('w-full max-w-[400px] space-y-5 rounded-lg p-8', LOGIN_SURFACE)}>
        <div className="space-y-2 text-center">
          <FullBrandLogo className="mx-auto" />
          <div className="text-xs text-muted-foreground">
            {mode === 'register' && '创建新账号'}
            {mode === 'forgot' && '重置密码'}
            {mode === 'login' && '请登录继续'}
            {mode === 'emailCode' && '用邮箱验证码登录'}
            {mode === 'phone' && '用手机验证码登录'}
          </div>
        </div>

        {(mode === 'login' || mode === 'emailCode' || mode === 'phone') && (
          <div className="flex gap-1 rounded-lg border border-[#DCDDDD] bg-[#EFEFEF]/55 p-1 text-xs dark:border-white/10 dark:bg-white/5">
            <TabButton active={mode === 'login'} onClick={() => switchMode('login')}>
              密码登录
            </TabButton>
            {loginOptions.emailCode && (
              <TabButton active={mode === 'emailCode'} onClick={() => switchMode('emailCode')}>
                邮箱验证码
              </TabButton>
            )}
            {loginOptions.sms && (
              <TabButton active={mode === 'phone'} onClick={() => switchMode('phone')}>
                手机登录
              </TabButton>
            )}
          </div>
        )}

        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-3" noValidate>
            <EmailInput value={email} onChange={setEmail} autoFocus />
            <PasswordInput
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
              >
                忘记密码？
              </button>
            </div>
            <InlineMessage tone="error">{error}</InlineMessage>
            <Button type="submit" className={cn('w-full', LOGIN_PRIMARY)} disabled={pending}>
              {pending ? '登录中…' : '登录'}
            </Button>
          </form>
        )}

        {mode === 'register' && (
          <form onSubmit={handleRegister} className="space-y-3" noValidate>
            <EmailInput value={email} onChange={setEmail} autoFocus />
            <PasswordInput
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              label="密码（至少 8 位）"
            />
            <PasswordInput
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              label="确认密码"
            />
            <InlineMessage tone="error">{error}</InlineMessage>
            <Button type="submit" className={cn('w-full', LOGIN_PRIMARY)} disabled={pending}>
              {pending ? '注册中…' : '注册并登录'}
            </Button>
          </form>
        )}

        {mode === 'emailCode' && (
          <form onSubmit={handleVerifyCode} className="space-y-3" noValidate>
            <EmailInput value={email} onChange={setEmail} autoFocus />
            <CodeRow
              code={code}
              onChange={setCode}
              onSend={handleSendCode}
              cooldown={cooldown}
              codeSent={codeSent}
              pending={pending}
            />
            <InlineMessage tone="notice">{notice}</InlineMessage>
            <InlineMessage tone="error">{error}</InlineMessage>
            <Button
              type="submit"
              className={cn('w-full', LOGIN_PRIMARY)}
              disabled={pending || code.length !== 6}
            >
              {pending ? '验证中…' : '验证并登录'}
            </Button>
          </form>
        )}

        {mode === 'phone' && (
          <form onSubmit={handleVerifySms} className="space-y-3" noValidate>
            <PhoneInput value={phone} onChange={setPhone} autoFocus />
            <CodeRow
              code={code}
              onChange={setCode}
              onSend={handleSendSms}
              cooldown={cooldown}
              codeSent={codeSent}
              pending={pending}
            />
            <InlineMessage tone="notice">{notice}</InlineMessage>
            <InlineMessage tone="error">{error}</InlineMessage>
            <Button
              type="submit"
              className={cn('w-full', LOGIN_PRIMARY)}
              disabled={pending || code.length !== 6}
            >
              {pending ? '验证中…' : '验证并登录'}
            </Button>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleResetPassword} className="space-y-3" noValidate>
            <EmailInput value={email} onChange={setEmail} autoFocus />
            <CodeRow
              code={code}
              onChange={setCode}
              onSend={handleSendCode}
              cooldown={cooldown}
              codeSent={codeSent}
              pending={pending}
            />
            <PasswordInput
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              label="新密码（至少 8 位）"
            />
            <PasswordInput
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              label="确认新密码"
            />
            <InlineMessage tone="notice">{notice}</InlineMessage>
            <InlineMessage tone="error">{error}</InlineMessage>
            <Button
              type="submit"
              className={cn('w-full', LOGIN_PRIMARY)}
              disabled={pending || code.length !== 6}
            >
              {pending ? '重置中…' : '重置密码并登录'}
            </Button>
            <div className="text-center text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={LOGIN_LINK}
              >
                返回登录
              </button>
            </div>
          </form>
        )}

        {/* Google OAuth — same kickoff URL on both login + register
         *  (the callback's loginOrRegisterByGoogle path upserts on
         *  email match), so Bug #16 is just a matter of un-gating
         *  register here. Keep `forgot` excluded — there's no
         *  password-reset flow via Google. Button label flips
         *  copy ("登录" / "注册") to match the user's mental model. */}
        {loginOptions.google && mode !== 'forgot' && (
          <>
            <div className="relative text-center text-[10px] uppercase text-muted-foreground">
              <span className="relative z-10 bg-white px-2 dark:bg-card">或</span>
              <div className="absolute inset-y-1/2 left-0 right-0 border-t border-[#DCDDDD] dark:border-white/10" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full border-[#DCDDDD] bg-white hover:bg-[#EFEFEF]/50 dark:border-white/10 dark:bg-transparent dark:hover:bg-white/10"
              onClick={handleGoogle}
            >
              {mode === 'register' ? '使用 Google 注册' : '使用 Google 登录'}
            </Button>
          </>
        )}

        <div className="text-center text-xs text-muted-foreground">
          {mode === 'register' ? (
            <>
              已有账号？
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={cn('ml-1', LOGIN_LINK)}
              >
                直接登录
              </button>
            </>
          ) : mode !== 'forgot' ? (
            <>
              没有账号？
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={cn('ml-1', LOGIN_LINK)}
              >
                注册
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick(): void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-w-0 flex-1 rounded-md border px-2 py-1 font-medium transition-colors',
        active
          ? 'border-[#DCDDDD] bg-white text-foreground shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-card'
          : 'border-transparent text-muted-foreground hover:bg-white/70 hover:text-foreground dark:hover:bg-white/10',
      )}
    >
      {children}
    </button>
  );
}

function InlineMessage({
  tone,
  children,
}: {
  tone: 'error' | 'notice';
  children: string | null;
}): JSX.Element | null {
  if (!children) return null;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'rounded-md border px-3 py-2 text-xs',
        tone === 'error'
          ? 'border-[#EA1F59]/30 bg-[#EA1F59]/10 text-[#EA1F59]'
          : 'border-[#42C0EF]/35 bg-[#42C0EF]/10 text-[#595757] dark:text-foreground',
      )}
    >
      {children}
    </div>
  );
}

function CodeRow({
  code,
  onChange,
  onSend,
  cooldown,
  codeSent,
  pending,
}: {
  code: string;
  onChange(v: string): void;
  onSend(): void;
  cooldown: number;
  codeSent: boolean;
  pending: boolean;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">验证码</span>
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          placeholder="6 位数字"
          required
          autoComplete="one-time-code"
          name="one-time-code"
          value={code}
          onChange={(e) => onChange(normaliseCodeInput(e.target.value))}
          className={cn('min-w-0 flex-1 rounded-md px-3 py-2 text-sm', LOGIN_INPUT)}
        />
        <Button
          type="button"
          variant="outline"
          onClick={onSend}
          disabled={pending || cooldown > 0}
          className="whitespace-nowrap border-[#DCDDDD] bg-white hover:bg-[#EFEFEF]/50 dark:border-white/10 dark:bg-transparent dark:hover:bg-white/10"
        >
          {cooldown > 0 ? `${cooldown}s` : codeSent ? '重新发送' : '发送验证码'}
        </Button>
      </div>
    </div>
  );
}

function EmailInput({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}): JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">邮箱</span>
      <input
        type="email"
        required
        autoComplete="email"
        name="email"
        placeholder="you@example.com"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn('w-full rounded-md px-3 py-2 text-sm', LOGIN_INPUT)}
      />
    </label>
  );
}

/**
 * Phase 12 — phone-number input. Strips everything that isn't a
 * digit on input, strips a pasted/typed +86 or 0086 country code when present,
 * then caps at the canonical 11-digit form the backend regex expects.
 */
function PhoneInput({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}): JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">手机号</span>
      <div className="flex">
        <span className="inline-flex shrink-0 items-center rounded-l-md border border-r-0 border-[#DCDDDD] bg-[#EFEFEF]/60 px-3 text-xs text-muted-foreground dark:border-white/10 dark:bg-white/5">
          +86
        </span>
        <input
          type="tel"
          inputMode="numeric"
          required
          maxLength={11}
          autoComplete="tel-national"
          name="phone"
          placeholder="138 0000 0000"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(normalisePhoneInput(e.target.value))}
          className={cn('w-full rounded-r-md px-3 py-2 text-sm', LOGIN_INPUT)}
        />
      </div>
    </label>
  );
}

function PasswordInput({
  value,
  onChange,
  autoComplete,
  label = '密码',
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  label?: string;
}): JSX.Element {
  const [show, setShow] = React.useState(false);
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn('w-full rounded-md px-3 py-2 pr-10 text-sm', LOGIN_INPUT)}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? '隐藏密码' : '显示密码'}
          title={show ? '隐藏密码' : '显示密码'}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );
}
