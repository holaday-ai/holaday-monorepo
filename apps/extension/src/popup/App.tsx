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

/**
 * F4: cap the number of task cards rendered in the popup's "recent"
 * section. Older runs (cancelled, failed from weeks ago) pile up
 * and bury the current task behind a long scroll; older rows stay
 * accessible via the HistorySection below. 10 mirrors what the
 * backend returns via tasks.list(limit:20) divided by the "most
 * users care about the last handful" heuristic.
 */
const POPUP_MAX_VISIBLE_TASKS = 10;

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
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'awaiting_user' | 'skipped';
  /** Driver result.data, forwarded by the SW. Shape varies by kind. */
  output?: unknown;
}

/** Narrow an `extract` step's output to the shape we can render. */
function extractOutput(step: StepView): { texts: string[]; matched?: string } | null {
  if (step.kind !== 'extract' || !step.output || typeof step.output !== 'object') return null;
  const o = step.output as { texts?: unknown; matched?: unknown };
  if (!Array.isArray(o.texts)) return null;
  const texts = o.texts.filter((t): t is string => typeof t === 'string');
  return {
    texts,
    ...(typeof o.matched === 'string' ? { matched: o.matched } : {}),
  };
}

/** Narrow a `screenshot` step's output so we can render the JPEG thumbnail. */
function screenshotOutput(step: StepView): { thumbnail: string } | null {
  if (step.kind !== 'screenshot' || !step.output || typeof step.output !== 'object') return null;
  const o = step.output as { thumbnail?: unknown };
  if (typeof o.thumbnail !== 'string' || o.thumbnail.length === 0) return null;
  return { thumbnail: o.thumbnail };
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

/**
 * Live progress for vision-loop tasks — SW emits an update each time
 * the loop transitions phase (observing → deciding → acting → …).
 * Classic (plan-once) tasks leave this field undefined.
 */
export type VisionPhase = 'observing' | 'deciding' | 'acting' | 'completed' | 'failed';

interface VisionProgressView {
  phase: VisionPhase;
  tickIndex?: number;
  actionKind?: string;
  /** phase=completed → task_done summary; phase=failed → give_up reason. */
  detail?: string;
}

interface TaskView {
  taskId: string;
  status: TaskStatus;
  steps: StepView[];
  pendingConfirm?: PendingConfirmView | null;
  pauseReason?: PauseReason | null;
  lastUpdated: number;
  visionProgress?: VisionProgressView;
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
   * Task id we just POSTed through `tasks.create`. Keeps the Run
   * button in "执行中..." state until the SW reports the vision loop
   * has started (first 'observing' / 'deciding' / 'acting' event for
   * this task) or a 20s safety timeout fires.
   *
   * Previous behaviour re-enabled the button as soon as the HTTP
   * response returned (~200ms), which made impatient users click Run
   * again and spawn duplicate tasks.
   */
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  /**
   * Per-task in-flight lock. Keyed by taskId, value is the action that
   * locked it ("confirm", "pause", "resume"). While set, the card's
   * Confirm/Skip/Cancel/Pause/Resume buttons are disabled — prevents the
   * second click from hitting a stale awaiting_user and getting 412.
   */
  const [inFlight, setInFlight] = useState<Record<string, string>>({});
  /**
   * Debug menu toggle — persisted in chrome.storage.local so devs
   * don't have to re-enable it every popup open. Off by default, so
   * normal users don't see the Smoke Test (and any future debug-only
   * buttons) in the main UI.
   */
  const [debugMode, setDebugMode] = useState(false);
  useEffect(() => {
    chrome.storage.local.get('holaday.debug_mode', (r) => {
      setDebugMode(r['holaday.debug_mode'] === true);
    });
  }, []);
  async function toggleDebugMode(): Promise<void> {
    const next = !debugMode;
    setDebugMode(next);
    await chrome.storage.local.set({ 'holaday.debug_mode': next });
  }

  // On mount: restore session, hydrate tasks from SW, AND reconcile
  // with the orchestrator's tasks.list so terminal states that
  // happened while the popup was closed show up correctly (the SW
  // may have missed the `server.task.terminal` frame if it was
  // recycled, or the task may have ended before the SW saw any
  // vision frames at all).
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
      // DB reconcile — authoritative for terminal statuses. We
      // overlay the DB's status/result onto the SW's in-memory view
      // when it disagrees (DB wins: it's written by the orchestrator
      // after persistVisionOutcome, SW view may be stale).
      if (tok) {
        try {
          const res = await fetch(
            `${ORCHESTRATOR_HTTP}/trpc/tasks.list?input=${encodeURIComponent(
              JSON.stringify({ limit: 20 }),
            )}`,
            { headers: { authorization: `Bearer ${tok}` } },
          );
          if (res.ok) {
            const body = (await res.json()) as {
              result: { data: { tasks: HistoryListItem[] } };
            };
            const dbByTaskId = new Map(body.result.data.tasks.map((t) => [t.taskId, t]));
            setTasks((prev) =>
              prev.map((t) => {
                const db = dbByTaskId.get(t.taskId);
                if (!db) return t;
                const dbStatus = db.status as TaskStatus;
                const isTerminalInDb =
                  dbStatus === 'completed' ||
                  dbStatus === 'failed' ||
                  dbStatus === 'cancelled' ||
                  dbStatus === 'paused';
                // Only overwrite when the DB is terminal and the SW
                // still thinks the task is running — don't stomp an
                // executing task with stale list data.
                if (!isTerminalInDb) return t;
                if (t.status === dbStatus) return t;
                const summary = db.result?.summary?.trim() || null;
                const reason = db.result?.reason?.trim() || (db.errorMessage ?? '').trim() || null;
                const phase: VisionPhase =
                  dbStatus === 'completed'
                    ? 'completed'
                    : dbStatus === 'failed' || dbStatus === 'cancelled'
                      ? 'failed'
                      : 'failed';
                const detail = summary ?? reason ?? undefined;
                return {
                  ...t,
                  status: dbStatus,
                  visionProgress: {
                    phase,
                    ...(detail ? { detail } : {}),
                  },
                };
              }),
            );
          }
        } catch {
          // Non-fatal — SW view stands.
        }
      }
    })();
  }, []);

  // Subscribe to SW task snapshots + vision-loop progress events
  // while the popup is open. `holaday.tasks.update` is the full task
  // list (classic + vision); `holaday.vision.progress` fires on each
  // loop phase transition so we can un-stick the Run button and
  // render a live phase line without waiting for the next full snapshot.
  useEffect(() => {
    const listener = (msg: {
      type?: string;
      tasks?: TaskView[];
      taskId?: string;
      phase?: VisionPhase;
    }) => {
      if (msg?.type === 'holaday.tasks.update' && msg.tasks) setTasks(msg.tasks);
      if (msg?.type === 'holaday.vision.progress' && msg.taskId) {
        setPendingTaskId((cur) => (cur === msg.taskId ? null : cur));
      }
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

  /**
   * Phase 18b — hard reset of the auth state. Triggers the SW's
   * resetConnection handler which wipes token + user + failure
   * counter + known-bad-token + the live socket, then immediately
   * tries auto-login from any open holaday.ai tab. The popup's
   * own React state (user, token, tasks) is also reset so the
   * UI returns to the "Sign in" view; if auto-login picked up a
   * fresh token from a workbench tab the storage-change listener
   * (line 246-262) will rehydrate user + token within a tick.
   */
  async function resetConnection(): Promise<void> {
    setStatus('loading');
    setError(null);
    try {
      await new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ type: 'holaday.resetConnection' }, () => resolve());
      });
      setUser(null);
      setToken(null);
      setTasks([]);
      setStatus('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  /**
   * Phase 14 — open the Side Panel for the current window. chrome.sidePanel.open
   * must run inside a user-gesture context, which a button click satisfies.
   * Closing the popup right after lets Chrome focus the panel cleanly without
   * the popup eating the next click.
   */
  async function openSidePanel(): Promise<void> {
    try {
      const win = await chrome.windows.getCurrent();
      if (typeof win.id === 'number') {
        await chrome.sidePanel.open({ windowId: win.id });
      }
      window.close();
    } catch (err) {
      console.warn('[holaday] open side panel failed', err);
    }
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
        // Intent-only: the orchestrator's catalogue returns all active
        // Skills; Opus picks from them. Phase 1 may re-introduce a
        // user-selectable occupation as a soft preference.
        body: JSON.stringify({ intent: intent.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as CreateTaskResponse;
      const newTaskId = body.result.data.taskId;
      setPendingTaskId(newTaskId);
      // Safety: if the SW never reports progress (e.g. WS disconnected
      // or orchestrator hung), unblock the Run button after 20s.
      window.setTimeout(() => {
        setPendingTaskId((cur) => (cur === newTaskId ? null : cur));
      }, 20_000);
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
          {/* Phase 18b — escape hatch for users stuck in the
              auth-failure freeze. Most users will never see this
              button (the SW only freezes after 3 consecutive
              4401s), but when they do, the existing flow has no
              way out without reinstalling. */}
          <button
            type="button"
            onClick={() => void resetConnection()}
            style={resetBtnStyle}
            title="清除扩展存储的登录态 + 失败计数，重新尝试连接"
          >
            重置连接
          </button>
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
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={() => void openSidePanel()}
            style={miniBtn}
            title="在侧边栏中以页面上下文提交任务"
          >
            侧边栏
          </button>
          <button
            type="button"
            onClick={() => void toggleDebugMode()}
            style={debugToggleBtn(debugMode)}
            title={debugMode ? '关闭调试菜单' : '打开调试菜单'}
            aria-pressed={debugMode}
          >
            ⚙
          </button>
          <button type="button" onClick={() => void logout()} style={miniBtn}>
            Sign out
          </button>
        </div>
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
            disabled={submitting || pendingTaskId !== null || hasRunningTask(tasks)}
            onClick={() => void createTask()}
            style={{ flex: 1 }}
          >
            {runButtonLabel(submitting, pendingTaskId, tasks)}
          </button>
          {debugMode ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void runSmokeTest()}
              title="Hardcoded Baidu search plan — bypasses Opus, diagnostic only"
              style={miniBtn}
            >
              Smoke Test
            </button>
          ) : null}
        </div>
        {error ? <div style={errStyle}>{error}</div> : null}
        {/* Phase 18b — same escape hatch in the authed view, in
            case the user has a stale token cached locally that
            keeps tripping the orchestrator's auth check. */}
        <button
          type="button"
          onClick={() => void resetConnection()}
          style={resetBtnStyle}
          title="清除扩展存储的登录态 + 失败计数，重新尝试连接"
        >
          重置连接
        </button>
      </div>

      <div style={{ marginTop: 12, borderTop: '1px solid #eee', paddingTop: 8 }}>
        {tasks.length === 0 ? (
          <div style={{ opacity: 0.5, fontSize: 12 }}>No tasks yet.</div>
        ) : (
          <>
            {tasks.slice(0, POPUP_MAX_VISIBLE_TASKS).map((t) => (
              <TaskCard
                key={t.taskId}
                task={t}
                busy={Boolean(inFlight[t.taskId])}
                onControl={controlTask}
                onConfirm={confirm}
              />
            ))}
            {tasks.length > POPUP_MAX_VISIBLE_TASKS ? (
              <div
                style={{
                  fontSize: 11,
                  opacity: 0.6,
                  padding: '6px 2px',
                  textAlign: 'center',
                }}
              >
                只显示最近 {POPUP_MAX_VISIBLE_TASKS} 条（共 {tasks.length}{' '}
                条）。更早的任务请查看下方历史。
              </div>
            ) : null}
          </>
        )}
      </div>

      <HistorySection token={token} liveTaskIds={tasks.map((t) => t.taskId)} />
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

      {task.visionProgress ? <VisionProgressLine progress={task.visionProgress} /> : null}

      <StepList steps={task.steps} />

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

      <ResultsSection task={task} />
    </div>
  );
}

/**
 * Collapsible result view beneath a TaskCard. Scans the step list for
 * anything with a renderable `output`:
 *   - extract step → { texts: string[] } → scrollable ordered list
 *   - screenshot step → { thumbnail: base64 jpeg } → <img>
 * Hidden entirely when there's nothing to show; auto-opens on the
 * task's first completed transition and stays toggleable afterwards.
 */
/**
 * History-friendly loosening: only depends on status + steps, so the
 * historical detail endpoint (which doesn't carry pendingConfirm /
 * pauseReason / lastUpdated) can reuse this component.
 */
interface ResultsSectionTask {
  status: TaskStatus;
  steps: StepView[];
}

function ResultsSection({ task }: { task: ResultsSectionTask }) {
  const extracts = task.steps
    .map((s) => ({ step: s, data: extractOutput(s) }))
    .filter(
      (x): x is { step: StepView; data: { texts: string[]; matched?: string } } => x.data !== null,
    );
  const screenshots = task.steps
    .map((s) => ({ step: s, data: screenshotOutput(s) }))
    .filter((x): x is { step: StepView; data: { thumbnail: string } } => x.data !== null);

  const hasAny = extracts.length > 0 || screenshots.length > 0;
  const [expanded, setExpanded] = useState(task.status === 'completed');
  // Auto-open the first time a task transitions to completed.
  useEffect(() => {
    if (task.status === 'completed') setExpanded(true);
  }, [task.status]);

  if (!hasAny) return null;

  const summaryBits: string[] = [];
  if (extracts.length > 0) {
    const totalItems = extracts.reduce((n, x) => n + x.data.texts.length, 0);
    summaryBits.push(`${extracts.length} extract · ${totalItems} items`);
  }
  if (screenshots.length > 0) summaryBits.push(`${screenshots.length} screenshot`);

  return (
    <div style={resultsWrap}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={resultsToggle}
        aria-expanded={expanded}
      >
        <span>{expanded ? '▼' : '▶'}</span>
        <span>Results</span>
        <span style={{ opacity: 0.55, fontWeight: 400 }}>— {summaryBits.join(' · ')}</span>
      </button>

      {expanded ? (
        <div style={{ marginTop: 6 }}>
          {extracts.map(({ step, data }) => (
            <div key={step.id} style={{ marginBottom: 8 }}>
              <div style={resultsLabel}>
                extract · {data.matched ?? 'result'} ({data.texts.length})
              </div>
              <div style={textsScroll}>
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {data.texts.map((t, i) => (
                    <li key={`${step.id}-${i}`} style={textItem}>
                      {t}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ))}
          {screenshots.map(({ step, data }) => (
            <div key={step.id} style={{ marginBottom: 8 }}>
              <div style={resultsLabel}>screenshot</div>
              <img
                src={`data:image/jpeg;base64,${data.thumbnail}`}
                alt="task screenshot"
                style={thumbStyle}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------- History ----------

interface HistoryListItem {
  taskId: string;
  intent: string;
  status: TaskStatus;
  /** Vision-loop terminal payload ({summary, tickCount} or {reason, tickCount}). */
  result?: { summary?: string; reason?: string; tickCount?: number } | null;
  /** Legacy plan-once final error message (kept for old tasks). */
  errorMessage?: string | null;
  createdAt: string; // ISO
}

interface HistoryDetail {
  taskId: string;
  intent: string;
  status: TaskStatus;
  result?: { summary?: string; reason?: string; tickCount?: number } | null;
  errorMessage?: string | null;
  steps: StepView[];
}

/**
 * Lazy-loaded "history" block under the live tasks list. Shows past
 * tasks newest-first; click a row to expand and see the same
 * ResultsSection the live tasks use. Live tasks already on screen
 * (by taskId) are filtered out so the user doesn't see them twice.
 *
 * No page-up / search — Phase 0. One `tasks.list` round-trip with a
 * 20-row default. Cursor pagination is on the tRPC side if we ever
 * want a "load more" button.
 */
function HistorySection({
  token,
  liveTaskIds,
}: {
  token: string | null;
  liveTaskIds: string[];
}) {
  const [items, setItems] = useState<HistoryListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, HistoryDetail>>({});
  const [expanding, setExpanding] = useState<Record<string, boolean>>({});

  // Mount fetch. Token change (login/logout) re-fetches.
  useEffect(() => {
    if (!token) {
      setItems(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(
          `${ORCHESTRATOR_HTTP}/trpc/tasks.list?input=${encodeURIComponent(
            JSON.stringify({ limit: 20 }),
          )}`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { result: { data: { tasks: HistoryListItem[] } } };
        if (!cancelled) setItems(body.result.data.tasks);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function toggle(taskId: string): Promise<void> {
    if (!token) return;
    if (expanded[taskId]) {
      const { [taskId]: _drop, ...rest } = expanded;
      setExpanded(rest);
      return;
    }
    if (expanding[taskId]) return;
    setExpanding((m) => ({ ...m, [taskId]: true }));
    try {
      const res = await fetch(
        `${ORCHESTRATOR_HTTP}/trpc/tasks.detail?input=${encodeURIComponent(
          JSON.stringify({ taskId }),
        )}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { result: { data: HistoryDetail } };
      setExpanded((m) => ({ ...m, [taskId]: body.result.data }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExpanding((m) => {
        const { [taskId]: _drop, ...rest } = m;
        return rest;
      });
    }
  }

  if (!token) return null;

  const liveSet = new Set(liveTaskIds);
  const historyItems = (items ?? []).filter((i) => !liveSet.has(i.taskId));

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid #eee', paddingTop: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>历史任务</div>
      {loading ? <div style={{ opacity: 0.5, fontSize: 12 }}>加载中...</div> : null}
      {err ? <div style={errStyle}>{err}</div> : null}
      {!loading && items !== null && historyItems.length === 0 ? (
        <div style={{ opacity: 0.5, fontSize: 12 }}>还没有任务</div>
      ) : null}
      {historyItems.map((item) => {
        const detail = expanded[item.taskId];
        const busy = Boolean(expanding[item.taskId]);
        return (
          <div key={item.taskId} style={cardStyle}>
            <button
              type="button"
              style={historyRowStyle}
              onClick={() => void toggle(item.taskId)}
              aria-expanded={Boolean(detail)}
            >
              <span style={{ flex: 1, textAlign: 'left' }}>
                {detail ? '▼' : '▶'} {truncate(item.intent, 60)}
              </span>
              <StatusBadge status={item.status} />
            </button>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>
              {formatCreatedAt(item.createdAt)}
              {busy ? ' · 加载详情...' : ''}
            </div>
            <HistoryResultLine item={item} />
            {detail ? (
              <div style={{ marginTop: 6 }}>
                <StepList steps={detail.steps} />
                <ResultsSection task={{ status: detail.status, steps: detail.steps }} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Render the task's final summary / failure reason as a compact pill
 * under the history row header. For vision-loop tasks this pulls from
 * `result.{summary,reason}`. For legacy plan-once failures we fall
 * back to `errorMessage` so old rows still show something useful.
 * No pill when the task is still running or has no terminal payload.
 */
function HistoryResultLine({ item }: { item: HistoryListItem }) {
  const isCompleted = item.status === 'completed';
  const isFailed = item.status === 'failed' || item.status === 'cancelled';
  const isPaused = item.status === 'paused';
  const summary = item.result?.summary?.trim() || null;
  const reason = item.result?.reason?.trim() || (item.errorMessage ?? '').trim() || null;
  let text: string | null = null;
  let tone: 'ok' | 'err' | 'warn' | null = null;
  if (isCompleted && summary) {
    text = summary;
    tone = 'ok';
  } else if (isFailed && reason) {
    text = reason;
    tone = 'err';
  } else if (isPaused && reason) {
    text = reason;
    tone = 'warn';
  }
  if (!text || !tone) return null;
  const color = tone === 'ok' ? '#065f46' : tone === 'err' ? '#991b1b' : '#92400e';
  const bg = tone === 'ok' ? '#d1fae5' : tone === 'err' ? '#fee2e2' : '#fef3c7';
  return (
    <div
      style={{
        marginTop: 4,
        padding: '4px 6px',
        borderRadius: 3,
        background: bg,
        color,
        fontSize: 11,
        lineHeight: 1.4,
        whiteSpace: 'pre-wrap',
      }}
    >
      {text}
    </div>
  );
}

/**
 * True when any visible task is in a state that should block Run —
 * `executing`, `planning`, or `awaiting_user`. `paused` is deliberately
 * NOT blocked: a paused task is waiting for the user's attention on
 * the card, and they may reasonably want to kick off a parallel task.
 * Exported via local closure only — used by the Run button's disabled
 * + label logic.
 */
function hasRunningTask(tasks: TaskView[]): boolean {
  return tasks.some(
    (t) => t.status === 'executing' || t.status === 'planning' || t.status === 'awaiting_user',
  );
}

function runButtonLabel(
  submitting: boolean,
  pendingTaskId: string | null,
  tasks: TaskView[],
): string {
  if (submitting || pendingTaskId !== null) return '执行中...';
  if (hasRunningTask(tasks)) return '有任务正在执行';
  return 'Run';
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

const historyRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
};

/**
 * Step renderer with long-plan collapse. Plans with more than
 * STEP_COLLAPSE_AT steps show only the first STEP_COLLAPSE_KEEP
 * with a "展开全部 (N)" button; click expands to the full list.
 * Keeps the popup scroll tractable when Opus emits a 30-step plan.
 *
 * Collapse state is per-render-instance; re-expanding on a popup
 * re-mount is fine — users don't need sticky preference for this.
 */
const STEP_COLLAPSE_AT = 10;
const STEP_COLLAPSE_KEEP = 10;

/**
 * Vision-loop live progress line — one row describing what phase the
 * loop is in right now. Replaces the blank space / "No tasks yet" for
 * active vision tasks and surfaces the task_done summary / give_up
 * reason on terminal phases.
 */
function VisionProgressLine({ progress }: { progress: VisionProgressView }) {
  const label = visionPhaseLabel(progress);
  const terminal = progress.phase === 'completed' || progress.phase === 'failed';
  const color =
    progress.phase === 'completed'
      ? '#065f46'
      : progress.phase === 'failed'
        ? '#991b1b'
        : '#1f2937';
  const bg =
    progress.phase === 'completed'
      ? '#d1fae5'
      : progress.phase === 'failed'
        ? '#fee2e2'
        : '#f3f4f6';
  return (
    <div
      style={{
        marginTop: 4,
        padding: '6px 8px',
        borderRadius: 4,
        background: bg,
        color,
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <div style={{ fontWeight: 600 }}>
        {label}
        {!terminal && typeof progress.tickIndex === 'number'
          ? ` · 第 ${progress.tickIndex + 1} 轮`
          : null}
      </div>
      {terminal && progress.detail ? (
        <div style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>{progress.detail}</div>
      ) : null}
    </div>
  );
}

function visionPhaseLabel(p: VisionProgressView): string {
  switch (p.phase) {
    case 'observing':
      return '正在截图观察页面...';
    case 'deciding':
      return 'AI 分析中，决定下一步...';
    case 'acting':
      return `执行操作${p.actionKind ? `（${actionKindLabel(p.actionKind)}）` : ''}...`;
    case 'completed':
      return '任务完成';
    case 'failed':
      return '任务失败';
  }
}

function actionKindLabel(kind: string): string {
  switch (kind) {
    case 'click':
      return '点击';
    case 'type':
      return '输入';
    case 'key':
      return '按键';
    case 'scroll':
      return '滚动';
    case 'wait':
      return '等待';
    case 'screenshot':
      return '截图';
    default:
      return kind;
  }
}

function StepList({ steps }: { steps: StepView[] }) {
  const [expanded, setExpanded] = useState(false);
  const collapsed = !expanded && steps.length > STEP_COLLAPSE_AT;
  const visible = collapsed ? steps.slice(0, STEP_COLLAPSE_KEEP) : steps;
  const hiddenCount = steps.length - visible.length;
  return (
    <>
      <ol style={{ margin: '6px 0 8px', paddingLeft: 18, fontSize: 12 }}>
        {visible.map((s) => (
          <li key={s.id}>
            <span style={stepStatusStyle(s.status)}>
              {stepIcon(s.status)} {stepStatusText(s.status)}
            </span>{' '}
            · {s.kind} ·{' '}
            <span style={{ fontFamily: 'monospace', opacity: 0.5 }}>{s.id.slice(0, 8)}…</span>
          </li>
        ))}
      </ol>
      {collapsed && hiddenCount > 0 ? (
        <button type="button" style={expandAllBtn} onClick={() => setExpanded(true)}>
          展开全部 ({steps.length} 步，还有 {hiddenCount} 步未显示)
        </button>
      ) : null}
    </>
  );
}

const expandAllBtn: React.CSSProperties = {
  fontSize: 11,
  padding: '3px 8px',
  border: '1px dashed #9ca3af',
  borderRadius: 3,
  background: 'transparent',
  cursor: 'pointer',
  marginBottom: 6,
  color: '#4b5563',
};

// ---------- labels: color-blind friendly + friendly Chinese ----------

/**
 * Every badge carries ICON + CN LABEL + COLOR — colour alone was
 * color-blind-hostile. The icons (glyphs that render everywhere
 * without a font file) give a distinct shape at a glance; the CN
 * label removes "what does 'awaiting_user' even mean" friction;
 * colour is gravy.
 */
function taskStatusLabel(s: TaskStatus): { icon: string; text: string } {
  switch (s) {
    case 'planning':
      return { icon: '✎', text: '规划中' };
    case 'executing':
      return { icon: '▸', text: '执行中' };
    case 'awaiting_user':
      return { icon: '?', text: '待确认' };
    case 'paused':
      return { icon: '⏸', text: '已暂停' };
    case 'completed':
      return { icon: '✓', text: '已完成' };
    case 'failed':
      return { icon: '✗', text: '失败' };
    case 'cancelled':
      return { icon: '⊘', text: '已取消' };
    default:
      return { icon: '·', text: String(s) };
  }
}

function pauseReasonLabel(r: PauseReason): string {
  switch (r) {
    case 'user':
      return '已手动暂停';
    case 'retries_exhausted':
      return '多次重试未成功，已暂停';
    case 'quota_exceeded':
      return '配额用完，已暂停';
    default:
      return String(r);
  }
}

function StatusBadge(props: { status: TaskStatus; pauseReason?: PauseReason | null }) {
  const color = statusColor(props.status);
  const { icon, text } = taskStatusLabel(props.status);
  // Paused shows the detailed reason in the badge; other statuses
  // keep the short label to save space.
  const label =
    props.status === 'paused' && props.pauseReason ? pauseReasonLabel(props.pauseReason) : text;
  return (
    <span
      style={{
        fontSize: 11,
        padding: '2px 6px',
        borderRadius: 3,
        background: color.bg,
        color: color.fg,
        display: 'inline-flex',
        gap: 4,
        alignItems: 'center',
      }}
      title={props.status}
      aria-label={label}
    >
      <span aria-hidden="true" style={{ fontWeight: 700 }}>
        {icon}
      </span>
      <span>{label}</span>
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

function stepIcon(s: StepView['status']): string {
  switch (s) {
    case 'pending':
      return '·';
    case 'executing':
      return '▸';
    case 'completed':
      return '✓';
    case 'failed':
      return '✗';
    case 'awaiting_user':
      return '?';
    case 'skipped':
      return '⊝';
  }
}

function stepStatusText(s: StepView['status']): string {
  switch (s) {
    case 'pending':
      return '待执行';
    case 'executing':
      return '执行中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'awaiting_user':
      return '待确认';
    case 'skipped':
      return '已跳过';
  }
}

function stepStatusStyle(s: StepView['status']): React.CSSProperties {
  const palette: Record<StepView['status'], string> = {
    pending: '#6b7280',
    executing: '#1e40af',
    completed: '#166534',
    failed: '#991b1b',
    awaiting_user: '#92400e',
    // skipped = muted blue-grey — step didn't fail but didn't really
    // execute either (screenshot flake, etc). Distinct from gray
    // `pending` so the operator can tell at a glance.
    skipped: '#64748b',
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
const resetBtnStyle: React.CSSProperties = {
  marginTop: 4,
  padding: '4px 10px',
  fontSize: 11,
  background: 'transparent',
  color: '#6b7280',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  cursor: 'pointer',
};
function debugToggleBtn(on: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    padding: '3px 6px',
    border: '1px solid #d1d5db',
    borderRadius: 3,
    background: on ? '#fef3c7' : '#f9fafb',
    color: on ? '#92400e' : '#6b7280',
    cursor: 'pointer',
  };
}

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
const resultsWrap: React.CSSProperties = {
  marginTop: 8,
  paddingTop: 6,
  borderTop: '1px dashed #e5e7eb',
};
const resultsToggle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  fontSize: 12,
  fontWeight: 600,
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  color: '#111827',
};
const resultsLabel: React.CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  marginBottom: 3,
};
const textsScroll: React.CSSProperties = {
  maxHeight: 180,
  overflowY: 'auto',
  border: '1px solid #e5e7eb',
  borderRadius: 3,
  padding: '4px 0',
  background: '#fafafa',
  fontSize: 12,
  lineHeight: 1.5,
};
const textItem: React.CSSProperties = {
  wordBreak: 'break-word',
  paddingRight: 6,
};
const thumbStyle: React.CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  border: '1px solid #e5e7eb',
  borderRadius: 3,
};
