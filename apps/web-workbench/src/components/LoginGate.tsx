import * as React from 'react';
import { Button } from '@/components/ui/button';
import { setAccessToken } from '@/lib/auth';
import { trpc } from '@/lib/trpc';

interface Props {
  onAuthenticated: () => void;
}

type Mode = 'login' | 'register' | 'emailCode';

/**
 * Login / register card. Three modes:
 *   - login        : email + password → auth.login
 *   - register     : email + password + confirm → auth.register → auto-login
 *   - emailCode    : email → auth.sendCode → 6-digit code → auth.verifyCode
 *
 * Google OAuth button only appears when the server advertises the
 * feature via `auth.loginOptions` (env-gated on GOOGLE_CLIENT_ID).
 */
export function LoginGate({ onAuthenticated }: Props): JSX.Element {
  const [mode, setMode] = React.useState<Mode>('login');
  const [email, setEmail] = React.useState('');
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
  }>({ google: false, emailCode: false });

  // Fetch server-side login options once on mount.
  React.useEffect(() => {
    void (async () => {
      try {
        const res = await trpc.auth.loginOptions.query();
        setLoginOptions({ google: !!res.google, emailCode: !!res.emailCode });
      } catch {
        /* defaults: no optional methods */
      }
    })();
  }, []);

  // Resend-cooldown ticker for the email-code flow.
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const resetTransient = (): void => {
    setError(null);
    setNotice(null);
  };

  async function handleLogin(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    resetTransient();
    setPending(true);
    try {
      const res = await trpc.auth.login.mutate({ email, password });
      setAccessToken(res.accessToken);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  const handleGoogle = (): void => {
    // Backend sets up the OAuth URL; we just redirect. Callback will
    // return with a short-lived token in the URL fragment that
    // `lib/auth` picks up on next page load.
    window.location.href = '/api/auth/google';
  };

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="space-y-1 text-center">
          <div className="text-lg font-semibold tracking-tight">HOLA DAY Workbench</div>
          <div className="text-xs text-muted-foreground">
            {mode === 'register' ? '创建新账号' : '请登录继续'}
          </div>
        </div>

        {mode !== 'register' && (
          <div className="flex gap-1 rounded-md bg-muted/50 p-1 text-xs">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 rounded px-2 py-1 font-medium transition ${mode === 'login' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              密码登录
            </button>
            {loginOptions.emailCode && (
              <button
                type="button"
                onClick={() => setMode('emailCode')}
                className={`flex-1 rounded px-2 py-1 font-medium transition ${mode === 'emailCode' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                验证码登录
              </button>
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
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendCode}
                  disabled={pending || cooldown > 0}
                  className="whitespace-nowrap"
                >
                  {cooldown > 0 ? `${cooldown}s` : codeSent ? '重新发送' : '发送验证码'}
                </Button>
              </div>
            </div>
            {notice && <div className="text-xs text-emerald-700">{notice}</div>}
            {error && <div className="text-xs text-destructive">{error}</div>}
            <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
              {pending ? '验证中…' : '验证并登录'}
            </Button>
          </form>
        )}

        {loginOptions.google && mode !== 'register' && (
          <>
            <div className="relative text-center text-[10px] uppercase text-muted-foreground">
              <span className="relative z-10 bg-card px-2">或</span>
              <div className="absolute inset-y-1/2 left-0 right-0 border-t border-border" />
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={handleGoogle}>
              使用 Google 登录
            </Button>
          </>
        )}

        <div className="text-center text-xs text-muted-foreground">
          {mode === 'register' ? (
            <>
              已有账号？
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  resetTransient();
                }}
                className="ml-1 text-primary underline-offset-2 hover:underline"
              >
                直接登录
              </button>
            </>
          ) : (
            <>
              没有账号？
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  resetTransient();
                }}
                className="ml-1 text-primary underline-offset-2 hover:underline"
              >
                注册
              </button>
            </>
          )}
        </div>
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
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="password"
        required
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </label>
  );
}
