import {
  BROWSER_HOME_SEARCH_ENGINES,
  type BrowserHomeRegion,
  type BrowserHomeSearchEngineId,
  type BrowserHomeShortcut,
  type BrowserHomeSite,
  MAX_BROWSER_HOME_SHORTCUTS,
  browserHomeRegion,
  browserHomeSearchEngine,
  browserHomeSearchTarget,
  defaultBrowserHomeSearchEngine,
  loadBrowserHomeSites,
  normalizeShortcutUrl,
  readBrowserHomeShortcuts,
  shortcutNameFor,
  visibleBrowserHomeSites,
  writeBrowserHomeShortcuts,
} from '@/lib/browser-home';
import { cn } from '@/lib/utils';
import type { UiTask } from '@/types/task';
import { Clock, Plus, Search, X } from 'lucide-react';
import * as React from 'react';

const SECTION_TITLE = 'mb-3 text-[13px] font-medium text-[#595757] dark:text-foreground/80';
const TILE =
  'group relative flex min-w-0 flex-col items-center gap-1.5 rounded-[14px] px-1 py-2 text-center transition-colors hover:bg-[#FF0061]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF0061]/25 dark:hover:bg-white/5';
const TILE_ICON =
  'flex h-12 w-12 items-center justify-center overflow-hidden rounded-[14px] border border-[#E6E7EB] bg-white shadow-[0_1px_2px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-white/90';
const TILE_LABEL = 'w-full truncate text-[12px] text-[#595757] dark:text-foreground/80';
const GRID = 'grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-6 lg:grid-cols-8';
const RECENT_TASK_LIMIT = 5;

/**
 * BROWSER-HOME-1 — the HOLA DAY home of the cloud browser, rendered by the app (not inside the
 * cloud browser: 「最近任务」needs the login and the first screen must not wait for a browser).
 * Search box → 推荐网站 (config) → 我的快捷方式 (the person's own, kept apart) → 最近任务.
 * Anything opened here goes to the cloud browser through `onOpen`.
 */
export function BrowserHomeView({
  region,
  onOpen,
  recentTasks,
  onOpenTask,
  production = import.meta.env.PROD,
  loadSites = loadBrowserHomeSites,
}: {
  region: BrowserHomeRegion | null;
  /** An address or search words for the cloud browser; resolves true once it went there. */
  onOpen(input: string): Promise<boolean>;
  recentTasks: readonly UiTask[];
  onOpenTask(taskId: string): void;
  /** Placeholder tiles (no list from BOSS yet) never show in a production build. */
  production?: boolean;
  loadSites?: () => Promise<BrowserHomeSite[]>;
}): JSX.Element {
  const [engine, setEngine] = React.useState<BrowserHomeSearchEngineId>(() =>
    defaultBrowserHomeSearchEngine(region),
  );
  const [query, setQuery] = React.useState('');
  const [sites, setSites] = React.useState<BrowserHomeSite[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    void loadSites().then((loaded) => {
      if (!cancelled) setSites(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [loadSites]);

  const shownSites = React.useMemo(
    () => visibleBrowserHomeSites(sites, browserHomeRegion(region), { production }),
    [sites, region, production],
  );
  const engineLabel = browserHomeSearchEngine(engine).label;

  const submitSearch = async (): Promise<void> => {
    const target = browserHomeSearchTarget(query, engine);
    if (!target) return;
    if (await onOpen(target)) setQuery('');
  };

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 pb-36 pt-8 sm:px-6 sm:pt-14">
      <h1 className="mb-5 text-center text-[22px] font-semibold tracking-tight text-[#252525] dark:text-foreground sm:mb-6 sm:text-[26px]">
        <span className="text-[#FF0061]">HOLA DAY</span> 云浏览器
      </h1>

      <form
        aria-label="搜索网页"
        className="mx-auto flex h-12 max-w-[640px] items-center gap-2 rounded-full border border-[#E6E7EB] bg-white pl-1.5 pr-1.5 shadow-[0_8px_24px_rgba(17,24,39,0.07)] transition-colors focus-within:border-[#FF0061]/40 focus-within:ring-2 focus-within:ring-[#FF0061]/10 dark:border-white/10 dark:bg-card"
        onSubmit={(event) => {
          event.preventDefault();
          void submitSearch();
        }}
      >
        <fieldset className="flex shrink-0 items-center rounded-full bg-[#F3F4F6] p-0.5 dark:bg-white/10">
          <legend className="sr-only">搜索引擎</legend>
          {BROWSER_HOME_SEARCH_ENGINES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={engine === option.id}
              onClick={() => setEngine(option.id)}
              className={cn(
                'h-8 rounded-full px-2.5 text-[12px] font-medium transition-colors sm:px-3',
                engine === option.id
                  ? 'bg-white text-[#FF0061] shadow-[0_1px_2px_rgba(17,24,39,0.08)] dark:bg-card'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
        <input
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`用 ${engineLabel} 搜索，或输入网址`}
          aria-label={`用 ${engineLabel} 搜索，或输入网址`}
          className="h-full min-w-0 flex-1 border-0 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        <button
          type="submit"
          aria-label="搜索"
          title="搜索"
          disabled={!query.trim()}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FF0061] text-white transition-colors hover:bg-[#FF0061]/90 disabled:bg-[#EFEFEF] disabled:text-[#BCBCBC] dark:disabled:bg-white/10"
        >
          <Search className="h-4 w-4" aria-hidden />
        </button>
      </form>

      {shownSites.length > 0 && (
        <section aria-labelledby="browser-home-sites" className="mt-9">
          <h2 id="browser-home-sites" className={SECTION_TITLE}>
            推荐网站
          </h2>
          <ul className={GRID}>
            {shownSites.map((site, index) => (
              <li key={`${site.name}-${index}`} className="min-w-0">
                {site.placeholder ? (
                  <div
                    className={cn(TILE, 'cursor-default hover:bg-transparent')}
                    data-placeholder="true"
                    aria-label="待添加"
                  >
                    <span className="h-12 w-12 rounded-[14px] bg-[#EFEFEF] dark:bg-white/10" />
                    <span className={cn(TILE_LABEL, 'text-[#ADADAD] dark:text-foreground/40')}>
                      待添加
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={cn(TILE, 'w-full')}
                    title={site.name}
                    onClick={() => void onOpen(site.url)}
                  >
                    <span className={TILE_ICON}>
                      {site.logo ? (
                        <img
                          src={site.logo}
                          alt=""
                          loading="lazy"
                          className="h-9 w-9 object-contain"
                        />
                      ) : (
                        <Initial name={site.name} />
                      )}
                    </span>
                    <span className={TILE_LABEL}>{site.name}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Shortcuts onOpen={onOpen} />

      <section aria-labelledby="browser-home-recent" className="mt-9">
        <h2 id="browser-home-recent" className={SECTION_TITLE}>
          最近任务
        </h2>
        {recentTasks.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            还没有任务。在下方输入框告诉 HOLA DAY 你想做什么。
          </p>
        ) : (
          <ul className="divide-y divide-[#EFEFEF] overflow-hidden rounded-[14px] border border-[#E6E7EB] bg-white dark:divide-white/10 dark:border-white/10 dark:bg-card">
            {recentTasks.slice(0, RECENT_TASK_LIMIT).map((task) => (
              <li key={task.taskId}>
                <button
                  type="button"
                  onClick={() => onOpenTask(task.taskId)}
                  className="flex w-full min-w-0 items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] transition-colors hover:bg-[#FF0061]/5 focus-visible:bg-[#FF0061]/5 focus-visible:outline-none dark:hover:bg-white/5"
                >
                  <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {task.title?.trim() || task.intent}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Recent tasks for the home view: newest first. */
export function recentBrowserHomeTasks(tasks: readonly UiTask[]): UiTask[] {
  return tasks
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, RECENT_TASK_LIMIT);
}

function Initial({ name }: { name: string }): JSX.Element {
  return (
    <span aria-hidden className="text-[18px] font-semibold uppercase text-[#FF0061]">
      {Array.from(name.trim())[0] ?? '?'}
    </span>
  );
}

function Shortcuts({ onOpen }: { onOpen(input: string): Promise<boolean> }): JSX.Element {
  const [shortcuts, setShortcuts] = React.useState<BrowserHomeShortcut[]>(() =>
    readBrowserHomeShortcuts(),
  );
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const save = (next: BrowserHomeShortcut[]) => {
    setShortcuts(next);
    writeBrowserHomeShortcuts(next);
  };

  const add = () => {
    const url = normalizeShortcutUrl(address);
    if (!url) {
      setError('请输入 http(s) 网址，例如 example.com');
      return;
    }
    if (shortcuts.some((item) => item.url === url)) {
      setError('这个网址已经在快捷方式里了');
      return;
    }
    save([...shortcuts, { name: name.trim().slice(0, 40) || shortcutNameFor(url), url }]);
    setAdding(false);
    setName('');
    setAddress('');
    setError(null);
  };

  return (
    <section aria-labelledby="browser-home-shortcuts" className="mt-9">
      <h2 id="browser-home-shortcuts" className={SECTION_TITLE}>
        我的快捷方式
      </h2>
      <ul className={GRID}>
        {shortcuts.map((item) => (
          <li key={item.url} className="group relative min-w-0">
            <button
              type="button"
              className={cn(TILE, 'w-full')}
              title={item.url}
              onClick={() => void onOpen(item.url)}
            >
              <span className={TILE_ICON}>
                <Initial name={item.name} />
              </span>
              <span className={TILE_LABEL}>{item.name}</span>
            </button>
            <button
              type="button"
              aria-label={`移除${item.name}`}
              title={`移除${item.name}`}
              onClick={() => save(shortcuts.filter((other) => other.url !== item.url))}
              className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-muted-foreground shadow-[0_1px_3px_rgba(17,24,39,0.16)] transition-opacity hover:text-[#FF0061] focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 dark:bg-card"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </li>
        ))}
        {shortcuts.length < MAX_BROWSER_HOME_SHORTCUTS && !adding && (
          <li className="min-w-0">
            <button type="button" className={cn(TILE, 'w-full')} onClick={() => setAdding(true)}>
              <span className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-dashed border-[#DCDDDD] text-muted-foreground dark:border-white/20">
                <Plus className="h-5 w-5" aria-hidden />
              </span>
              <span className={TILE_LABEL}>添加</span>
            </button>
          </li>
        )}
      </ul>
      {adding && (
        <form
          aria-label="添加快捷方式"
          className="mt-3 flex flex-col gap-2 rounded-[14px] border border-[#E6E7EB] bg-white p-3 sm:flex-row sm:flex-wrap sm:items-center dark:border-white/10 dark:bg-card"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="名称（可不填）"
            aria-label="快捷方式名称"
            maxLength={40}
            className="h-9 min-w-0 rounded-[10px] border border-[#E6E7EB] bg-transparent px-3 text-[13px] outline-none focus:border-[#FF0061]/40 sm:w-40 dark:border-white/10"
          />
          <input
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setError(null);
            }}
            placeholder="网址，例如 example.com"
            aria-label="快捷方式网址"
            inputMode="url"
            className="h-9 min-w-0 flex-1 rounded-[10px] border border-[#E6E7EB] bg-transparent px-3 text-[13px] outline-none focus:border-[#FF0061]/40 dark:border-white/10"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="h-9 rounded-[10px] bg-[#FF0061] px-4 text-[13px] font-medium text-white hover:bg-[#FF0061]/90"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
              className="h-9 rounded-[10px] border border-[#E6E7EB] px-4 text-[13px] text-muted-foreground hover:text-foreground dark:border-white/10"
            >
              取消
            </button>
          </div>
          {error && (
            <p role="alert" className="text-[12px] text-[#E5484D] sm:basis-full">
              {error}
            </p>
          )}
        </form>
      )}
      {shortcuts.length === 0 && !adding && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          把常去的网站加到这里，只保存在这台设备上。
        </p>
      )}
    </section>
  );
}
