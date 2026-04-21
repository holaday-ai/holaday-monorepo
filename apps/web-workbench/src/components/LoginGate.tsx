import * as React from 'react';
import { Button } from '@/components/ui/button';
import { setAccessToken } from '@/lib/auth';
import { trpc } from '@/lib/trpc';

interface Props {
  onAuthenticated: () => void;
}

/**
 * Thin email/password form that calls tRPC `auth.login`, stashes the
 * returned access token in localStorage, and hands control back to the
 * app via `onAuthenticated`. Dev-mode only; real product replaces
 * this with OAuth / SSO plus a registration flow.
 */
export function LoginGate({ onAuthenticated }: Props): JSX.Element {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
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

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-8 shadow-sm"
      >
        <div className="space-y-1 text-center">
          <div className="text-lg font-semibold tracking-tight">HOLA DAY Workbench</div>
          <div className="text-xs text-muted-foreground">请使用你的账号登录</div>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">邮箱</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">密码</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>
        {error && <div className="text-xs text-destructive">{error}</div>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? '登录中…' : '登录'}
        </Button>
      </form>
    </div>
  );
}
