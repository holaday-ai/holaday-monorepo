/**
 * Phase 14 — HOLA DAY Side Panel.
 *
 * The Side Panel is the "submit a task from any page" surface. It
 * lives next to whatever website the user is on and previews metadata.
 * The enabled task-tab launcher binds a background page by default;
 * explicit current-page requests bind the captured original instead.
 * The legacy context-tail path remains available behind the rollout gate.
 * Real-time progress comes from
 * the SW (which is already on the WS for vision-loop / step events)
 * via chrome.runtime.sendMessage, mirroring the popup pattern.
 *
 * What the Side Panel intentionally does NOT do (popup keeps owning
 * those flows): batch confirm UX, history list, multi-task
 * orchestration. The Side Panel is laser-focused on "1 page +
 * 1 task in flight"; users who want the rich view click the
 * "在 popup 中查看任务" button at the bottom.
 */

import {
  BrowserTaskLaunches,
  type BrowserTaskModeChoice,
  resolveBrowserTaskMode,
} from '@holaday/shared-types';
import { useEffect, useRef, useState } from 'react';
import { ORCHESTRATOR_HTTP } from '../shared/config.js';
import { humanizeExtensionError } from '../shared/error-copy.js';
import { fetchWithDeadline, responseJsonWithDeadline } from '../shared/http.js';
import { type PageContext, getActivePageContext } from '../shared/page-context.js';
import { sendRuntimeMessageWithRetry } from '../shared/runtime-message.js';
import {
  type StoredUser,
  clearAccessToken,
  clearStoredUser,
  getAccessToken,
  getStoredUser,
  normalizeAccessToken,
  normalizeStoredUser,
  setStoredUser,
} from '../shared/storage.js';
import {
  type CreateTaskResponse,
  didTokenSwitchDuringTaskCreate,
  extractCreatedTaskId,
  shouldClearAuthAfterCreateUnauthorized,
  shouldClearAuthAfterUnauthorized,
} from './create-task-response.js';
import { sidePanelLaunchDependencies, sidePanelLaunchJournal } from './durable-launch.js';
import { MAX_SIDE_PANEL_INTENT_CHARS, normalizeSidePanelIntent } from './task-intent.js';
import {
  type ChromeDiscovery,
  type ChromeLaunchTarget,
  prepareSidePanelLaunch,
} from './task-launch.js';
import {
  type TaskStatus,
  type TaskView,
  type VisionProgressView,
  normalizeTaskSnapshot,
} from './task-snapshot.js';

type Status = 'idle' | 'loading' | 'connected' | 'error';

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

type FetchMeResult =
  | { kind: 'ok'; user: StoredUser }
  | { kind: 'unauthorized' }
  | { kind: 'network' };

async function cacheStoredUserBestEffort(user: StoredUser): Promise<void> {
  await setStoredUser(user).catch(() => undefined);
}

const PAGE_CONTEXT_REFRESH_MS = 2_000;
const AUTH_ME_TIMEOUT_MS = 8_000;
const AUTH_ME_BODY_TIMEOUT_MS = 2_000;
const CREATE_TASK_TIMEOUT_MS = 10_000;
const CREATE_TASK_BODY_TIMEOUT_MS = 2_000;

async function browserRequest<T>(
  authToken: string,
  procedure: string,
  input?: unknown,
  query = false,
): Promise<T> {
  const res = await fetchWithDeadline(
    `${ORCHESTRATOR_HTTP}/trpc/tasks.${procedure}${query && input !== undefined ? `?input=${encodeURIComponent(JSON.stringify(input))}` : ''}`,
    {
      method: input === undefined || query ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${authToken}` },
      ...(input === undefined || query ? {} : { body: JSON.stringify(input) }),
    },
    20_000,
    'sidepanel_browser_prepare_timeout',
  );
  const body = await responseJsonWithDeadline<{
    result?: { data: T };
    error?: { message?: string };
  }>(res, 2_000, 'sidepanel_browser_prepare_body_timeout');
  if (!res.ok || !body.result)
    throw new Error(body.error?.message ?? `Chrome 连接暂时不可用（HTTP ${res.status}）`);
  return body.result.data;
}

export function App() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const authSyncSeq = useRef(0);
  const launches = useRef(new BrowserTaskLaunches<ChromeLaunchTarget>());
  const [backgroundTabs, setBackgroundTabs] = useState(false);
  const [launchRecovery, setLaunchRecovery] = useState(false);
  const [pendingLaunchId, setPendingLaunchId] = useState<string | null>(null);
  const [launchNotice, setLaunchNotice] = useState<string | null>(null);
  const [recoveryRetry, setRecoveryRetry] = useState(0);
  const recoveryInFlight = useRef(false);
  const recoveryAttempts = useRef(0);
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [taskMode, setTaskMode] = useState<BrowserTaskModeChoice>('auto');

  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [intent, setIntent] = useState('');
  const pendingLaunchDraft = useRef<{ intent: string; snapshot: string } | null>(null);
  const latestLaunchDraft = useRef('');
  latestLaunchDraft.current = JSON.stringify([intent, taskMode]);
  const [submitting, setSubmitting] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const tasksRefreshInFlight = useRef(false);
  const tasksRefreshQueued = useRef(false);
  const authRetryInFlight = useRef(false);
  const taskSubmitInFlight = useRef(false);
  const mountedRef = useRef(true);

  function clearLocalSessionState(): void {
    launches.current.clear();
    setBackgroundTabs(false);
    recoveryAttempts.current = 0;
    setLaunchRecovery(false);
    setPendingLaunchId(null);
    setLaunchNotice(null);
    setTaskMode('auto');
    setUser(null);
    setToken(null);
    setActiveTaskId(null);
    setTasks([]);
    setError(null);
    setSubmitting(false);
    setStatus('idle');
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function refreshTasksSnapshot(): Promise<void> {
    if (tasksRefreshInFlight.current) {
      tasksRefreshQueued.current = true;
      return;
    }
    tasksRefreshInFlight.current = true;
    try {
      do {
        tasksRefreshQueued.current = false;
        const resp = await sendRuntimeMessageWithRetry<{ tasks?: unknown }>({
          type: 'holaday.tasks',
        });
        if (mountedRef.current && resp && 'tasks' in resp) {
          setTasks(normalizeTaskSnapshot(resp.tasks));
        }
      } while (mountedRef.current && tasksRefreshQueued.current);
    } finally {
      tasksRefreshInFlight.current = false;
      tasksRefreshQueued.current = false;
    }
  }

  // Mount: restore session, hydrate task snapshot from SW, refresh
  // page context. When no stored token, nudge the SW to try the
  // localStorage-based auto-login from any open workbench tab — if
  // it succeeds, hydrate the user via auth.me so the header shows
  // the real account instead of the login form.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await getStoredUser();
      let tok = await getAccessToken();
      if (cancelled) return;
      if (stored && tok) {
        setUser(stored);
        setToken(tok);
        setStatus('connected');
        void sendRuntimeMessageWithRetry({ type: 'holaday.connect', token: tok });
      } else if (!tok) {
        const resp = await sendRuntimeMessageWithRetry<{ ok?: boolean; token?: string | null }>({
          type: 'holaday.tryAutoLogin',
        });
        const seq = authSyncSeq.current;
        const liftedToken = normalizeAccessToken(resp?.token);
        if (liftedToken) {
          tok = liftedToken;
          const result = await fetchMe(liftedToken);
          if (cancelled || seq !== authSyncSeq.current) return;
          if (result.kind === 'ok') {
            await cacheStoredUserBestEffort(result.user);
            if (cancelled || seq !== authSyncSeq.current) return;
            setUser(result.user);
            setToken(liftedToken);
            setError(null);
            setStatus('connected');
          } else if (result.kind === 'unauthorized') {
            // Token was rejected (expired, signed with a different
            // secret, or pointing at a deleted user). Drop it so the
            // panel falls back to the manual login form.
            const current = normalizeAccessToken(await getAccessToken());
            if (current === liftedToken) {
              await Promise.allSettled([clearAccessToken(), clearStoredUser()]);
              if (cancelled || seq !== authSyncSeq.current) return;
              clearLocalSessionState();
            }
          } else if (result.kind === 'network') {
            if (cancelled || seq !== authSyncSeq.current) return;
            setStatus('error');
            setError('暂时无法读取账户信息，浏览器代理会继续保持连接并重试。');
          }
        }
      }
      if (cancelled) return;
      await refreshTasksSnapshot();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cross-context sync: if the popup logs in / out in another window,
  // or the SW lifts a token via the keepalive alarm, the storage
  // change fires here and the panel reflects the new session
  // without a refresh.
  useEffect(() => {
    let cancelled = false;
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ) => {
      if (area !== 'local') return;
      const tokenChange = changes['holaday.access_token'];
      if (!tokenChange) return;
      launches.current.clear();
      void (async () => {
        const seq = ++authSyncSeq.current;
        const newToken = normalizeAccessToken(tokenChange.newValue);
        if (newToken) {
          const result = await fetchMe(newToken);
          if (cancelled || seq !== authSyncSeq.current) return;
          if (result.kind === 'ok') {
            await cacheStoredUserBestEffort(result.user);
            if (cancelled || seq !== authSyncSeq.current) return;
            setUser(result.user);
            setToken(newToken);
            setError(null);
            setStatus('connected');
          } else if (result.kind === 'unauthorized') {
            const current = normalizeAccessToken(await getAccessToken());
            if (shouldClearAuthAfterUnauthorized(current, newToken)) {
              await Promise.allSettled([clearAccessToken(), clearStoredUser()]);
            } else if (current) {
              return;
            }
            if (cancelled || seq !== authSyncSeq.current) return;
            clearLocalSessionState();
          }
          // 'network' → keep the current side panel session. The SW is
          // still the connection authority and will retry the websocket.
        } else {
          authSyncSeq.current = seq;
          clearLocalSessionState();
        }
      })();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let queued = false;
    async function refresh() {
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      try {
        do {
          queued = false;
          const ctx = await getActivePageContext({ metadataOnly: true });
          if (!cancelled) setPageContext(ctx);
        } while (!cancelled && queued);
      } finally {
        inFlight = false;
        queued = false;
      }
    }
    void refresh();
    const tabsListener = () => {
      void refresh();
    };
    const updatedListener = (_tabId: number, info: chrome.tabs.TabChangeInfo) => {
      // Re-read on URL changes and completed loads. Many SPA
      // transitions update title/content without a new tab URL.
      if (info.url || info.status === 'complete') void refresh();
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

  useEffect(() => {
    let cancelled = false;
    setBackgroundTabs(false);
    setLaunchRecovery(false);
    recoveryAttempts.current = 0;
    if (token)
      void browserRequest<{ backgroundTaskTabs: boolean; launchRecovery?: boolean }>(
        token,
        'localChromeLaunchOptions',
      )
        .then((result) => {
          if (!cancelled) {
            setBackgroundTabs(result.backgroundTaskTabs === true);
            setLaunchRecovery(result.launchRecovery === true);
          }
        })
        .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !launchRecovery || taskSubmitInFlight.current) return;
    let cancelled = false;
    const seq = authSyncSeq.current;
    recoveryInFlight.current = true;
    setSubmitting(true);
    void (async () => {
      try {
        const verified = await fetchMe(token);
        await assertLaunchSession(token, seq);
        if (cancelled) return;
        if (verified.kind !== 'ok') throw new Error('暂时无法核对原任务账号，请重新连接后继续。');
        setUser(verified.user);
        const deps = durableDependencies(token, seq);
        await sidePanelLaunchJournal.cleanup(verified.user.externalId, deps);
        const pending = await sidePanelLaunchJournal.pending(verified.user.externalId);
        if (pending.length === 0) setPendingLaunchId(null);
        for (const entry of pending) {
          if (cancelled) return;
          setPendingLaunchId(entry.clientRequestId);
          const result = await sidePanelLaunchJournal.resume(
            verified.user.externalId,
            entry.clientRequestId,
            deps,
          );
          await assertLaunchSession(token, seq);
          if (cancelled) return;
          setActiveTaskId(result.taskId);
          const draft = pendingLaunchDraft.current;
          if (
            draft &&
            draft.intent === entry.request.intent &&
            draft.snapshot === latestLaunchDraft.current
          ) {
            setIntent('');
            setTaskMode('auto');
            pendingLaunchDraft.current = null;
          }
          setLaunchNotice('已找回此前提交的任务，未重复发送。');
          setPendingLaunchId(null);
          setError(null);
          await sidePanelLaunchJournal.acknowledge(
            verified.user.externalId,
            result.operationId,
            deps,
          );
        }
        if (!cancelled) {
          recoveryAttempts.current = 0;
          await refreshTasksSnapshot();
        }
      } catch (err) {
        if (!cancelled && seq === authSyncSeq.current) {
          setError(humanizeExtensionError(err));
          if (recoveryAttempts.current++ < 12) {
            recoveryTimer.current = setTimeout(
              () => {
                recoveryTimer.current = null;
                if (!cancelled) setRecoveryRetry((n) => n + 1);
              },
              Math.min(5000, 1000 * recoveryAttempts.current),
            );
          }
        }
      } finally {
        if (!cancelled) {
          recoveryInFlight.current = false;
          setSubmitting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      recoveryInFlight.current = false;
      if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
      recoveryTimer.current = null;
    };
  }, [token, launchRecovery, recoveryRetry]);

  // Subscribe to SW snapshots so the result section reflects the
  // task's progress in real time without polling.
  useEffect(() => {
    const listener = (msg: { type?: string; tasks?: unknown; taskId?: string }) => {
      if (msg?.type === 'holaday.tasks.update') setTasks(normalizeTaskSnapshot(msg.tasks));
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  /**
   * Pull the authenticated user record so we can show real name +
   * plan in the header after auto-login. Keep 401 separate from
   * transient network failures so a flaky auth.me request doesn't
   * accidentally erase a still-valid extension session.
   */
  async function fetchMe(authToken: string): Promise<FetchMeResult> {
    try {
      const res = await fetchWithDeadline(
        `${ORCHESTRATOR_HTTP}/trpc/auth.me`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${authToken}` },
        },
        AUTH_ME_TIMEOUT_MS,
        'sidepanel_auth_me_timeout',
      );
      if (res.status === 401) return { kind: 'unauthorized' };
      if (!res.ok) return { kind: 'network' };
      const body = await responseJsonWithDeadline<MeResponse>(
        res,
        AUTH_ME_BODY_TIMEOUT_MS,
        'sidepanel_auth_me_body_timeout',
      );
      const u = body.result.data;
      const user = normalizeStoredUser({
        externalId: u.userId,
        email: u.email,
        plan: u.plan,
        displayName: u.displayName,
      });
      if (!user) return { kind: 'network' };
      return {
        kind: 'ok',
        user,
      };
    } catch {
      return { kind: 'network' };
    }
  }

  async function assertLaunchSession(authToken: string, seq: number): Promise<void> {
    const current = normalizeAccessToken(await getAccessToken());
    if (!mountedRef.current || seq !== authSyncSeq.current || current !== authToken)
      throw new Error('登录态刚刚切换，请重新发送任务。');
  }
  function durableDependencies(authToken: string, seq: number) {
    return sidePanelLaunchDependencies(
      <T,>(procedure: string, input?: unknown, query?: boolean) =>
        browserRequest<T>(authToken, procedure, input, query),
      () => assertLaunchSession(authToken, seq),
    );
  }

  /**
   * "我已登录，重试" button: nudges the SW to retry the
   * localStorage-based auto-login from any open workbench tab. If
   * the SW lifts a token, fetch the user via auth.me and hydrate
   * the UI directly (instead of waiting for the storage.onChanged
   * round trip). On failure, surfaces a hint about what to check.
   */
  async function retryAutoLogin(): Promise<void> {
    if (authRetryInFlight.current) return;
    authRetryInFlight.current = true;
    const seq = ++authSyncSeq.current;
    setStatus('loading');
    setError(null);
    try {
      const resp = await sendRuntimeMessageWithRetry<{ ok?: boolean; token?: string | null }>({
        type: 'holaday.tryAutoLogin',
      });
      if (!mountedRef.current || seq !== authSyncSeq.current) return;
      const liftedToken = normalizeAccessToken(resp?.token);
      if (!liftedToken) {
        setStatus('error');
        setError('没找到已登录的 holaday.ai 标签页。请到 holaday.ai 登录后再点重试。');
        return;
      }
      const result = await fetchMe(liftedToken);
      if (!mountedRef.current || seq !== authSyncSeq.current) return;
      if (result.kind === 'unauthorized') {
        // Token was lifted but rejected by auth.me — likely expired
        // or signed with a different secret. Drop it so the next
        // retry doesn't keep looping with bad creds.
        const current = normalizeAccessToken(await getAccessToken());
        if (shouldClearAuthAfterUnauthorized(current, liftedToken)) {
          await Promise.allSettled([clearAccessToken(), clearStoredUser()]);
        } else if (current) {
          if (mountedRef.current && seq === authSyncSeq.current)
            setStatus(user ? 'connected' : 'idle');
          return;
        }
        if (!mountedRef.current || seq !== authSyncSeq.current) return;
        setStatus('error');
        setError('从 holaday.ai 取到的 token 已失效，请到 holaday.ai 重新登录。');
        return;
      }
      if (result.kind === 'network') {
        setStatus('error');
        setError('暂时无法读取账户信息，浏览器代理会继续保持连接并重试。');
        return;
      }
      await cacheStoredUserBestEffort(result.user);
      if (!mountedRef.current || seq !== authSyncSeq.current) return;
      setUser(result.user);
      setToken(liftedToken);
      setError(null);
      setStatus('connected');
    } catch (err) {
      if (!mountedRef.current) return;
      setStatus('error');
      setError(humanizeExtensionError(err));
    } finally {
      authRetryInFlight.current = false;
    }
  }

  async function logout(): Promise<void> {
    await Promise.allSettled([clearAccessToken(), clearStoredUser()]);
    if (!mountedRef.current) return;
    void sendRuntimeMessageWithRetry({ type: 'holaday.disconnect' });
    clearLocalSessionState();
  }

  async function createTask(): Promise<void> {
    const submittedIntent = normalizeSidePanelIntent(intent);
    if (!submittedIntent || !token) return;
    if (taskSubmitInFlight.current || recoveryInFlight.current) return;
    taskSubmitInFlight.current = true;
    setSubmitting(true);
    setError(null);
    const seq = authSyncSeq.current;
    let reconcileAfterFailure = false;
    setLaunchNotice(null);
    pendingLaunchDraft.current = { intent: submittedIntent, snapshot: latestLaunchDraft.current };
    try {
      const assertSession = async () => {
        const current = normalizeAccessToken(await getAccessToken());
        if (!mountedRef.current || seq !== authSyncSeq.current || current !== token)
          throw new Error('登录态刚刚切换，请重新发送任务。');
      };
      const capturedPage = await getActivePageContext({ metadataOnly: true });
      await assertSession();
      const discovery = await browserRequest<ChromeDiscovery>(token, 'localChromeTabs');
      await assertSession();
      const connection = async () => {
        const state = await sendRuntimeMessageWithRetry<{
          extensionClientId?: string;
          ws?: { connected?: boolean };
        }>({ type: 'holaday.status' });
        return state?.ws?.connected === true ? (state.extensionClientId ?? null) : null;
      };
      if (discovery.launchRecovery) {
        if (!capturedPage) throw new Error('请先选择要处理的网页。');
        const extensionClientId = await connection();
        await assertSession();
        const source = discovery.tabs.find(
          (t) =>
            t.extensionClientId === extensionClientId &&
            t.tabId === capturedPage?.tabId &&
            t.expectedUrl === new URL(capturedPage.url).origin,
        );
        if (!source?.launchBrowserSessionId || !source.launchRecoveryReady)
          throw new Error('请更新并连接原 Chrome 扩展后继续任务。');
        const verified = await fetchMe(token);
        await assertSession();
        if (verified.kind !== 'ok') throw new Error('暂时无法核对任务账号，请重新连接后继续。');
        setUser(verified.user);
        if (user && user.externalId !== verified.user.externalId)
          throw new Error('当前登录账号已更新，请核对侧栏账号后再次发送。');
        const deps = durableDependencies(token, seq);
        const result = await sidePanelLaunchJournal.run(
          verified.user.externalId,
          { intent: submittedIntent },
          {
            browserSessionId: source.launchBrowserSessionId,
            tabId: source.tabId,
            origin: source.expectedUrl,
            selectionId: source.selectionId,
            mode: resolveBrowserTaskMode(submittedIntent, taskMode),
          },
          deps,
        );
        await assertSession();
        setActiveTaskId(result.taskId);
        if (result.recovered) setLaunchNotice('已找回此前创建的任务，未重复发送。');
        setPendingLaunchId(null);
        if (pendingLaunchDraft.current?.snapshot === latestLaunchDraft.current) {
          setIntent('');
          setTaskMode('auto');
          pendingLaunchDraft.current = null;
        }
        await sidePanelLaunchJournal.acknowledge(
          verified.user.externalId,
          result.operationId,
          deps,
        );
        await refreshTasksSnapshot();
        return;
      }
      const launch = await prepareSidePanelLaunch(
        { intent: submittedIntent, page: capturedPage, session: seq, choice: taskMode },
        {
          discover: async () => discovery,
          connection: async () => {
            const status = await sendRuntimeMessageWithRetry<{
              extensionClientId?: string;
              ws?: { connected?: boolean };
            }>({ type: 'holaday.status' });
            return status?.ws?.connected === true ? (status.extensionClientId ?? null) : null;
          },
          prepare: (selection, preparationId) =>
            browserRequest<ChromeLaunchTarget>(token, 'localChromeTaskTab', {
              selection,
              preparationId,
            }),
          assertSession,
          legacyContext: getActivePageContext,
          launches: launches.current,
        },
      );
      const res = await fetchWithDeadline(
        `${ORCHESTRATOR_HTTP}/trpc/tasks.create`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(launch.body),
        },
        CREATE_TASK_TIMEOUT_MS,
        'sidepanel_create_task_timeout',
      );
      if (!res.ok) {
        if (res.status === 401) {
          const current = normalizeAccessToken(await getAccessToken());
          if (shouldClearAuthAfterCreateUnauthorized(current, token)) {
            await Promise.allSettled([clearAccessToken(), clearStoredUser()]);
            if (mountedRef.current) clearLocalSessionState();
            throw new Error('登录已失效，请到 holaday.ai 重新登录后再发送任务。');
          }
          if (current) {
            if (mountedRef.current) setToken(current);
            throw new Error('登录态刚刚切换，请重新发送任务。');
          }
          if (mountedRef.current) clearLocalSessionState();
          throw new Error('登录态已清除，请到 holaday.ai 登录后再发送任务。');
        }
        const body = await responseJsonWithDeadline<{ error?: { message?: string } } | null>(
          res,
          CREATE_TASK_BODY_TIMEOUT_MS,
          'sidepanel_create_task_error_body_timeout',
        ).catch(() => null);
        throw new Error(humanizeExtensionError(body?.error?.message ?? `HTTP ${res.status}`));
      }
      const body = await responseJsonWithDeadline<CreateTaskResponse>(
        res,
        CREATE_TASK_BODY_TIMEOUT_MS,
        'sidepanel_create_task_body_timeout',
      );
      if (!mountedRef.current) return;
      const currentToken = normalizeAccessToken(await getAccessToken());
      if (didTokenSwitchDuringTaskCreate(currentToken, token)) {
        setIntent('');
        await refreshTasksSnapshot();
        throw new Error('登录态刚刚切换；任务可能已发送，请打开 HOLA DAY 网页确认最新任务。');
      }
      const newTaskId = extractCreatedTaskId(body);
      if (!newTaskId) {
        setIntent('');
        await refreshTasksSnapshot();
        throw new Error('任务已发送，但返回信息不完整；请打开 HOLA DAY 网页查看最新任务。');
      }
      setActiveTaskId(newTaskId);
      if (launch.key) launches.current.complete(launch.key);
      setIntent('');
      setTaskMode('auto');
      // Nudge the SW to push the latest snapshot — the SW updates
      // arrive via the listener above as the WS frames flow in.
      await refreshTasksSnapshot();
    } catch (err) {
      if (!mountedRef.current) return;
      if (launchRecovery) {
        setPendingLaunchId('unconfirmed');
        reconcileAfterFailure = true;
      }
      setError(humanizeExtensionError(err));
    } finally {
      taskSubmitInFlight.current = false;
      if (mountedRef.current) setSubmitting(false);
      if (reconcileAfterFailure && mountedRef.current) setRecoveryRetry((n) => n + 1);
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
      (t) => t.status === 'planning' || t.status === 'executing' || t.status === 'awaiting_user',
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
        {backgroundTabs ? (
          <label style={metaSubStyle}>
            任务页面
            <select
              aria-label="任务页面"
              value={taskMode}
              onChange={(event) => setTaskMode(event.currentTarget.value as BrowserTaskModeChoice)}
              disabled={submitting}
            >
              <option value="auto">
                {resolveBrowserTaskMode(intent) === 'current'
                  ? '处理当前页（按你的指令）'
                  : '独立任务页（默认）'}
              </option>
              <option value="independent">独立任务页</option>
              <option value="current">处理当前页</option>
            </select>
            <div>独立任务页在后台执行，你可以继续浏览。</div>
          </label>
        ) : null}
        <textarea
          rows={3}
          placeholder={
            backgroundTabs ? '想让 HOLA DAY 帮你完成什么？' : '想让 HOLA DAY 在这页面上做什么？'
          }
          value={intent}
          maxLength={MAX_SIDE_PANEL_INTENT_CHARS}
          onChange={(e) => setIntent(e.currentTarget.value.slice(0, MAX_SIDE_PANEL_INTENT_CHARS))}
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
        {error ? (
          <div role="alert" style={errorStyle}>
            {error}
          </div>
        ) : null}
        {pendingLaunchId ? (
          <button
            type="button"
            style={miniBtn}
            disabled={submitting}
            onClick={() => {
              recoveryAttempts.current = 0;
              setRecoveryRetry((n) => n + 1);
            }}
          >
            重新核对此前提交
          </button>
        ) : null}
        {launchNotice ? (
          <output style={{ ...metaSubStyle, display: 'block' }}>{launchNotice}</output>
        ) : null}
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
  const phaseLabel = task.visionProgress
    ? renderVisionPhase(task.visionProgress, task.status)
    : null;
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

function renderVisionPhase(p: VisionProgressView, status: TaskStatus): string {
  switch (status) {
    case 'cancelled':
      return '任务已取消';
    case 'partial_success':
      return '任务部分完成';
    case 'completed':
      return '任务完成';
    case 'failed':
      return '任务失败';
  }
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
