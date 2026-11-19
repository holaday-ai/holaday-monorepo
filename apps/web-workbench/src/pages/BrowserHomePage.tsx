import {
  type CdpScreencastStatus,
  CdpScreencastViewport,
} from '@/components/CdpScreencastViewport';
import { InputArea } from '@/components/InputArea';
import { BrowserHomeAddressBar } from '@/components/browser-home/BrowserHomeAddressBar';
import { BrowserHomeFiles } from '@/components/browser-home/BrowserHomeFiles';
import { BrowserHomeProfiles } from '@/components/browser-home/BrowserHomeProfiles';
import { BrowserHomeTaskCard } from '@/components/browser-home/BrowserHomeTaskCard';
import { BrowserHomeUpload } from '@/components/browser-home/BrowserHomeUpload';
import { BrowserHomeView, recentBrowserHomeTasks } from '@/components/browser-home/BrowserHomeView';
import {
  type ComposerSubmitResult,
  clearComposerOnSubmitSuccess,
  keepComposerOnSubmitFailure,
} from '@/components/composer-submit';
import { useToast } from '@/components/ui/toast';
import { getAccessToken } from '@/lib/auth';
import {
  type BrowserHomeNavDirection,
  type BrowserHomeRegion,
  browserHomeErrorMessage,
  browserHomeNavFailureMessage,
  browserHomeOpenErrorMessage,
  isBrowserHomeClosedSendError,
  isWebPageUrl,
} from '@/lib/browser-home';
import { createBrowserHomeTask } from '@/lib/browser-home-task';
import { buildScreencastWsUrl } from '@/lib/screencast-url';
import { trpc } from '@/lib/trpc';
import { useKeyboardInset } from '@/lib/use-keyboard-inset';
import { useStreamToken } from '@/lib/use-stream-token';
import { useTaskStore } from '@/stores/task-store';
import type { UiSkillSelection } from '@/types/task';
import { Loader2, RotateCw } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';

type SessionState =
  | { status: 'opening' }
  | {
      status: 'ready';
      sessionId: string;
      viewportV2: boolean;
      collaborationV2: boolean;
      filesAvailable: boolean;
      filesEnabled: boolean;
      uploadInstanceId: string | null;
    }
  | { status: 'error'; message: string };

/** One id per page mount: the server counts open /browser pages (P2-4, see browserHome.close). */
function newViewerId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `v${random}`.slice(0, 40);
}

/**
 * BROWSER-HOME-1 —「云浏览器」. The person's own task-less cloud browser (`bhs_<userId>`): a thin
 * address bar, the HOLA DAY home (rendered here, while the browser is allocated in the
 * background) until a site is opened, then the live screen, with the unified composer floating
 * over the bottom. Leaving the route lets the browser go: the server releases it a few seconds
 * after the last open /browser page of this user left (another tab keeps it; coming back within
 * the grace keeps the same browser).
 *
 * P1-2: the browser can go away under an open page (15-minute idle while the home view shows, a
 * crash). An address-bar action answered「no session」, a send refused because no browser is open,
 * or the screen's stream dropping, reopens it quietly (the server goes back to the last address)
 * and retries the action once.
 */
export function BrowserHomePage({
  region,
  plan,
  ownerId,
  profilesEnabled = false,
}: {
  region: BrowserHomeRegion | null;
  plan: string;
  ownerId?: string;
  profilesEnabled?: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const tasks = useTaskStore((s) => s.tasks);
  const recentTasks = React.useMemo(() => recentBrowserHomeTasks(tasks), [tasks]);
  const keyboardInset = useKeyboardInset();

  const [session, setSession] = React.useState<SessionState>({ status: 'opening' });
  const [view, setView] = React.useState<'home' | 'browser'>('home');
  const [url, setUrl] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [streamStatus, setStreamStatus] = React.useState<CdpScreencastStatus>('idle');
  // Step 4: the task sent from the floating input, shown in the card above it.
  const [activeTaskId, setActiveTaskId] = React.useState<string | null>(null);
  const aliveRef = React.useRef(true);
  const openRef = React.useRef<Promise<string | null> | null>(null);
  const openErrorRef = React.useRef<string | null>(null);
  // Once the person opened something, a late open() result must not switch the view under them.
  const navigatedRef = React.useRef(false);
  const viewerIdRef = React.useRef<string | null>(null);

  /**
   * Open (or reuse) the browser. `quiet`: a reopen behind an action already on screen — the page
   * keeps showing what it shows instead of flashing「正在打开」.
   */
  const openSession = React.useCallback((options?: { quiet?: boolean }): Promise<string | null> => {
    if (!options?.quiet) setSession({ status: 'opening' });
    openErrorRef.current = null;
    const viewerId = viewerIdRef.current;
    const promise = trpc.browserHome.open.mutate(viewerId ? { viewerId } : undefined).then(
      (res) => {
        if (!aliveRef.current) return null;
        setSession({
          status: 'ready',
          sessionId: res.sessionId,
          viewportV2: res.capabilities?.viewportV2 === true,
          collaborationV2: res.capabilities?.collaborationV2 === true,
          filesAvailable: res.filesAvailable === true,
          filesEnabled: res.filesEnabled === true,
          uploadInstanceId: res.uploadsEnabled === true ? res.uploadInstanceId : null,
        });
        // An open browser (or the last address, restored) goes on showing its page.
        if (isWebPageUrl(res.url) && !navigatedRef.current) {
          setUrl(res.url);
          setView('browser');
        }
        return res.sessionId;
      },
      (error: unknown) => {
        const message = browserHomeOpenErrorMessage(error);
        openErrorRef.current = message;
        if (aliveRef.current) setSession({ status: 'error', message });
        return null;
      },
    );
    openRef.current = promise;
    return promise;
  }, []);

  React.useEffect(() => {
    aliveRef.current = true;
    const viewerId = newViewerId();
    const viewerToken = getAccessToken();
    viewerIdRef.current = viewerId;
    void openSession();
    // React cleanup is not guaranteed on a reload or full-page navigation. Release exactly
    // this document's viewer; a new document's open cancels the server's close grace.
    const leaveDocument = () => {
      if (!viewerToken) return;
      void fetch('/api/trpc/browserHome.close', {
        method: 'POST',
        keepalive: true,
        headers: { authorization: `Bearer ${viewerToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ viewerId }),
      }).catch(() => undefined);
    };
    const rejoinDocument = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      if (getAccessToken() !== viewerToken) {
        window.location.reload();
        return;
      }
      void openSession({ quiet: true });
    };
    window.addEventListener('pagehide', leaveDocument);
    window.addEventListener('pageshow', rejoinDocument);
    return () => {
      window.removeEventListener('pagehide', leaveDocument);
      window.removeEventListener('pageshow', rejoinDocument);
      aliveRef.current = false;
      openRef.current = null;
      if (viewerIdRef.current === viewerId) viewerIdRef.current = null;
      // The server keeps the browser while another page of this user uses it, and for a short
      // grace that a quick return (or a StrictMode remount) cancels with its open.
      void trpc.browserHome.close.mutate({ viewerId }).catch(() => undefined);
    };
  }, [openSession]);

  /** P1-2: the browser went away under this page — open it again, quietly, at most once per call. */
  const reopenQuietly = React.useCallback(async (): Promise<string | null> => {
    if (!aliveRef.current) return null;
    return openSession({ quiet: true });
  }, [openSession]);

  const navigateBrowser = React.useCallback(
    async (direction: BrowserHomeNavDirection, input?: string): Promise<boolean> => {
      const target = input?.trim() ?? '';
      if (direction === 'goto' && !target) return false;
      if (direction === 'goto') navigatedRef.current = true;
      setPending(true);
      try {
        let sessionId = openRef.current ? await openRef.current : null;
        if (!sessionId && aliveRef.current) sessionId = await openSession();
        if (!aliveRef.current) return false;
        if (!sessionId) {
          toast.show(openErrorRef.current ?? '云浏览器打开失败，请稍后重试', 'error');
          return false;
        }
        const request = direction === 'goto' ? { direction, input: target } : { direction };
        let res = await trpc.browserHome.nav.mutate(request);
        if (!aliveRef.current) return false;
        // The browser is gone (idle release, crash): reopen at the last address, retry once.
        if (!res.ok && res.reason === 'no_session') {
          if (!(await reopenQuietly()) || !aliveRef.current) {
            if (aliveRef.current)
              toast.show(openErrorRef.current ?? '云浏览器打开失败，请稍后重试', 'error');
            return false;
          }
          res = await trpc.browserHome.nav.mutate(request);
          if (!aliveRef.current) return false;
        }
        if (!res.ok) {
          // Back from the first page returns to the HOLA DAY home.
          if (direction === 'back' && res.reason === 'no_history') {
            setView('home');
            return true;
          }
          const message = browserHomeNavFailureMessage(res, direction);
          if (message) toast.show(message, 'error');
          return false;
        }
        if (direction === 'back' && !isWebPageUrl(res.url)) {
          setView('home');
          return true;
        }
        if (isWebPageUrl(res.url)) setUrl(res.url);
        if (direction === 'goto' || isWebPageUrl(res.url)) setView('browser');
        return true;
      } catch (error) {
        if (aliveRef.current) toast.show(browserHomeErrorMessage(error, direction), 'error');
        return false;
      } finally {
        if (aliveRef.current) setPending(false);
      }
    },
    [openSession, reopenQuietly, toast],
  );

  const submitTask = React.useCallback(
    async (
      intent: string,
      fileIds: string[],
      mode?: 'auto' | 'plan',
      expertMode?: 'normal' | 'expert' | 'auto',
      skillSelection?: UiSkillSelection,
    ): Promise<ComposerSubmitResult> => {
      // The assistant asked something: the floating input answers it (the task still holds the
      // browser, so a new task could not run there anyway).
      const current = activeTaskId
        ? useTaskStore.getState().tasks.find((t) => t.taskId === activeTaskId)
        : null;
      if (current?.status === 'awaiting_user') {
        const replied = await useTaskStore.getState().replyToTask(current.taskId, intent, fileIds);
        if ('error' in replied || !replied.ok) {
          return {
            ...keepComposerOnSubmitFailure,
            error: 'error' in replied ? replied.error : '回复结果尚未确认，请核对当前任务。',
          };
        }
        return clearComposerOnSubmitSuccess;
      }
      // The task runs in this page's browser: make sure it is open first.
      let sessionId = openRef.current ? await openRef.current : null;
      if (!sessionId && aliveRef.current) sessionId = await openSession();
      if (!aliveRef.current) return keepComposerOnSubmitFailure;
      if (!sessionId) {
        return {
          ...keepComposerOnSubmitFailure,
          error: openErrorRef.current ?? '云浏览器打开失败，请稍后重试',
        };
      }
      const task = { intent, fileIds, mode, expertMode, skillSelection };
      let res = await createBrowserHomeTask(task);
      // Refused because the browser is gone (idle release, crash): reopen it, send once more.
      if ('error' in res && isBrowserHomeClosedSendError(res.error) && aliveRef.current) {
        if (await reopenQuietly()) res = await createBrowserHomeTask(task);
      }
      if ('error' in res) {
        return { ...keepComposerOnSubmitFailure, error: res.error };
      }
      if (!aliveRef.current) return clearComposerOnSubmitSuccess;
      // Stay on this page: the assistant works on the screen, the card shows its progress.
      setActiveTaskId(res.taskId);
      navigatedRef.current = true;
      setView('browser');
      return clearComposerOnSubmitSuccess;
    },
    [activeTaskId, openSession, reopenQuietly],
  );

  const sessionId = session.status === 'ready' ? session.sessionId : null;
  const showScreen = view === 'browser' && Boolean(sessionId);
  const { token: streamToken } = useStreamToken(showScreen);
  const wsUrl = React.useMemo(
    () => (showScreen ? buildScreencastWsUrl(sessionId) : null),
    [showScreen, sessionId],
  );
  const handleUrlChange = React.useCallback((next: string) => {
    if (isWebPageUrl(next)) setUrl(next);
  }, []);
  // P1-2: a dropped stream may mean the browser is gone; one quiet reopen per connection (open
  // is a no-op for a browser that is still there, and the stream reconnects on its own).
  const streamReopenArmedRef = React.useRef(true);
  const handleStreamStatus = React.useCallback(
    (status: CdpScreencastStatus) => {
      setStreamStatus(status);
      if (status === 'connected') {
        streamReopenArmedRef.current = true;
        return;
      }
      if ((status === 'disconnected' || status === 'error') && streamReopenArmedRef.current) {
        streamReopenArmedRef.current = false;
        void reopenQuietly();
      }
    },
    [reopenQuietly],
  );

  return (
    <div
      className="hd-browser-home relative flex h-svh min-h-0 flex-col overflow-hidden bg-background pt-12 min-[769px]:pt-[var(--shell-header-height)]"
      data-view={view}
    >
      <BrowserHomeAddressBar
        view={view}
        url={url}
        pending={pending}
        onNavigate={navigateBrowser}
        onHome={() => setView('home')}
        endContent={
          ownerId ? (
            <>
              {profilesEnabled && (
                <BrowserHomeProfiles key={`profiles-${ownerId}`} ownerId={ownerId} />
              )}
              {session.status === 'ready' && session.filesAvailable && (
                <BrowserHomeFiles ownerId={ownerId} receiving={session.filesEnabled} />
              )}
            </>
          ) : null
        }
      />
      {ownerId && session.status === 'ready' && session.uploadInstanceId && (
        <BrowserHomeUpload ownerId={ownerId} instanceId={session.uploadInstanceId} />
      )}
      <div className="relative min-h-0 flex-1">
        {view === 'home' ? (
          <div className="h-full overflow-y-auto">
            {session.status === 'error' && (
              <SessionNotice message={session.message} onRetry={() => void openSession()} />
            )}
            <BrowserHomeView
              region={region}
              onOpen={(input) => navigateBrowser('goto', input)}
              recentTasks={recentTasks}
              onOpenTask={(taskId) => navigate(`/?task=${encodeURIComponent(taskId)}`)}
            />
          </div>
        ) : (
          <div className="absolute inset-0 px-2 pb-2 sm:px-6 sm:pb-5">
            <div className="relative h-full overflow-hidden rounded-[14px] border border-[#E6E7EB] bg-[#F6F7F9] dark:border-white/10 dark:bg-black/30">
              {wsUrl && (
                <CdpScreencastViewport
                  wsUrl={wsUrl}
                  streamToken={streamToken}
                  viewOnly={session.status !== 'ready' || !session.collaborationV2}
                  viewportV2={session.status === 'ready' && session.viewportV2}
                  collaborationV2={session.status === 'ready' && session.collaborationV2}
                  fitMode="contain"
                  onUrlChange={handleUrlChange}
                  onStatusChange={handleStreamStatus}
                  onInputRefused={() => toast.show('页面或连接已变化，请等画面更新后重试', 'info')}
                />
              )}
              {session.status === 'error' ? (
                <div className="absolute inset-0 flex items-center justify-center p-6">
                  <SessionNotice message={session.message} onRetry={() => void openSession()} />
                </div>
              ) : (
                (session.status === 'opening' || streamStatus !== 'connected') && (
                  <div
                    className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-muted-foreground"
                    aria-live="polite"
                  >
                    <Loader2 className="h-4 w-4 animate-spin text-[#FF0061]" aria-hidden />
                    {session.status === 'opening' ? '正在打开云浏览器…' : '正在连接画面…'}
                  </div>
                )
              )}
            </div>
          </div>
        )}
        <div
          className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3 pb-3 sm:pb-6"
          style={{ bottom: keyboardInset }}
        >
          <div className="w-full max-w-[640px]">
            {activeTaskId && (
              <BrowserHomeTaskCard
                taskId={activeTaskId}
                onDismiss={() => setActiveTaskId(null)}
                onOpenTask={(taskId) => navigate(`/?task=${encodeURIComponent(taskId)}`)}
              />
            )}
            <InputArea
              floating
              onSubmit={submitTask}
              attachmentsAllowed={plan !== 'free'}
              attachmentByteCap={
                plan === 'pro' ? 10 * 1024 * 1024 : plan === 'basic' ? 5 * 1024 * 1024 : 0
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry(): void;
}): JSX.Element {
  return (
    <div
      role="alert"
      className="mx-auto mt-4 flex w-fit max-w-[calc(100%-32px)] items-center gap-3 rounded-[12px] border border-[#FF0061]/20 bg-[#FF0061]/5 px-3.5 py-2 text-[13px] text-[#595757] dark:text-foreground/85"
    >
      <span className="min-w-0">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex shrink-0 items-center gap-1 rounded-[8px] px-2 py-1 text-[12px] font-medium text-[#FF0061] hover:bg-[#FF0061]/10"
      >
        <RotateCw className="h-3.5 w-3.5" aria-hidden />
        重试
      </button>
    </div>
  );
}
