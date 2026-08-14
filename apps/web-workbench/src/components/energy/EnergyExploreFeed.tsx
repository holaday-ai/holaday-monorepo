import { Button } from '@/components/ui/button';
import type { ZodiacSign } from '@/lib/astrology';
import { CheckCircle2, Heart, RefreshCw, Sparkles, WandSparkles } from 'lucide-react';
import * as React from 'react';
import { EnergyMagazineCard } from './EnergyMagazineCard';
import type { EnergyContentTarget } from './energy-content-target';
import { allocateMagazineVisuals } from './energy-magazine-visuals';
import {
  type EnergyProgress,
  readEnergyProgress,
  recordOpenedEnergyContent,
  toggleFavoriteEnergyContent,
} from './energy-progress';
import type { EnergyMood, EnergyNeed } from './energy-types';
import {
  ENERGY_EXPLORE_CONTENT,
  type EnergyContentItem,
  type EnergyExploreContentId,
  isEnergyExploreContentId,
  nextEnergyContentBatch,
} from './explore-content';

export type EnergyExploreEvent =
  | { type: 'energy_feed_refreshed' }
  | { type: 'energy_feed_exhausted'; energyNeed: EnergyNeed; batchCount: number }
  | {
      type: 'energy_content_opened';
      contentId: EnergyExploreContentId;
      targetType: EnergyContentTarget['type'];
    };

interface EnergyExploreFeedProps {
  storageScope: string | null;
  mood: EnergyMood | null;
  energyNeed: EnergyNeed;
  zodiacSign: ZodiacSign;
  onEvent: (event: EnergyExploreEvent) => void;
  onActionTarget?: (target: EnergyContentTarget, trigger: HTMLButtonElement) => boolean;
  onCompleteToday?: () => void;
  favoriteContentIds?: readonly string[];
  onProgressChange?: (progress: EnergyProgress) => void;
}

type EnergyFeedMode = 'fresh' | 'revisit' | 'favorites';

const NEED_OPTIONS: ReadonlyArray<{ value: EnergyNeed; label: string }> = [
  { value: 'focus', label: '专注' },
  { value: 'relax', label: '放松' },
  { value: 'confidence', label: '自信' },
  { value: 'uplift', label: '好心情' },
];

export function EnergyExploreFeed({
  storageScope,
  mood,
  energyNeed,
  zodiacSign,
  onEvent,
  onActionTarget = () => false,
  onCompleteToday = () => undefined,
  favoriteContentIds,
  onProgressChange = () => undefined,
}: EnergyExploreFeedProps): JSX.Element {
  const initialProgressRef = React.useRef<ReturnType<typeof readEnergyProgress> | null>(null);
  if (initialProgressRef.current === null) {
    initialProgressRef.current = readEnergyProgress(storageScope);
  }
  const initialProgress = initialProgressRef.current;
  const initialSeenRef = React.useRef<string[] | null>(null);
  if (initialSeenRef.current === null) {
    const persisted = initialProgress.seenContentIds;
    initialSeenRef.current = persisted.length >= ENERGY_EXPLORE_CONTENT.length ? [] : persisted;
  }
  const sessionSeedRef = React.useRef(`${storageScope ?? 'preview'}:${Date.now()}`);
  const batchIndexRef = React.useRef(0);
  const exhaustionReportedRef = React.useRef(false);
  const [sessionSeenIds, setSessionSeenIds] = React.useState<string[]>([]);
  const [openedId, setOpenedId] = React.useState<string | null>(null);
  const [unavailableId, setUnavailableId] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<EnergyFeedMode>('fresh');
  const [revisitNeed, setRevisitNeed] = React.useState<EnergyNeed>(energyNeed);
  const [choosingTheme, setChoosingTheme] = React.useState(false);
  const [localFavoriteIds, setLocalFavoriteIds] = React.useState<string[]>(
    initialProgress.continuation.favoriteContentIds,
  );
  const favoriteIds = favoriteContentIds ?? localFavoriteIds;
  const [items, setItems] = React.useState<EnergyContentItem[]>(() =>
    nextEnergyContentBatch({
      items: ENERGY_EXPLORE_CONTENT,
      seenIds: initialSeenRef.current ?? [],
      seed: `${sessionSeedRef.current}:0`,
      size: 6,
      now: new Date(),
      mood,
      energyNeed,
    }),
  );
  const entries = React.useMemo(
    () => allocateMagazineVisuals(items, zodiacSign),
    [items, zodiacSign],
  );

  const title =
    mode === 'favorites' ? '我的能量收藏' : mode === 'revisit' ? '今日精选重逛' : '再逛一会';

  React.useEffect(() => {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) return;
    setSessionSeenIds((current) => [...new Set([...current, ...ids])]);
  }, [items]);

  const showNextBatch = (): void => {
    batchIndexRef.current += 1;
    const activeNeed = mode === 'revisit' ? revisitNeed : energyNeed;
    const next = nextEnergyContentBatch({
      items: ENERGY_EXPLORE_CONTENT,
      seenIds:
        mode === 'fresh'
          ? [...(initialSeenRef.current ?? []), ...sessionSeenIds]
          : items.map((item) => item.id),
      seed: `${sessionSeedRef.current}:${batchIndexRef.current}`,
      size: 6,
      now: new Date(),
      mood,
      energyNeed: activeNeed,
    });
    setOpenedId(null);
    setUnavailableId(null);
    setItems(next);
    onEvent({ type: 'energy_feed_refreshed' });
    if (mode === 'fresh' && next.length === 0 && !exhaustionReportedRef.current) {
      exhaustionReportedRef.current = true;
      onEvent({
        type: 'energy_feed_exhausted',
        energyNeed,
        batchCount: batchIndexRef.current,
      });
    }
  };

  const beginRevisit = (need: EnergyNeed): void => {
    setMode('revisit');
    setRevisitNeed(need);
    setChoosingTheme(false);
    setOpenedId(null);
    setUnavailableId(null);
    batchIndexRef.current += 1;
    setItems(
      nextEnergyContentBatch({
        items: ENERGY_EXPLORE_CONTENT,
        seenIds: [],
        seed: `${sessionSeedRef.current}:revisit:${need}:${batchIndexRef.current}`,
        size: 6,
        now: new Date(),
        mood,
        energyNeed: need,
      }),
    );
  };

  const showFavorites = (): void => {
    setMode('favorites');
    setChoosingTheme(false);
    setOpenedId(null);
    setUnavailableId(null);
    setItems(ENERGY_EXPLORE_CONTENT.filter((item) => favoriteIds.includes(item.id)).slice(0, 6));
  };

  return (
    <section className="energy-explore-feed" aria-labelledby="energy-explore-title">
      <header className="energy-explore-feed__header">
        <div>
          <p className="energy-kicker">任务等待时也可以轻松逛</p>
          <h2 id="energy-explore-title">{title}</h2>
          <p>
            {mode === 'fresh'
              ? '每次六个轻内容，换一组不会重复本次会话已经看过的内容。'
              : mode === 'revisit'
                ? '按新的能量主题重新编排今日内容，可以安心重逛喜欢的入口。'
                : '收藏留在这台设备里，随时回来继续刚才喜欢的内容。'}
          </p>
        </div>
        {items.length > 0 && mode !== 'favorites' ? (
          <Button type="button" variant="outline" onClick={showNextBatch}>
            <RefreshCw aria-hidden="true" />
            再来一组
          </Button>
        ) : null}
      </header>

      {items.length > 0 ? (
        <div className="energy-explore-feed__grid" aria-live="polite">
          {entries.map((entry) => (
            <EnergyMagazineCard
              key={entry.item.id}
              entry={entry}
              opened={openedId === entry.item.id}
              favorite={favoriteIds.includes(entry.item.id)}
              onOpen={(item, trigger) => {
                if (!isEnergyExploreContentId(item.id)) {
                  setUnavailableId(item.id);
                  return;
                }
                const opened = onActionTarget(item.target, trigger);
                if (!opened) {
                  setUnavailableId(item.id);
                  return;
                }
                setUnavailableId(null);
                setOpenedId(item.id);
                recordOpenedEnergyContent(storageScope, item.id);
                onEvent({
                  type: 'energy_content_opened',
                  contentId: item.id,
                  targetType: item.target.type,
                });
              }}
              onToggleFavorite={(contentId) => {
                const next = toggleFavoriteEnergyContent(storageScope, contentId);
                if (!favoriteContentIds) {
                  setLocalFavoriteIds(next.continuation.favoriteContentIds);
                }
                onProgressChange(next);
                if (mode === 'favorites') {
                  setItems((current) => current.filter((item) => item.id !== contentId));
                }
              }}
            />
          ))}
        </div>
      ) : (
        <output className="energy-explore-feed__empty">
          <Sparkles aria-hidden="true" />
          <h3>{mode === 'favorites' ? '还没有可用的收藏' : '今天的 36 条已经逛完'}</h3>
          {mode === 'favorites' ? (
            <>
              <p>回到今日精选，遇到喜欢的内容时点一下心形，就会留在这里。</p>
              <Button type="button" variant="outline" onClick={() => beginRevisit(energyNeed)}>
                <WandSparkles aria-hidden="true" />
                返回今日精选
              </Button>
            </>
          ) : (
            <>
              <p>你可以换一个能量方向重新编排，也可以回到收藏，或带着今天的补给收尾。</p>
              <div className="energy-explore-feed__recovery-actions">
                <Button type="button" variant="outline" onClick={() => setChoosingTheme(true)}>
                  <WandSparkles aria-hidden="true" />
                  换个能量主题
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={favoriteIds.length === 0}
                  title={favoriteIds.length === 0 ? '先收藏一条内容' : '查看已收藏内容'}
                  onClick={showFavorites}
                >
                  <Heart aria-hidden="true" />
                  继续收藏
                </Button>
                <Button type="button" onClick={onCompleteToday}>
                  <CheckCircle2 aria-hidden="true" />
                  完成今日能量
                </Button>
              </div>
              {favoriteIds.length === 0 ? (
                <small>收藏一条内容后，“继续收藏”会在这里点亮。</small>
              ) : null}
              {choosingTheme ? (
                <fieldset className="energy-explore-feed__theme-picker" aria-label="选择重逛主题">
                  <legend>这次想补哪一种？</legend>
                  {NEED_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      variant="outline"
                      onClick={() => beginRevisit(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </fieldset>
              ) : null}
            </>
          )}
        </output>
      )}
      {unavailableId ? (
        <output className="energy-explore-feed__notice">
          这个体验暂时不可用，已为你保留当前位置。
        </output>
      ) : null}
    </section>
  );
}
