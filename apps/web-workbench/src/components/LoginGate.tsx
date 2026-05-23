import { Eye, EyeOff } from 'lucide-react';
import * as React from 'react';
import { FullBrandLogo } from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { setAccessToken } from '@/lib/auth';
import { trpc } from '@/lib/trpc';

interface Props {
  onAuthenticated: () => void;
  /** Initial form mode. Defaults to `login`. Used by /register route. */
  initialMode?: Mode;
}

type Mode = 'login' | 'register' | 'emailCode' | 'forgot' | 'phone';

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
    setPending(true);
    try {
      const res = await trpc.auth.login.mutate({ email, password });
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
      const res = await trpc.auth.register.mutate({ email, password });
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
    if (!email.trim()) {
      setError('请先输入邮箱');
      return;
    }
    setPending(true);
    try {
      await trpc.auth.sendCode.mutate({ email });
      setCodeSent(true);
      setCooldown(60);
      setNotice(`验证码已发送到 ${email}，5 分钟内有效`);
    } catch (err) {
      setError(authErrorMessage(err, '验证码发送失败，请稍后重试。'));
    } finally {
      setPending(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    resetTransient();
    setPending(true);
    try {
      const res = await trpc.auth.verifyCode.mutate({ email, code });
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
      const res = await trpc.auth.resetPassword.mutate({ email, code, password });
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
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError('请输入 11 位中国大陆手机号');
      return;
    }
    setPending(true);
    try {
      await trpc.auth.smsSend.mutate({ phone });
      setCodeSent(true);
      setCooldown(60);
      setNotice(`验证码已发送到 ${phone.slice(0, 3)}****${phone.slice(-4)}，5 分钟内有效`);
    } catch (err) {
      setError(authErrorMessage(err, '短信发送失败，请稍后重试。'));
    } finally {
      setPending(false);
    }
  }

  async function handleVerifySms(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    resetTransient();
    setPending(true);
    try {
      const res = await trpc.auth.smsVerify.mutate({ phone, code });
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
    <div className="flex h-full items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-8 shadow-sm">
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
          <div className="flex gap-1 rounded-md bg-muted/50 p-1 text-xs">
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
          <form onSubmit={handleLogin} className="space-y-3">
            <EmailInput value={email} onChange={setEmail} />
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
            {error && <div className="text-xs text-destructive">{error}</div>}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? '登录中…' : '登录'}
            </Button>
          </form>
        )}

        {mode === 'register' && (
          <form onSubmit={handleRegister} className="space-y-3">
            <EmailInput value={email} onChange={setEmail} />
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
            {error && <div className="text-xs text-destructive">{error}</div>}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? '注册中…' : '注册并登录'}
            </Button>
          </form>
        )}

        {mode === 'emailCode' && (
          <form onSubmit={handleVerifyCode} className="space-y-3">
            <EmailInput value={email} onChange={setEmail} />
            <CodeRow
              code={code}
              onChange={setCode}
              onSend={handleSendCode}
              cooldown={cooldown}
              codeSent={codeSent}
              pending={pending}
            />
            {notice && <div className="text-xs text-blue-700 dark:text-blue-400">{notice}</div>}
            {error && <div className="text-xs text-destructive">{error}</div>}
            <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
              {pending ? '验证中…' : '验证并登录'}
            </Button>
          </form>
        )}

        {mode === 'phone' && (
          <form onSubmit={handleVerifySms} className="space-y-3">
            <PhoneInput value={phone} onChange={setPhone} />
            <CodeRow
              code={code}
              onChange={setCode}
              onSend={handleSendSms}
              cooldown={cooldown}
              codeSent={codeSent}
              pending={pending}
            />
            {notice && <div className="text-xs text-blue-700 dark:text-blue-400">{notice}</div>}
            {error && <div className="text-xs text-destructive">{error}</div>}
            <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
              {pending ? '验证中…' : '验证并登录'}
            </Button>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleResetPassword} className="space-y-3">
            <EmailInput value={email} onChange={setEmail} />
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
            {notice && <div className="text-xs text-blue-700 dark:text-blue-400">{notice}</div>}
            {error && <div className="text-xs text-destructive">{error}</div>}
            <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
              {pending ? '重置中…' : '重置密码并登录'}
            </Button>
            <div className="text-center text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-primary underline-offset-2 hover:underline"
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
              <span className="relative z-10 bg-card px-2">或</span>
              <div className="absolute inset-y-1/2 left-0 right-0 border-t border-border" />
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={handleGoogle}>
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
                className="ml-1 text-primary underline-offset-2 hover:underline"
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
                className="ml-1 text-primary underline-offset-2 hover:underline"
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

function authErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  if (
    /unknown column|table .* doesn't exist|sql|database|response.*json|unexpected end of json|field list/i.test(
      trimmed,
    )
  ) {
    return fallback;
  }
  return trimmed;
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
      className={`flex-1 rounded px-2 py-1 font-medium transition ${active ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
    >
      {children}
    </button>
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
          value={code}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button
          type="button"
          variant="outline"
          onClick={onSend}
          disabled={pending || cooldown > 0}
          className="whitespace-nowrap"
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
}: {
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">邮箱</span>
      <input
        type="email"
        required
        autoComplete="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </label>
  );
}

/**
 * Phase 12 — phone-number input. Strips everything that isn't a
 * digit on input so paste-from-formatted (e.g. "+86 138-0000-1234")
 * lands as the canonical 11-digit form the backend regex expects.
 * Caps at 11 digits to keep the input physically incapable of
 * holding a +86 prefix.
 */
function PhoneInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">手机号</span>
      <div className="flex">
        <span className="inline-flex shrink-0 items-center rounded-l-md border border-r-0 border-input bg-muted/40 px-3 text-xs text-muted-foreground">
          +86
        </span>
        <input
          type="tel"
          inputMode="numeric"
          required
          maxLength={11}
          autoComplete="tel-national"
          placeholder="138 0000 0000"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 11))}
          className="w-full rounded-r-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
          className="w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? '隐藏密码' : '显示密码'}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );
}
