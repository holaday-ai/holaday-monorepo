import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { type HomeProfileContext, createHomeProfileContext } from '@/lib/home-profile-context';
import type { HomeProfileOptions, HomeSaveInspection } from '@/lib/home-profile-journal';
import { Bookmark, Loader2, RefreshCw } from 'lucide-react';
import * as React from 'react';

const BUTTON =
  'min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40';
const statusText: Record<string, string> = {
  connected: '已保存',
  awaiting_import: '等待保存',
  verifying: '正在核对',
  relogin: '需重新登录',
  risk_blocked: '站点需验证',
  revoked: '已移除',
  expired: '已过期',
};

/** Site-state consent belongs to the personal workspace. Choosing a default preserves its live page. */
export function BrowserHomeProfiles({ ownerId }: { ownerId: string }): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<HomeProfileOptions | null>(null);
  const [inspection, setInspection] = React.useState<HomeSaveInspection | null>(null);
  const [unknown, setUnknown] = React.useState(false);
  const [consent, setConsent] = React.useState(false);
  const [includeStorage, setIncludeStorage] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [removal, setRemoval] = React.useState<{ id: string; origin: string } | null>(null);
  const context = React.useRef<HomeProfileContext | null>(null);
  const mounted = React.useRef(true);
  const actor = React.useRef(ownerId);
  const generation = React.useRef(0);
  actor.current = ownerId;
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  React.useEffect(() => {
    generation.current++;
    context.current = null;
    setOpen(false);
    setOptions(null);
    setConsent(false);
    setUnknown(false);
    setInspection(null);
    setMessage(null);
    setError(null);
    setRemoval(null);
    setBusy(false);
  }, [ownerId]);

  const getContext = async () => {
    if (context.current) {
      context.current.current();
      return context.current;
    }
    const originalOwner = ownerId;
    const bound = await createHomeProfileContext(originalOwner, () => {
      if (!mounted.current || actor.current !== originalOwner)
        throw new Error('账号已变化，请重新打开保存面板。');
    });
    context.current = bound;
    return bound;
  };
  const stillHere = (stamp: number) => mounted.current && generation.current === stamp;
  const showError = (failure: unknown) => {
    setError(failure instanceof Error ? failure.message : '暂时无法处理，请核对保存结果后重试。');
    try {
      context.current?.current();
    } catch {
      context.current = null;
      setOptions(null);
      setInspection(null);
      setUnknown(false);
      setMessage(null);
    }
  };
  const load = async () => {
    const stamp = ++generation.current;
    setBusy(true);
    setError(null);
    setConsent(false);
    setRemoval(null);
    try {
      const bound = await getContext();
      // Reconcile the old operation before asking for a source for a new consent.
      const prior = await bound.journal.inspect();
      const next = await bound.api.options();
      if (!stillHere(stamp)) return;
      bound.current();
      setInspection(prior);
      setUnknown(prior.pending !== null);
      setOptions(next);
      if (prior.receipt?.state === 'saved') setMessage(`已保存 ${prior.receipt.origin}。`);
    } catch (failure) {
      if (stillHere(stamp)) showError(failure);
    } finally {
      if (stillHere(stamp)) setBusy(false);
    }
  };
  const run = async (
    kind: 'save' | 'cancel' | 'setting',
    work: (bound: HomeProfileContext) => Promise<string>,
  ) => {
    const stamp = ++generation.current;
    setBusy(true);
    setError(null);
    setMessage(null);
    setConsent(false);
    setRemoval(null);
    try {
      const bound = await getContext();
      const text = await work(bound);
      const prior = await bound.journal.inspect();
      const next = await bound.api.options();
      if (!stillHere(stamp)) return;
      bound.current();
      setOptions(next);
      setInspection(prior);
      setUnknown(prior.pending !== null);
      setMessage(text);
    } catch (failure) {
      if (stillHere(stamp)) {
        if (kind !== 'setting') setUnknown(true);
        showError(failure);
      }
    } finally {
      if (stillHere(stamp)) setBusy(false);
    }
  };
  const source = options?.enabled ? options.source : null;
  const unresolved = unknown || Boolean(inspection?.pending);
  const profiles = options?.enabled ? options.profiles : [];
  const selected = options?.enabled ? options.selectedProfileId : null;
  const validSelection = profiles.some(
    (profile) => profile.id === selected && profile.status === 'connected',
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setMessage(null);
          void load();
        } else generation.current++;
      }}
    >
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="已保存的网站"
          title="已保存的网站"
          className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bookmark className="h-4 w-4" aria-hidden />
        </button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-5 overflow-y-auto px-5 pb-8 sm:max-w-[420px]">
        <SheetHeader className="pr-7 text-left">
          <SheetTitle>已保存的网站</SheetTitle>
          <SheetDescription>
            保存站点状态，下次新开个人浏览器时恢复。网站仍可能要求重新登录。
          </SheetDescription>
        </SheetHeader>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">当前页面会保持打开</span>
          <button
            type="button"
            className={`${BUTTON} inline-flex items-center gap-2 hover:bg-muted`}
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            刷新列表
          </button>
        </div>
        {busy && (
          <output className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            正在核对…
          </output>
        )}
        {message && <output className="break-words text-sm text-foreground">{message}</output>}
        {error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {error}
          </p>
        )}
        {unresolved ? (
          <section className="space-y-3 rounded-xl border p-4 text-sm">
            <h3 className="font-medium">上一次保存仍需核对</h3>
            {inspection?.pending && (
              <p className="break-all text-muted-foreground">{inspection.pending.origin}</p>
            )}
            <p className="text-muted-foreground">
              确认原结果后才能保存新页面。取消会阻止迟到的保存请求，已保存的结果会保留。
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`${BUTTON} bg-primary text-primary-foreground`}
                disabled={busy}
                onClick={() => void load()}
              >
                核对保存结果
              </button>
              <button
                type="button"
                className={`${BUTTON} hover:bg-muted`}
                disabled={busy}
                onClick={() =>
                  void run('cancel', async (bound) => {
                    const result = await bound.journal.cancel();
                    return result.state === 'saved'
                      ? `已保存 ${result.origin}，结果已保留。`
                      : '上一次保存已取消，可以重新确认当前页面。';
                  })
                }
              >
                取消未确认的保存
              </button>
            </div>
          </section>
        ) : null}
        {options && !options.enabled ? (
          <p className="text-sm text-muted-foreground">站点状态保存暂不可用。</p>
        ) : null}
        {options?.enabled && (
          <>
            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-medium">保存当前站点</h3>
              {source ? (
                <>
                  <p className="break-all text-sm text-foreground">{source.origin}</p>
                  <label className="flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={includeStorage}
                      disabled={busy || unresolved}
                      onChange={(event) => {
                        setIncludeStorage(event.target.checked);
                        setConsent(false);
                      }}
                    />
                    同时保存站点浏览设置
                  </label>
                  <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
                    <input
                      type="checkbox"
                      className="mt-1.5"
                      checked={consent}
                      disabled={busy || unresolved}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    <span>
                      我同意保存此站点及共用登录站点的状态，用于我的个人云浏览器和已授权的网页任务。
                    </span>
                  </label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    状态会加密保存，可随时移除。只保留站点授权范围内的状态，不代表网站已登录。
                  </p>
                  <button
                    type="button"
                    className={`${BUTTON} w-full bg-primary text-primary-foreground hover:opacity-90`}
                    disabled={busy || unresolved || !consent}
                    onClick={() =>
                      void run('save', async (bound) => {
                        const result = await bound.journal.save(options, includeStorage);
                        return result.receipt?.state === 'saved'
                          ? `已保存 ${result.receipt.origin}。`
                          : '上一次保存仍需核对，未新建保存。';
                      })
                    }
                  >
                    保存当前站点
                  </button>
                </>
              ) : (
                <p className="text-sm leading-6 text-muted-foreground">
                  请先打开要保存的网站，结束正在进行的任务或输入，再刷新此列表。
                </p>
              )}
            </section>
            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-medium">下次打开个人浏览器</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                选择仅影响新开的浏览器，不会替换当前页面，也不会复制本机 Chrome 的登录状态。
              </p>
              {selected && !validSelection && (
                <output className="text-sm text-destructive">
                  原保存状态已失效，请重新选择或不使用保存状态。
                </output>
              )}
              <button
                type="button"
                className={`${BUTTON} w-full border text-left hover:bg-muted`}
                disabled={busy || unresolved || selected === null}
                onClick={() =>
                  void run('setting', async (bound) => {
                    await bound.api.select(null);
                    return '下次打开时不使用保存状态，当前页面未改变。';
                  })
                }
              >
                不使用保存状态{selected === null ? ' · 已选择' : ''}
              </button>
              {profiles.length === 0 && (
                <p className="text-sm text-muted-foreground">还没有已保存的网站。</p>
              )}
              {profiles.map((profile) => (
                <div key={profile.id} className="space-y-2 border-b py-3 last:border-0">
                  <p className="break-all text-sm font-medium">{profile.origin}</p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {statusText[profile.status] ?? '状态待确认'} · 到期{' '}
                    {new Date(profile.expiresAt).toLocaleDateString()}
                  </p>
                  {selected === profile.id && (
                    <p className="text-xs font-medium text-primary">下次打开时使用</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {profile.status === 'connected' && selected !== profile.id && (
                      <button
                        type="button"
                        className={`${BUTTON} border hover:bg-muted`}
                        disabled={busy || unresolved}
                        onClick={() =>
                          void run('setting', async (bound) => {
                            await bound.api.select(profile.id);
                            return '已设置为下次打开时使用，当前页面未改变。';
                          })
                        }
                      >
                        下次打开时使用此状态
                      </button>
                    )}
                    {!['revoked', 'expired'].includes(profile.status) && (
                      <button
                        type="button"
                        className={`${BUTTON} text-destructive hover:bg-muted`}
                        disabled={busy || unresolved}
                        onClick={() => setRemoval({ id: profile.id, origin: profile.origin })}
                      >
                        移除保存状态
                      </button>
                    )}
                  </div>
                  {removal?.id === profile.id && (
                    <div className="space-y-2 rounded-lg bg-muted p-3 text-sm">
                      <p>移除 {removal.origin} 的保存状态？正在使用这份状态的浏览器会停止。</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={`${BUTTON} text-destructive`}
                          disabled={busy}
                          onClick={() =>
                            void run('setting', async (bound) => {
                              await bound.api.forget(profile.id);
                              return '保存状态已移除。';
                            })
                          }
                        >
                          确认移除
                        </button>
                        <button
                          type="button"
                          className={BUTTON}
                          disabled={busy}
                          onClick={() => setRemoval(null)}
                        >
                          保留
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
