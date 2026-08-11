import { Button } from '@/components/ui/button';
import {
  BookOpenText,
  Brain,
  Gamepad2,
  HeartHandshake,
  type LucideIcon,
  RefreshCw,
  Sparkles,
  Vote,
  Wind,
} from 'lucide-react';
import * as React from 'react';
import { readEnergyProgress, saveSeenEnergyContentIds } from './energy-progress';
import type { EnergyMood, EnergyNeed } from './energy-types';
import {
  ENERGY_EXPLORE_CONTENT,
  type EnergyContentCategory,
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
  onEvent: (event: EnergyExploreEvent) => void;
  onActionTarget?: (target: string, trigger: HTMLButtonElement) => void;
}

const CATEGORY_LABELS = {
  relaxation: '一分钟放松',
  fortune: '今日幸运签',
  'zodiac-knowledge': '星座趣味知识',
  'relationship-quiz': '关系小问答',
  poll: '今日投票',
  'test-recommendation': '推荐轻测试',
  'card-recommendation': '推荐抽卡',
  'game-recommendation': '推荐小游戏',
} satisfies Record<EnergyContentCategory, string>;

const CATEGORY_ICONS = {
  relaxation: Wind,
  fortune: Sparkles,
  'zodiac-knowledge': BookOpenText,
  'relationship-quiz': HeartHandshake,
  poll: Vote,
  'test-recommendation': Brain,
  'card-recommendation': Sparkles,
  'game-recommendation': Gamepad2,
} satisfies Record<EnergyContentCategory, LucideIcon>;

export function EnergyExploreFeed({
  storageScope,
  mood,
  energyNeed,
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
          {items.map((item) => {
            const Icon = CATEGORY_ICONS[item.category];
            return (
              <article key={item.id} data-category={item.category}>
                <div className="energy-explore-feed__meta">
                  <span>
                    <Icon aria-hidden={true} />
                    {CATEGORY_LABELS[item.category]}
                  </span>
                  <small>约 {item.estimatedSeconds} 秒</small>
                </div>
                <h3>{item.title}</h3>
                <p>{item.summary}</p>
                <button
                  type="button"
                  aria-label={`打开${item.title}`}
                  title={`打开${item.title}`}
                  onClick={(event) => {
                    setOpenedId(item.id);
                    onEvent({ type: 'energy_content_opened', contentId: item.id });
                    onActionTarget(item.actionTarget, event.currentTarget);
                  }}
                >
                  {openedId === item.id ? '已打开，可以继续逛' : '打开这个内容'}
                </button>
              </article>
            );
          })}
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
