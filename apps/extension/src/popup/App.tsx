/**
 * Phase 25c — minimalist popup.
 *
 * The popup is purely a status surface, not a task launcher. Tasks
 * are created on the web workbench; the extension handles login-state
 * sync + browsing-history sync only. Three regions, top to bottom:
 *
 *   1. UserCard           — avatar (initial circle) + name + email +
 *                            plan badge
 *   2. BrowsingStatusBlock — "已同步 N 个常用网站" + sync toggle +
 *                            "常去" tag chips
 *   3. BottomBar           — "前往网页" CTA + version (small grey)
 *
 * Removed in this round:
 *   - tasks list, task cards, "Run" button + intent textarea
 *   - history section
 *   - top "侧边栏 / 调试 / Sign out" buttons
 *   - email/password manual login form (was already gone — auth lives
 *     on the web side, auth-bridge content script syncs the token)
 *
 * Auth wiring preserved:
 *   - mount path: getStoredUser + getAccessToken; if token-no-user,
 *     fetchMe with 401-vs-network distinction (no clearAccessToken on
 *     network errors — see Phase 25b commit 1b56faa).
 *   - storage.onChanged listener: re-renders when the auth-bridge
 *     content script (on a workbench tab) pushes a token change.
 *   - resetConnection escape hatch retained (popup's "重置连接" link).
 *
 * Visual:
 *   - HOLA DAY magenta #E50B6B for plan badge + toggle accent + CTA
 *   - 360 px wide, height auto
 *   - prefers-color-scheme dark mode via matchMedia + theme tokens
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ORCHESTRATOR_HTTP, WORKBENCH_URL } from '../shared/config.js';
import { withDeadline } from '../shared/deadline.js';
import { fetchWithDeadline } from '../shared/http.js';
import { openOrFocusWorkbench } from '../shared/open-workbench.js';
import {
  type StoredUser,
  clearAccessToken,
  clearStoredUser,
  getAccessToken,
  getStoredUser,
  normalizeAccessToken,
  setStoredUser,
} from '../shared/storage.js';

// chrome.storage keys mirrored from background/history-sync.ts. Reading
// directly avoids a SW round-trip on every popup render.
const HISTORY_SYNC_ENABLED_KEY = 'holaday.history.enabled';
const HISTORY_SYNC_SUMMARY_KEY = 'holaday.history.lastSyncSummary';
const AUTH_ME_TIMEOUT_MS = 8_000;
const POPUP_STORAGE_TIMEOUT_MS = 1_500;

interface HistorySyncSummary {
  ingested: number;
  topDomains: string[];
  at: number;
}

interface WsConnectionStatus {
  connected: boolean;
  readyState: number | null;
  reconnectAttempt: number;
  reconnectCapped: boolean;
  lastOpenAt: number | null;
  lastCloseAt: number | null;
  lastCloseCode: number | null;
  lastCloseReason: string | null;
  lastErrorAt: number | null;
  nextRetryAt: number | null;
}

interface ExtensionStatusResponse {
  lastWelcomeAt: number | null;
  ws?: WsConnectionStatus;
}

interface MeResponse {
  result: {
    data: {
      userId: string;
      email: string;
      plan: string;
      displayName: string;
    };
  };
}

const RUNTIME_MESSAGE_TIMEOUT_MS = 5_000;

function sendRuntimeMessage<T>(message: unknown): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: number | null = null;
    const finish = (value: T | null): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      resolve(value);
    };
    timer = window.setTimeout(() => finish(null), RUNTIME_MESSAGE_TIMEOUT_MS);
    try {
      chrome.runtime.sendMessage(message, (response?: T) => {
        if (chrome.runtime.lastError) {
          finish(null);
          return;
        }
        finish(response ?? null);
      });
    } catch {
      finish(null);
    }
  });
}

type FetchMeResult =
  | { kind: 'ok'; user: StoredUser }
  | { kind: 'unauthorized' }
  | { kind: 'network' };

const BRAND_MAGENTA = '#E50B6B';

interface ThemeTokens {
  bg: string;
  cardBg: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  divider: string;
  hintBg: string;
  hintBorder: string;
  hintText: string;
  tagBg: string;
  tagText: string;
  buttonSecondaryBg: string;
  buttonSecondaryBorder: string;
  buttonSecondaryText: string;
  toggleTrackOff: string;
}

const LIGHT_THEME: ThemeTokens = {
  bg: '#ffffff',
  cardBg: '#ffffff',
  cardBorder: '#e5e7eb',
  textPrimary: '#111827',
  textSecondary: '#374151',
  textMuted: '#6b7280',
  divider: '#f3f4f6',
  hintBg: '#fdf2f8',
  hintBorder: '#fbcfe8',
  hintText: '#9d174d',
  tagBg: '#fce7f3',
  tagText: '#9d174d',
  buttonSecondaryBg: '#f9fafb',
  buttonSecondaryBorder: '#e5e7eb',
  buttonSecondaryText: '#374151',
  toggleTrackOff: '#d1d5db',
};

const DARK_THEME: ThemeTokens = {
  bg: '#0f172a',
  cardBg: '#1e293b',
  cardBorder: '#334155',
  textPrimary: '#f1f5f9',
  textSecondary: '#cbd5e1',
  textMuted: '#94a3b8',
  divider: '#1e293b',
  hintBg: '#3f0a26',
  hintBorder: '#831843',
  hintText: '#fbcfe8',
  tagBg: '#3f0a26',
  tagText: '#fbcfe8',
  buttonSecondaryBg: '#1e293b',
  buttonSecondaryBorder: '#334155',
  buttonSecondaryText: '#cbd5e1',
  toggleTrackOff: '#475569',
};

/**
 * Subscribe to prefers-color-scheme + return `true` when the user's
 * system theme is dark. The matchMedia listener fires when the user
 * toggles their OS theme while the popup is open — the popup re-
 * renders with the new theme without needing a reopen.
 */
function useDarkMode(): boolean {
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);
  return dark;
}

async function fetchMe(authToken: string): Promise<FetchMeResult> {
  try {
    const res = await fetchWithDeadline(
      `${ORCHESTRATOR_HTTP}/trpc/auth.me`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${authToken}` },
      },
      AUTH_ME_TIMEOUT_MS,
      'popup_auth_me_timeout',
    );
    if (res.status === 401) return { kind: 'unauthorized' };
    if (!res.ok) return { kind: 'network' };
    const body = (await res.json()) as MeResponse;
    const u = body.result.data;
    return {
      kind: 'ok',
      user: {
        externalId: u.userId,
        email: u.email,
        plan: u.plan,
        displayName: u.displayName,
      },
    };
  } catch {
    return { kind: 'network' };
  }
}

export function App() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [, setToken] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const authSyncSeq = useRef(0);
  const dark = useDarkMode();
  const t = dark ? DARK_THEME : LIGHT_THEME;

  // Mount: hydrate user + token from chrome.storage. If we have a
  // token but no cached user record (fresh install / cleared cache),
  // fetch from /auth.me. Only clear the token on a definitive 401 —
  // network errors leave it intact so the SW's WS path can retry.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await getStoredUser();
      const tok = await getAccessToken();
      if (cancelled) return;
      if (stored && tok) {
        setUser(stored);
        setToken(tok);
        void sendRuntimeMessage({ type: 'holaday.connect', token: tok });
      } else if (tok && !stored) {
        const result = await fetchMe(tok);
        if (cancelled) return;
        if (result.kind === 'ok') {
          await setStoredUser(result.user);
          setUser(result.user);
          setToken(tok);
          void sendRuntimeMessage({ type: 'holaday.connect', token: tok });
        } else if (result.kind === 'unauthorized') {
          await clearAccessToken();
        }
        // 'network' → leave token, render logged-out view this render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cross-context auth sync: the auth-bridge content script on any
  // workbench tab posts token changes to the SW, which writes them
  // to chrome.storage.local. This listener keeps popup state coherent
  // without requiring the user to close/reopen the popup.
  useEffect(() => {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ) => {
      if (area !== 'local') return;
      const tokenChange = changes['holaday.access_token'];
      if (!tokenChange) return;
      void (async () => {
        const seq = ++authSyncSeq.current;
        const newToken = normalizeAccessToken(tokenChange.newValue);
        if (newToken) {
          const result = await fetchMe(newToken);
          if (seq !== authSyncSeq.current) return;
          if (result.kind === 'ok') {
            await setStoredUser(result.user);
            setUser(result.user);
            setToken(newToken);
          } else {
            // 401 or network — leave popup in logged-out view; SW
            // is the authority on token validity.
            setUser(null);
            setToken(null);
          }
        } else {
          authSyncSeq.current = seq;
          setUser(null);
          setToken(null);
        }
      })();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  async function resetConnection(): Promise<void> {
    if (resetting) return;
    setResetting(true);
    try {
      const response = await sendRuntimeMessage<{ ok?: boolean }>({
        type: 'holaday.resetConnection',
      });
      if (!response) {
        await clearAccessToken();
        await clearStoredUser();
      }
      setUser(null);
      setToken(null);
    } finally {
      setResetting(false);
    }
  }

  /**
   * Phase 25c — open OR focus the workbench tab. Previously this
   * called chrome.tabs.create unconditionally so every CTA click
   * spawned a duplicate. openOrFocusWorkbench searches existing tabs
   * for hd-app.orangebench.tech / holaday.ai and activates the
   * matching tab (and its window) when found; only creates fresh
   * when nothing matches. window.close() runs AFTER the focus call
   * resolves so Chrome doesn't race the popup-close with the tab-
   * switch animation.
   */
  function openWebLogin(): void {
    void openOrFocusWorkbench(WORKBENCH_URL).then(() => window.close());
  }

  if (!user) {
    return <LoggedOutView theme={t} onLogin={openWebLogin} onReset={resetConnection} resetting={resetting} />;
  }

  return (
    <div style={appShell(t)}>
      <UserCard user={user} theme={t} />
      <ConnectionStatusBlock theme={t} />
      <BrowsingStatusBlock theme={t} />
      <BottomBar theme={t} onOpenWeb={openWebLogin} onReset={resetConnection} resetting={resetting} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logged-out view
// ---------------------------------------------------------------------------

function LoggedOutView({
  theme,
  onLogin,
  onReset,
  resetting,
}: {
  theme: ThemeTokens;
  onLogin: () => void;
  onReset: () => void;
  resetting: boolean;
}) {
  return (
    <div style={appShell(theme)}>
      <div style={loggedOutCard(theme)}>
        <div style={{ fontSize: 18, fontWeight: 600, color: theme.textPrimary, marginBottom: 8 }}>
          HOLA DAY
        </div>
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: theme.textSecondary,
            marginBottom: 14,
          }}
        >
          请先在 HOLA DAY 网页登录。扩展会自动同步登录态，无需在这里输入账号。
        </div>
        <button type="button" onClick={onLogin} style={primaryBtn}>
          前往 HOLA DAY 登录
        </button>
      </div>
      <BottomBar theme={theme} onOpenWeb={onLogin} onReset={onReset} resetting={resetting} hideOpenWeb />
    </div>
  );
}

// ---------------------------------------------------------------------------
// User card
// ---------------------------------------------------------------------------

function UserCard({ user, theme }: { user: StoredUser; theme: ThemeTokens }) {
  const displayName = user.displayName?.trim() || user.email.split('@')[0] || '未命名';
  const initial = (displayName.trim().charAt(0) || user.email.charAt(0) || '?').toUpperCase();
  return (
    <div style={card(theme)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={avatar}>{initial}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: theme.textPrimary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={displayName}
          >
            {displayName}
          </div>
          <div
            style={{
              fontSize: 13,
              color: theme.textMuted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: 2,
            }}
            title={user.email}
          >
            {user.email}
          </div>
        </div>
        <PlanBadge plan={user.plan} />
      </div>
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const label = friendlyPlanLabel(plan);
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '3px 8px',
        borderRadius: 4,
        background: BRAND_MAGENTA,
        color: '#ffffff',
        letterSpacing: 0.2,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function friendlyPlanLabel(plan: string): string {
  switch (plan) {
    case 'free':
      return 'FREE';
    case 'basic':
      return 'BASIC';
    case 'pro':
      return 'PRO';
    case 'team':
      return 'TEAM';
    default:
      return plan.toUpperCase();
  }
}

// ---------------------------------------------------------------------------
// Connection status
// ---------------------------------------------------------------------------

function ConnectionStatusBlock({ theme }: { theme: ThemeTokens }) {
  const [status, setStatus] = useState<ExtensionStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const refresh = (): void => {
      if (inFlight) return;
      inFlight = true;
      void sendRuntimeMessage<ExtensionStatusResponse>({ type: 'holaday.status' }).then(
        (response) => {
          inFlight = false;
          if (cancelled) return;
          setStatus(response ?? null);
        },
      );
    };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const ws = status?.ws;
  const copy = getConnectionStatusCopy(status);
  const dotColor = ws?.connected ? '#16a34a' : ws?.reconnectCapped ? '#ef4444' : '#f59e0b';

  return (
    <div style={connectionStatus(theme)} title={copy.detail}>
      <span aria-hidden="true" style={{ ...connectionDot, background: dotColor }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: theme.textSecondary, fontSize: 12, fontWeight: 600 }}>{copy.title}</div>
        <div style={{ color: theme.textMuted, fontSize: 11, marginTop: 2 }}>{copy.detail}</div>
      </div>
    </div>
  );
}

function getConnectionStatusCopy(status: ExtensionStatusResponse | null): {
  title: string;
  detail: string;
} {
  if (!status?.ws) {
    return { title: '浏览器代理状态同步中', detail: '正在读取扩展后台连接状态' };
  }
  if (status.ws.connected) {
    return {
      title: '浏览器代理已连接',
      detail: status.lastWelcomeAt ? `最近确认：${formatRelativeTime(status.lastWelcomeAt)}` : 'WebSocket 已连接',
    };
  }
  if (status.ws.reconnectCapped) {
    return {
      title: '浏览器代理连接已暂停',
      detail: '多次重连失败，点击底部“重置连接”后会重新尝试',
    };
  }
  if (status.ws.reconnectAttempt > 0) {
    return {
      title: `浏览器代理正在重连（${status.ws.reconnectAttempt}/3）`,
      detail: status.ws.nextRetryAt ? `下次尝试：${formatRelativeTime(status.ws.nextRetryAt)}` : '等待下一次重连',
    };
  }
  return { title: '浏览器代理等待连接', detail: '打开 HOLA DAY 网页后会自动同步登录态' };
}

function formatRelativeTime(at: number): string {
  const deltaMs = at - Date.now();
  const absSeconds = Math.max(0, Math.round(Math.abs(deltaMs) / 1000));
  if (absSeconds < 5) return '刚刚';
  if (absSeconds < 60) return deltaMs >= 0 ? `${absSeconds} 秒后` : `${absSeconds} 秒前`;
  const minutes = Math.round(absSeconds / 60);
  return deltaMs >= 0 ? `${minutes} 分钟后` : `${minutes} 分钟前`;
}

// ---------------------------------------------------------------------------
// Browsing status (existing — restyled to the new theme)
// ---------------------------------------------------------------------------

function BrowsingStatusBlock({ theme }: { theme: ThemeTokens }) {
  const [summary, setSummary] = useState<HistorySyncSummary | null>(null);
  const [enabled, setEnabled] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await withDeadline(
          chrome.storage.local.get([HISTORY_SYNC_SUMMARY_KEY, HISTORY_SYNC_ENABLED_KEY]),
          POPUP_STORAGE_TIMEOUT_MS,
          'popup_history_storage_read_timeout',
        );
        if (cancelled) return;
        const s = r[HISTORY_SYNC_SUMMARY_KEY];
        if (
          s &&
          typeof s === 'object' &&
          typeof (s as { ingested?: unknown }).ingested === 'number'
        ) {
          setSummary(s as HistorySyncSummary);
        }
        setEnabled(r[HISTORY_SYNC_ENABLED_KEY] !== false);
      } catch {
        // Keep default ON + empty summary; storage changes will still refresh the card.
      }
    })();
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ): void => {
      if (area !== 'local') return;
      if (HISTORY_SYNC_SUMMARY_KEY in changes) {
        const next = changes[HISTORY_SYNC_SUMMARY_KEY]?.newValue;
        if (next && typeof next === 'object') setSummary(next as HistorySyncSummary);
      }
      if (HISTORY_SYNC_ENABLED_KEY in changes) {
        setEnabled(changes[HISTORY_SYNC_ENABLED_KEY]?.newValue !== false);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  async function toggleEnabled(): Promise<void> {
    const next = !enabled;
    setEnabled(next);
    try {
      await withDeadline(
        chrome.storage.local.set({ [HISTORY_SYNC_ENABLED_KEY]: next }),
        POPUP_STORAGE_TIMEOUT_MS,
        'popup_history_storage_write_timeout',
      );
    } catch {
      setEnabled(enabled);
    }
  }

  const headline = useMemo(() => {
    if (summary && summary.ingested > 0) return `已同步 ${summary.ingested} 个常用网站`;
    if (enabled) return '正在学习你的浏览习惯…';
    return '浏览记录同步已关闭';
  }, [summary, enabled]);

  const topTags = summary?.topDomains?.slice(0, 6) ?? [];

  return (
    <div style={card(theme)}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: theme.textPrimary,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span aria-hidden="true" style={{ color: BRAND_MAGENTA, fontSize: 16 }}>
              ●
            </span>
            {headline}
          </div>
          <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 4, lineHeight: 1.4 }}>
            只上传域名 + 访问次数，不会上传完整 URL 或页面内容
          </div>
        </div>
        <ToggleSwitch theme={theme} checked={enabled} onChange={() => void toggleEnabled()} />
      </div>
      {topTags.length > 0 ? (
        <div style={tagRow}>
          {topTags.map((d) => (
            <span key={d} style={tag(theme)}>
              {d}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToggleSwitch({
  theme,
  checked,
  onChange,
}: {
  theme: ThemeTokens;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="同步浏览记录"
      onClick={onChange}
      style={{
        position: 'relative',
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        background: checked ? BRAND_MAGENTA : theme.toggleTrackOff,
        transition: 'background 120ms ease',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#ffffff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
          transition: 'left 120ms ease',
        }}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Bottom bar
// ---------------------------------------------------------------------------

function BottomBar({
  theme,
  onOpenWeb,
  onReset,
  resetting,
  hideOpenWeb,
}: {
  theme: ThemeTokens;
  onOpenWeb: () => void;
  onReset: () => void;
  resetting: boolean;
  hideOpenWeb?: boolean;
}) {
  const version = chrome.runtime.getManifest().version;
  return (
    <div style={bottomBar(theme)}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {!hideOpenWeb && (
          <button type="button" onClick={onOpenWeb} style={secondaryBtn(theme)} title="打开 HOLA DAY 网页">
            前往网页
          </button>
        )}
        <button
          type="button"
          onClick={onReset}
          disabled={resetting}
          style={secondaryBtn(theme)}
          title="清除扩展存储的登录态，重新同步网页 token"
        >
          {resetting ? '重置中…' : '重置连接'}
        </button>
      </div>
      <span style={{ fontSize: 11, color: theme.textMuted }}>v{version}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const appShell = (t: ThemeTokens): React.CSSProperties => ({
  width: 360,
  background: t.bg,
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  padding: 12,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
});

const card = (t: ThemeTokens): React.CSSProperties => ({
  background: t.cardBg,
  border: `1px solid ${t.cardBorder}`,
  borderRadius: 10,
  padding: 16,
});

const loggedOutCard = (t: ThemeTokens): React.CSSProperties => ({
  background: t.cardBg,
  border: `1px solid ${t.cardBorder}`,
  borderRadius: 10,
  padding: 18,
});

const avatar: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: '50%',
  background: `linear-gradient(135deg, ${BRAND_MAGENTA} 0%, #d8004f 100%)`,
  color: '#ffffff',
  fontSize: 16,
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const tagRow: React.CSSProperties = {
  marginTop: 10,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const tag = (t: ThemeTokens): React.CSSProperties => ({
  fontSize: 11,
  padding: '3px 8px',
  borderRadius: 999,
  background: t.tagBg,
  color: t.tagText,
  border: `1px solid ${t.cardBorder}`,
  lineHeight: 1.4,
});

const connectionStatus = (t: ThemeTokens): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  padding: '9px 11px',
  borderRadius: 8,
  background: t.buttonSecondaryBg,
  border: `1px solid ${t.cardBorder}`,
});

const connectionDot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
};

const bottomBar = (t: ThemeTokens): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  paddingTop: 6,
  borderTop: `1px solid ${t.divider}`,
  marginTop: 2,
});

const primaryBtn: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  fontSize: 13,
  fontWeight: 600,
  background: BRAND_MAGENTA,
  color: '#ffffff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};

const secondaryBtn = (t: ThemeTokens): React.CSSProperties => ({
  padding: '5px 10px',
  fontSize: 11,
  background: t.buttonSecondaryBg,
  color: t.buttonSecondaryText,
  border: `1px solid ${t.buttonSecondaryBorder}`,
  borderRadius: 4,
  cursor: 'pointer',
});
