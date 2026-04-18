import { useEffect, useState } from 'react';
import { ORCHESTRATOR_HTTP } from '../shared/config.js';
import {
  type StoredUser,
  clearAccessToken,
  getAccessToken,
  getStoredUser,
  setAccessToken,
  setStoredUser,
} from '../shared/storage.js';

type Status = 'idle' | 'loading' | 'connected' | 'error';

interface LoginResponse {
  result: {
    data: {
      user: StoredUser;
      accessToken: string;
    };
  };
}

export function App() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [lastWelcome, setLastWelcome] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const stored = await getStoredUser();
      const token = await getAccessToken();
      if (stored && token) {
        setUser(stored);
        setStatus('connected');
        chrome.runtime.sendMessage({ type: 'holaday.connect', token });
      }
    })();
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'holaday.status' }, (resp) => {
        if (resp?.lastWelcomeAt) setLastWelcome(resp.lastWelcomeAt);
      });
    }, 2_000);
    return () => clearInterval(id);
  }, []);

  async function login() {
    setStatus('loading');
    setError(null);
    try {
      // tRPC mutation over HTTP. We hand-roll the request to keep the
      // popup zero-deps; full @trpc/client lands when web app does.
      const res = await fetch(`${ORCHESTRATOR_HTTP}/trpc/auth.login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as LoginResponse;
      const data = body.result.data;
      await setAccessToken(data.accessToken);
      await setStoredUser(data.user);
      setUser(data.user);
      setStatus('connected');
      chrome.runtime.sendMessage({ type: 'holaday.connect', token: data.accessToken });
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function logout() {
    await clearAccessToken();
    chrome.runtime.sendMessage({ type: 'holaday.disconnect' });
    setUser(null);
    setStatus('idle');
  }

  if (user) {
    return (
      <div>
        <h3 style={{ margin: '0 0 8px' }}>HOLA DAY</h3>
        <div style={{ fontSize: 13, marginBottom: 8 }}>
          <div>{user.displayName ?? user.email}</div>
          <div style={{ opacity: 0.6 }}>{user.email}</div>
          <div style={{ opacity: 0.6 }}>plan: {user.plan}</div>
        </div>
        <div style={{ fontSize: 12, marginBottom: 8 }}>
          {lastWelcome
            ? `last welcome: ${new Date(lastWelcome).toLocaleTimeString()}`
            : 'connecting...'}
        </div>
        <button type="button" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 8px' }}>HOLA DAY</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input
          type="email"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
        <input
          type="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
        />
        <button type="button" disabled={status === 'loading'} onClick={() => void login()}>
          {status === 'loading' ? 'Signing in...' : 'Sign in'}
        </button>
        {error ? <div style={{ color: 'crimson', fontSize: 12 }}>{error}</div> : null}
      </div>
    </div>
  );
}
