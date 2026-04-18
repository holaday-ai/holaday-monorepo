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

type TaskStatus =
  | 'planning'
  | 'executing'
  | 'awaiting_user'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

type PauseReason = 'user' | 'retries_exhausted' | 'quota_exceeded';

interface StepView {
  id: string;
  kind: string;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'awaiting_user';
}

interface BatchItemView {
  label: string;
  preview: string;
  meta?: Record<string, unknown>;
}

type PendingConfirmView =
  | {
      kind: 'single';
      stepId: string;
      prompt: string;
      risk: 'low' | 'medium' | 'high';
    }
  | {
      kind: 'batch';
      stepId: string;
      batchIndex: number;
      batchTotal: number;
      items: BatchItemView[];
      risk: 'low' | 'medium' | 'high';
      summary?: string;
    };

interface TaskView {
  taskId: string;
  status: TaskStatus;
  steps: StepView[];
  pendingConfirm?: PendingConfirmView | null;
  pauseReason?: PauseReason | null;
  lastUpdated: number;
}

interface LoginResponse {
  result: { data: { user: StoredUser; accessToken: string } };
}

interface CreateTaskResponse {
  result: { data: { taskId: string; status: TaskStatus; steps: StepView[] } };
}

export function App() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [intent, setIntent] = useState('帮我整理今天半导体板块的要闻');
  const [submitting, setSubmitting] = useState(false);
  /**
   * Per-task in-flight lock. Keyed by taskId, value is the action that
   * locked it ("confirm", "pause", "resume"). While set, the card's
   * Confirm/Skip/Cancel/Pause/Resume buttons are disabled — prevents the
   * second click from hitting a stale awaiting_user and getting 412.
   */
  const [inFlight, setInFlight] = useState<Record<string, string>>({});

  // On mount: restore session, hydrate tasks from SW.
  useEffect(() => {
    void (async () => {
      const stored = await getStoredUser();
      const tok = await getAccessToken();
      if (stored && tok) {
        setUser(stored);
        setToken(tok);
        setStatus('connected');
        chrome.runtime.sendMessage({ type: 'holaday.connect', token: tok });
      }
      chrome.runtime.sendMessage({ type: 'holaday.tasks' }, (resp) => {
        if (resp?.tasks) setTasks(resp.tasks as TaskView[]);
      });
    })();
  }, []);

  // Subscribe to SW task snapshots while popup is open.
  useEffect(() => {
    const listener = (msg: { type?: string; tasks?: TaskView[] }) => {
      if (msg?.type === 'holaday.tasks.update' && msg.tasks) setTasks(msg.tasks);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  async function login() {
    setStatus('loading');
    setError(null);
    try {
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
      setToken(data.accessToken);
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
    setToken(null);
    setTasks([]);
    setStatus('idle');
  }

  async function createTask() {
    if (!intent.trim() || !token) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${ORCHESTRATOR_HTTP}/trpc/tasks.create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ intent: intent.trim(), occupation: 'finance-research' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as CreateTaskResponse;
      // SW will observe dispatches + advance; we just nudge it to show the new task eagerly.
      chrome.runtime.sendMessage({ type: 'holaday.tasks' }, (resp) => {
        if (resp?.tasks) setTasks(resp.tasks as TaskView[]);
      });
      console.info('[holaday] task created', body.result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Diagnostic: drive the SW ↔ orchestrator ↔ adapter loop against a
   * hardcoded Baidu search plan (no Opus call). If this green-lights
   * when Opus-planned runs don't, the planner is the weak link, not
   * the adapter.
   */
  async function runSmokeTest() {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${ORCHESTRATOR_HTTP}/trpc/tasks.smokeTest`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as CreateTaskResponse;
      chrome.runtime.sendMessage({ type: 'holaday.tasks' }, (resp) => {
        if (resp?.tasks) setTasks(resp.tasks as TaskView[]);
      });
      console.info('[holaday] smoke test started', body.result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function controlTask(taskId: string, route: 'pause' | 'resume' | 'cancel'): Promise<void> {
    if (!token) return;
    if (inFlight[taskId]) return; // guard: already have a request in flight for this task
    setInFlight((m) => ({ ...m, [taskId]: route }));
    try {
      const res = await fetch(`${ORCHESTRATOR_HTTP}/trpc/tasks.${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ taskId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInFlight((m) => {
        const { [taskId]: _drop, ...rest } = m;
        return rest;
      });
    }
  }

  // cancel is not yet exposed on the orchestrator tRPC surface; hidden for now.
  void controlTask;

  async function confirm(
    taskId: string,
    _stepId: string,
    decision: 'approve' | 'skip' | 'reject',
  ): Promise<void> {
    if (!token) return;
    if (inFlight[taskId]) return; // guard against double-click → 412 storm
    setInFlight((m) => ({ ...m, [taskId]: `confirm:${decision}` }));
    try {
      const res = await fetch(`${ORCHESTRATOR_HTTP}/trpc/tasks.confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ taskId, decision }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      // Optimistic UI: clear the pending confirm locally; SW reconciles next.
      setTasks((prev) =>
        prev.map((t) =>
          t.taskId === taskId
            ? {
                ...t,
                pendingConfirm: null,
                status: decision === 'reject' ? 'cancelled' : 'executing',
                lastUpdated: Date.now(),
              }
            : t,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInFlight((m) => {
        const { [taskId]: _drop, ...rest } = m;
        return rest;
      });
    }
  }

  if (!user) {
    return (
      <div style={rootStyle}>
        <h3 style={h3}>HOLA DAY</h3>
        <div style={column(6)}>
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
          {error ? <div style={errStyle}>{error}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...rootStyle, minWidth: 360 }}>
      <div style={headerRow}>
        <div>
          <div style={{ fontWeight: 600 }}>{user.displayName ?? user.email}</div>
          <div style={{ opacity: 0.6, fontSize: 11 }}>
            {user.email} · plan: {user.plan}
          </div>
        </div>
        <button type="button" onClick={() => void logout()} style={miniBtn}>
          Sign out
        </button>
      </div>

      <div style={{ ...column(6), marginTop: 8 }}>
        <textarea
          rows={2}
          placeholder="Describe what you want done..."
          value={intent}
          onChange={(e) => setIntent(e.currentTarget.value)}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void createTask()}
            style={{ flex: 1 }}
          >
            {submitting ? 'Planning...' : 'Run'}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void runSmokeTest()}
            title="Hardcoded Baidu search plan — bypasses Opus, diagnostic only"
            style={miniBtn}
          >
            Smoke Test
          </button>
        </div>
        {error ? <div style={errStyle}>{error}</div> : null}
      </div>

      <div style={{ marginTop: 12, borderTop: '1px solid #eee', paddingTop: 8 }}>
        {tasks.length === 0 ? (
          <div style={{ opacity: 0.5, fontSize: 12 }}>No tasks yet.</div>
        ) : (
          tasks.map((t) => (
            <TaskCard
              key={t.taskId}
              task={t}
              busy={Boolean(inFlight[t.taskId])}
              onControl={controlTask}
              onConfirm={confirm}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TaskCard(props: {
  task: TaskView;
  busy: boolean;
  onControl: (taskId: string, route: 'pause' | 'resume' | 'cancel') => Promise<void>;
  onConfirm: (
    taskId: string,
    stepId: string,
    decision: 'approve' | 'skip' | 'reject',
  ) => Promise<void>;
}) {
  const { task, busy, onControl, onConfirm } = props;
  const canPause = task.status === 'executing' && !busy;
  const canResume = task.status === 'paused' && !busy;
  const awaiting = task.status === 'awaiting_user' && task.pendingConfirm;

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12, fontFamily: 'monospace' }}>{task.taskId}</div>
        <StatusBadge status={task.status} pauseReason={task.pauseReason} />
      </div>

      <ol style={{ margin: '6px 0 8px', paddingLeft: 18, fontSize: 12 }}>
        {task.steps.map((s) => (
          <li key={s.id}>
            <span style={stepStatusStyle(s.status)}>{s.status}</span> · {s.kind} ·{' '}
            <span style={{ fontFamily: 'monospace', opacity: 0.5 }}>{s.id.slice(0, 8)}…</span>
          </li>
        ))}
      </ol>

      {awaiting && task.pendingConfirm
        ? (() => {
            const pc = task.pendingConfirm;
            if (pc.kind === 'batch') {
              return (
                <div style={confirmBox}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      marginBottom: 4,
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>
                      确认第 {pc.batchIndex + 1}/{pc.batchTotal} 批
                    </span>
                    <span style={{ opacity: 0.6, fontWeight: 400 }}>risk: {pc.risk}</span>
                  </div>
                  {pc.summary ? (
                    <div style={{ fontSize: 12, marginBottom: 6 }}>{pc.summary}</div>
                  ) : null}
                  <ul style={{ margin: '0 0 8px', paddingLeft: 16, fontSize: 11, lineHeight: 1.4 }}>
                    {pc.items.map((it, i) => (
                      <li key={`${i}-${it.label.slice(0, 12)}`}>
                        <span style={{ fontWeight: 600 }}>{it.label}</span>
                        <div style={{ opacity: 0.75, marginTop: 2 }}>{it.preview}</div>
                      </li>
                    ))}
                  </ul>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      style={{ ...miniBtn, background: '#16a34a', color: 'white' }}
                      disabled={busy}
                      onClick={() => void onConfirm(task.taskId, pc.stepId, 'approve')}
                    >
                      {busy ? '处理中…' : `确认第 ${pc.batchIndex + 1}/${pc.batchTotal} 批`}
                    </button>
                    <button
                      type="button"
                      style={miniBtn}
                      disabled={busy}
                      onClick={() => void onConfirm(task.taskId, pc.stepId, 'skip')}
                    >
                      Skip
                    </button>
                    <button
                      type="button"
                      style={{ ...miniBtn, background: '#dc2626', color: 'white' }}
                      disabled={busy}
                      onClick={() => void onConfirm(task.taskId, pc.stepId, 'reject')}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div style={confirmBox}>
                <div style={{ fontSize: 12, marginBottom: 4 }}>
                  {pc.prompt} <em>(risk: {pc.risk})</em>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    style={{ ...miniBtn, background: '#16a34a', color: 'white' }}
                    disabled={busy}
                    onClick={() => void onConfirm(task.taskId, pc.stepId, 'approve')}
                  >
                    {busy ? '处理中…' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    style={{ ...miniBtn, background: '#dc2626', color: 'white' }}
                    disabled={busy}
                    onClick={() => void onConfirm(task.taskId, pc.stepId, 'reject')}
                  >
                    Reject
                  </button>
                </div>
              </div>
            );
          })()
        : null}

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          style={miniBtn}
          disabled={!canPause}
          onClick={() => void onControl(task.taskId, 'pause')}
        >
          Pause
        </button>
        <button
          type="button"
          style={miniBtn}
          disabled={!canResume}
          onClick={() => void onControl(task.taskId, 'resume')}
        >
          Resume
        </button>
      </div>
    </div>
  );
}

function StatusBadge(props: { status: TaskStatus; pauseReason?: PauseReason | null }) {
  const color = statusColor(props.status);
  const extra = props.status === 'paused' && props.pauseReason ? ` · ${props.pauseReason}` : '';
  return (
    <span
      style={{
        fontSize: 11,
        padding: '2px 6px',
        borderRadius: 3,
        background: color.bg,
        color: color.fg,
      }}
    >
      {props.status}
      {extra}
    </span>
  );
}

function statusColor(s: TaskStatus): { bg: string; fg: string } {
  switch (s) {
    case 'executing':
      return { bg: '#dbeafe', fg: '#1e40af' };
    case 'awaiting_user':
      return { bg: '#fef3c7', fg: '#92400e' };
    case 'paused':
      return { bg: '#fde68a', fg: '#78350f' };
    case 'completed':
      return { bg: '#dcfce7', fg: '#166534' };
    case 'failed':
      return { bg: '#fee2e2', fg: '#991b1b' };
    case 'cancelled':
      return { bg: '#e5e7eb', fg: '#374151' };
    default:
      return { bg: '#f3f4f6', fg: '#374151' };
  }
}

function stepStatusStyle(s: StepView['status']): React.CSSProperties {
  const palette: Record<StepView['status'], string> = {
    pending: '#6b7280',
    executing: '#1e40af',
    completed: '#166534',
    failed: '#991b1b',
    awaiting_user: '#92400e',
  };
  return { color: palette[s], fontWeight: 600 };
}

const rootStyle: React.CSSProperties = { minWidth: 320 };
const h3: React.CSSProperties = { margin: '0 0 8px' };
const column = (gap: number): React.CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  gap,
});
const headerRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
};
const errStyle: React.CSSProperties = { color: 'crimson', fontSize: 12 };
const miniBtn: React.CSSProperties = {
  fontSize: 11,
  padding: '3px 8px',
  border: '1px solid #d1d5db',
  borderRadius: 3,
  background: '#f9fafb',
  cursor: 'pointer',
};
const cardStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 4,
  padding: 8,
  marginBottom: 8,
};
const confirmBox: React.CSSProperties = {
  background: '#fffbeb',
  padding: 6,
  borderRadius: 3,
  marginBottom: 6,
};
