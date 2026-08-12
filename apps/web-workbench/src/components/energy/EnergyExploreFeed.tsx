import { Button } from '@/components/ui/button';
import type { ZodiacSign } from '@/lib/astrology';
import { RefreshCw, Sparkles } from 'lucide-react';
import * as React from 'react';
import { EnergyMagazineCard } from './EnergyMagazineCard';
import { readEnergyProgress, saveSeenEnergyContentIds } from './energy-progress';
import { allocateMagazineVisuals } from './energy-magazine-visuals';
import type { EnergyMood, EnergyNeed } from './energy-types';
import {
  ENERGY_EXPLORE_CONTENT,
  type EnergyContentItem,
  nextEnergyContentBatch,
} from './explore-content';

export type EnergyExploreEvent =
  | { type: 'energy_feed_refreshed' }
  | { type: 'energy_content_opened'; contentId: string };

interface EnergyExploreFeedProps {
  storageScope: string | null;
  mood: EnergyMood | null;
  energyNeed: EnergyNeed;
  zodiacSign: ZodiacSign;
  onEvent: (event: EnergyExploreEvent) => void;
  onActionTarget?: (target: string, trigger: HTMLButtonElement) => void;
}

export function EnergyExploreFeed({
  storageScope,
  mood,
  energyNeed,
  zodiacSign,
  onEvent,
  onActionTarget = () => undefined,
}: EnergyExploreFeedProps): JSX.Element {
  const initialSeenRef = React.useRef<string[] | null>(null);
  if (initialSeenRef.current === null) {
    const persisted = readEnergyProgress(storageScope).seenContentIds;
    initialSeenRef.current = persisted.length >= ENERGY_EXPLORE_CONTENT.length ? [] : persisted;
  }
  const sessionSeedRef = React.useRef(`${storageScope ?? 'preview'}:${Date.now()}`);
  const batchIndexRef = React.useRef(0);
  const [sessionSeenIds, setSessionSeenIds] = React.useState<string[]>([]);
  const [openedId, setOpenedId] = React.useState<string | null>(null);
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

  React.useEffect(() => {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) return;
    setSessionSeenIds((current) => [...new Set([...current, ...ids])]);
    saveSeenEnergyContentIds(storageScope, ids);
  }, [items, storageScope]);

  const showNextBatch = (): void => {
    batchIndexRef.current += 1;
    const next = nextEnergyContentBatch({
      items: ENERGY_EXPLORE_CONTENT,
      seenIds: [...(initialSeenRef.current ?? []), ...sessionSeenIds],
      seed: `${sessionSeedRef.current}:${batchIndexRef.current}`,
      size: 6,
      now: new Date(),
      mood,
      energyNeed,
    });
    setOpenedId(null);
    setItems(next);
    onEvent({ type: 'energy_feed_refreshed' });
  };

  return (
    <section className="energy-explore-feed" aria-labelledby="energy-explore-title">
      <header className="energy-explore-feed__header">
        <div>
          <p className="energy-kicker">任务等待时也可以轻松逛</p>
          <h2 id="energy-explore-title">再逛一会</h2>
          <p>每次六个轻内容，换一组不会重复本次会话已经看过的内容。</p>
        </div>
        {items.length > 0 ? (
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
              onOpen={(item, trigger) => {
                setOpenedId(item.id);
                onEvent({ type: 'energy_content_opened', contentId: item.id });
                onActionTarget(item.actionTarget, trigger);
              }}
            />
          ))}
        </div>
      ) : (
        <output className="energy-explore-feed__empty">
          <Sparkles aria-hidden="true" />
          <h3>今天先逛到这里</h3>
          <p>本次会话的 36 条内容已经看完，可以去抽卡、做测试或玩一轮小游戏。</p>
        </output>
      )}
    </section>
  );
}
