/**
 * Phase 14 — HOLA DAY Side Panel.
 *
 * The Side Panel is the "submit a task from any page" surface. It
 * lives next to whatever website the user is on, reads page context
 * (title / URL / selected text) automatically, and ships the intent
 * + context tail to tasks.create. Real-time progress comes from
 * the SW (which is already on the WS for vision-loop / step events)
 * via chrome.runtime.sendMessage, mirroring the popup pattern.
 *
 * What the Side Panel intentionally does NOT do (popup keeps owning
 * those flows): batch confirm UX, history list, multi-task
 * orchestration. The Side Panel is laser-focused on "1 page +
 * 1 task in flight"; users who want the rich view click the
 * "在 popup 中查看任务" button at the bottom.
 */

import { useEffect, useRef, useState } from 'react';
import { ORCHESTRATOR_HTTP } from '../shared/config.js';
import { composeContextTail, getActivePageContext, type PageContext } from '../shared/page-context.js';
import {
  type StoredUser,
  clearAccessToken,
  getAccessToken,
  getStoredUser,
  normalizeAccessToken,
  setAccessToken,
  setStoredUser,
} from '../shared/storage.js';

type Status = 'idle' | 'loading' | 'connected' | 'error';

type TaskStatus =
  | 'planning'
  | 'executing'
  | 'awaiting_user'
  | 'paused'
  | 'completed'
  | 'partial_success'
  | 'failed'
  | 'cancelled';

interface VisionProgressView {
  phase: 'observing' | 'deciding' | 'acting' | 'completed' | 'failed';
  tickIndex?: number;
  actionKind?: string;
  detail?: string;
}

interface TaskView {
  taskId: string;
  status: TaskStatus;
  steps: { id: string; kind: string; status: string }[];
  lastUpdated: number;
  visionProgress?: VisionProgressView;
}

interface MeResponse {
  result: {
    data: {
      userId: string;
      email: string;
      displayName: string | null;
      plan: string;
    };
  };
}

interface CreateTaskResponse {
  result: { data: { taskId: string; status: TaskStatus } };
}

const PAGE_CONTEXT_REFRESH_MS = 2_000;
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

export function App() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const authSyncSeq = useRef(0);

  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [intent, setIntent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskView[]>([]);

  // Mount: restore session, hydrate task snapshot from SW, refresh
  // page context. When no stored token, nudge the SW to try the
  // localStorage-based auto-login from any open workbench tab — if
  // it succeeds, hydrate the user via auth.me so the header shows
  // the real account instead of the login form.
  useEffect(() => {
    void (async () => {
      const stored = await getStoredUser();
      let tok = await getAccessToken();
      if (stored && tok) {
        setUser(stored);
        setToken(tok);
        setStatus('connected');
        void sendRuntimeMessage({ type: 'holaday.connect', token: tok });
      } else if (!tok) {
        const resp = await sendRuntimeMessage<{ ok?: boolean; token?: string | null }>({
          type: 'holaday.tryAutoLogin',
        });
        const liftedToken = resp?.token ?? null;
        if (liftedToken) {
          tok = liftedToken;
          const fetchedUser = await fetchMe(liftedToken);
          if (fetchedUser) {
            await setStoredUser(fetchedUser);
            setUser(fetchedUser);
            setToken(liftedToken);
            setStatus('connected');
          } else {
            // Token was rejected (expired, signed with a different
            // secret, or pointing at a deleted user). Drop it so the
            // panel falls back to the manual login form.
            try {
              await clearAccessToken();
            } catch {
              /* best-effort */
            }
          }
        }
      }
      const resp = await sendRuntimeMessage<{ tasks?: TaskView[] }>({ type: 'holaday.tasks' });
      if (resp?.tasks) setTasks(resp.tasks);
    })();
  }, []);

  // Cross-context sync: if the popup logs in / out in another window,
  // or the SW lifts a token via the keepalive alarm, the storage
  // change fires here and the panel reflects the new session
  // without a refresh.
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
          const fetchedUser = await fetchMe(newToken);
          if (seq !== authSyncSeq.current) return;
          if (fetchedUser) {
            await setStoredUser(fetchedUser);
            setUser(fetchedUser);
            setToken(newToken);
            setStatus('connected');
          }
        } else {
          authSyncSeq.current = seq;
          setUser(null);
          setToken(null);
          setStatus('idle');
        }
      })();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      try {
        const ctx = await getActivePageContext();
        if (!cancelled) setPageContext(ctx);
      } finally {
        inFlight = false;
      }
    }
    void refresh();
    const tabsListener = () => {
      void refresh();
    };
    const updatedListener = (
      _tabId: number,
      info: chrome.tabs.TabChangeInfo,
    ) => {
      // Re-read on URL change too — clicking a link inside the same
      // tab still warrants a fresh title/selection snapshot.
      if (info.url) void refresh();
    };
    chrome.tabs.onActivated.addListener(tabsListener);
    chrome.tabs.onUpdated.addListener(updatedListener);
    // Defensive periodic refresh — selection changes don't fire any
    // chrome.tabs event, so we sample on a slow interval.
    const intervalId = window.setInterval(() => void refresh(), PAGE_CONTEXT_REFRESH_MS);
    return () => {
      cancelled = true;
      chrome.tabs.onActivated.removeListener(tabsListener);
      chrome.tabs.onUpdated.removeListener(updatedListener);
      window.clearInterval(intervalId);
    };
  }, []);

  // Subscribe to SW snapshots so the result section reflects the
  // task's progress in real time without polling.
  useEffect(() => {
    const listener = (msg: { type?: string; tasks?: TaskView[]; taskId?: string }) => {
      if (msg?.type === 'holaday.tasks.update' && msg.tasks) setTasks(msg.tasks);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  /**
   * Pull the authenticated user record so we can show real name +
   * plan in the header after auto-login. Returns null on any error
   * so the caller treats it as "auto-login failed, fall back to
   * manual login form".
   */
  async function fetchMe(authToken: string): Promise<StoredUser | null> {
    try {
      const res = await fetch(`${ORCHESTRATOR_HTTP}/trpc/auth.me`, {
        method: 'GET',
        headers: { authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as MeResponse;
      const u = body.result.data;
      return {
        externalId: u.userId,
        email: u.email,
        plan: u.plan,
        displayName: u.displayName,
      };
    } catch {
      return null;
    }
  }

  /**
   * "我已登录，重试" button: nudges the SW to retry the
   * localStorage-based auto-login from any open workbench tab. If
   * the SW lifts a token, fetch the user via auth.me and hydrate
   * the UI directly (instead of waiting for the storage.onChanged
   * round trip). On failure, surfaces a hint about what to check.
   */
  async function retryAutoLogin(): Promise<void> {
    setStatus('loading');
    setError(null);
    try {
      const resp = await sendRuntimeMessage<{ ok?: boolean; token?: string | null }>({
        type: 'holaday.tryAutoLogin',
      });
      const liftedToken = resp?.token ?? null;
      if (!liftedToken) {
        setStatus('error');
        setError(
          '没找到已登录的 holaday.ai 标签页。请到 holaday.ai 登录后再点重试。',
        );
        return;
      }
      const fetchedUser = await fetchMe(liftedToken);
      if (!fetchedUser) {
        // Token was lifted but rejected by auth.me — likely expired
        // or signed with a different secret. Drop it so the next
        // retry doesn't keep looping with bad creds.
        try {
          await clearAccessToken();
        } catch {
          /* best-effort */
        }
        setStatus('error');
        setError('从 holaday.ai 取到的 token 已失效，请到 holaday.ai 重新登录。');
        return;
      }
      await setStoredUser(fetchedUser);
      setUser(fetchedUser);
      setToken(liftedToken);
      setStatus('connected');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function logout(): Promise<void> {
    await clearAccessToken();
    void sendRuntimeMessage({ type: 'holaday.disconnect' });
    setUser(null);
    setToken(null);
    setActiveTaskId(null);
    setTasks([]);
    setStatus('idle');
  }

  async function createTask(): Promise<void> {
    if (!intent.trim() || !token) return;
    setSubmitting(true);
    setError(null);
    try {
      const tail = composeContextTail(pageContext);
      const fullIntent = tail ? `${intent.trim()}${tail}` : intent.trim();
      const res = await fetch(`${ORCHESTRATOR_HTTP}/trpc/tasks.create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ intent: fullIntent }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as CreateTaskResponse;
      const newTaskId = body.result.data.taskId;
      setActiveTaskId(newTaskId);
      setIntent('');
      // Nudge the SW to push the latest snapshot — the SW updates
      // arrive via the listener above as the WS frames flow in.
      const resp = await sendRuntimeMessage<{ tasks?: TaskView[] }>({ type: 'holaday.tasks' });
      if (resp?.tasks) setTasks(resp.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) {
    return (
      <div style={containerStyle}>
        <header style={brandHeader}>HOLA DAY</header>
        <div style={panelStyle}>
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 4, lineHeight: 1.55 }}>
            请先到 <strong>holaday.ai</strong> 登录后重新打开侧边栏。
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6, lineHeight: 1.5 }}>
            侧边栏会从已登录的 holaday.ai 标签自动同步登录态，无需在这里再输一遍。
          </div>
          <button
            type="button"
            disabled={status === 'loading'}
            onClick={() => void retryAutoLogin()}
            style={primaryBtn}
          >
            {status === 'loading' ? '同步中...' : '我已登录，重试'}
          </button>
          {error ? <div style={errorStyle}>{error}</div> : null}
        </div>
      </div>
    );
  }

  const activeTask =
    (activeTaskId && tasks.find((t) => t.taskId === activeTaskId)) ||
    tasks.find(
      (t) =>
        t.status === 'planning' ||
        t.status === 'executing' ||
        t.status === 'awaiting_user',
    ) ||
    null;

  return (
    <div style={containerStyle}>
      <header style={accountHeader}>
        <div>
          <div style={{ fontWeight: 600 }}>{user.displayName ?? user.email}</div>
          <div style={metaSubStyle}>
            {user.email} · plan: {user.plan}
          </div>
        </div>
        <button type="button" onClick={() => void logout()} style={miniBtn}>
          登出
        </button>
      </header>

      <ContextPreview context={pageContext} />

      <div style={panelStyle}>
        <textarea
          rows={3}
          placeholder="想让 HOLA DAY 在这页面上做什么？"
          value={intent}
          onChange={(e) => setIntent(e.currentTarget.value)}
          style={textareaStyle}
        />
        <button
          type="button"
          disabled={submitting || !intent.trim()}
          onClick={() => void createTask()}
          style={primaryBtn}
        >
          {submitting ? '提交中...' : '发送任务'}
        </button>
        {error ? <div style={errorStyle}>{error}</div> : null}
      </div>

      <ActiveTaskCard task={activeTask} />

      <footer style={footerStyle}>
        <span style={{ opacity: 0.6 }}>多任务历史请打开扩展弹窗</span>
      </footer>
    </div>
  );
}

function ContextPreview({ context }: { context: PageContext | null }) {
  if (!context || (!context.title && !context.url)) return null;
  const url = context.url || '';
  const display = context.title || url;
  return (
    <div style={contextStyle}>
      <div style={contextLabel}>当前页面</div>
      <div style={{ fontWeight: 500, lineHeight: 1.35 }}>{display}</div>
      {context.url ? <div style={contextUrl}>{shortenUrl(context.url)}</div> : null}
      {context.selectedText.trim() ? (
        <div style={selectionBox}>
          <div style={contextLabel}>选中内容</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{truncate(context.selectedText.trim(), 240)}</div>
        </div>
      ) : null}
    </div>
  );
}

function ActiveTaskCard({ task }: { task: TaskView | null }) {
  if (!task) return null;
  const phaseLabel = task.visionProgress ? renderVisionPhase(task.visionProgress) : null;
  return (
    <div style={taskCardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontFamily: 'monospace', fontSize: 11, opacity: 0.6 }}>{task.taskId}</div>
        <StatusBadge status={task.status} />
      </div>
      {phaseLabel ? <div style={phaseLineStyle}>{phaseLabel}</div> : null}
      {task.visionProgress?.detail ? (
        <div style={detailStyle}>{task.visionProgress.detail}</div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const palette: Record<TaskStatus, { bg: string; fg: string; label: string }> = {
    planning: { bg: '#e0e7ff', fg: '#3730a3', label: '规划中' },
    executing: { bg: '#dbeafe', fg: '#1e40af', label: '执行中' },
    awaiting_user: { bg: '#fef3c7', fg: '#92400e', label: '待确认' },
    paused: { bg: '#fde68a', fg: '#78350f', label: '已暂停' },
    completed: { bg: '#e5e7eb', fg: '#111827', label: '已完成' },
    partial_success: { bg: '#fff7d6', fg: '#8a6a00', label: '部分完成' },
    failed: { bg: '#fee2e2', fg: '#991b1b', label: '失败' },
    cancelled: { bg: '#e5e7eb', fg: '#374151', label: '已取消' },
  };
  const v = palette[status];
  return (
    <span
      style={{
        background: v.bg,
        color: v.fg,
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 4,
        fontWeight: 500,
      }}
    >
      {v.label}
    </span>
  );
}

function renderVisionPhase(p: VisionProgressView): string {
  switch (p.phase) {
    case 'observing':
      return `截图观察${typeof p.tickIndex === 'number' ? ` · 第 ${p.tickIndex + 1} 轮` : ''}`;
    case 'deciding':
      return `AI 分析中${typeof p.tickIndex === 'number' ? ` · 第 ${p.tickIndex + 1} 轮` : ''}`;
    case 'acting':
      return `执行操作${p.actionKind ? `（${p.actionKind}）` : ''}`;
    case 'completed':
      return '任务完成';
    case 'failed':
      return '任务失败';
  }
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.length > 1 ? u.pathname : ''}`;
  } catch {
    return url;
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

const containerStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  padding: '12px 14px',
  gap: 10,
  background: '#f9fafb',
  overflowY: 'auto',
};

const brandHeader: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  letterSpacing: 0.5,
};

const accountHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const panelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 10,
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
};

const inputStyle: React.CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 4,
  padding: '6px 8px',
  fontSize: 13,
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  fontFamily: 'inherit',
  lineHeight: 1.5,
};

const primaryBtn: React.CSSProperties = {
  background: '#111827',
  color: '#ffffff',
  border: 'none',
  borderRadius: 4,
  padding: '7px 12px',
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 500,
};

const miniBtn: React.CSSProperties = {
  background: '#ffffff',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 11,
  cursor: 'pointer',
};

const errorStyle: React.CSSProperties = {
  color: '#991b1b',
  fontSize: 12,
};

const metaSubStyle: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.6,
};

const contextStyle: React.CSSProperties = {
  padding: 10,
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const contextLabel: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: '#6b7280',
};

const contextUrl: React.CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  fontFamily: 'monospace',
  wordBreak: 'break-all',
};

const selectionBox: React.CSSProperties = {
  marginTop: 4,
  padding: 6,
  background: '#fafafa',
  border: '1px dashed #e5e7eb',
  borderRadius: 4,
  fontSize: 12,
  lineHeight: 1.4,
};

const taskCardStyle: React.CSSProperties = {
  padding: 10,
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const phaseLineStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#1f2937',
  fontWeight: 500,
};

const detailStyle: React.CSSProperties = {
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  color: '#374151',
};

const footerStyle: React.CSSProperties = {
  marginTop: 'auto',
  fontSize: 11,
  color: '#6b7280',
  textAlign: 'center',
  paddingTop: 8,
  borderTop: '1px solid #e5e7eb',
};
