import {
  ArrowRight,
  BookOpenText,
  Brain,
  Gamepad2,
  Heart,
  HeartHandshake,
  type LucideIcon,
  Sparkles,
  Vote,
  Wind,
} from 'lucide-react';
import * as React from 'react';
import type { AllocatedMagazineItem } from './energy-magazine-visuals';
import type { EnergyContentCategory, EnergyContentItem } from './explore-content';

interface EnergyMagazineCardProps {
  entry: AllocatedMagazineItem;
  opened: boolean;
  favorite: boolean;
  onOpen: (item: EnergyContentItem, trigger: HTMLButtonElement) => void;
  onToggleFavorite: (contentId: string) => void;
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

export function EnergyMagazineCard({
  entry,
  opened,
  favorite,
  onOpen,
  onToggleFavorite,
}: EnergyMagazineCardProps): JSX.Element {
  const [artFailed, setArtFailed] = React.useState(false);
  const MetaIcon = CATEGORY_ICONS[entry.item.category];

  return (
    <article
      className="energy-magazine-card"
      data-category={entry.item.category}
      data-layout={entry.slot}
      data-opened={opened ? 'true' : 'false'}
      data-favorite={favorite ? 'true' : 'false'}
    >
      <div className="energy-magazine-card__art">
        <span data-artwork-fallback aria-hidden="true">
          <MetaIcon />
        </span>
        <img
          data-artwork
          src={entry.visual.imageSrc}
          alt=""
          loading={entry.slot === 'hero' ? 'eager' : 'lazy'}
          style={{ objectPosition: entry.visual.objectPosition }}
          hidden={artFailed}
          onError={() => setArtFailed(true)}
        />
        {entry.zodiacBadgeSrc ? (
          <img data-zodiac-badge src={entry.zodiacBadgeSrc} alt="" loading="lazy" />
        ) : null}
        <button
          type="button"
          className="energy-magazine-card__favorite"
          aria-label={`${favorite ? '取消收藏' : '收藏'}${entry.item.title}`}
          title={`${favorite ? '取消收藏' : '收藏'}${entry.item.title}`}
          aria-pressed={favorite}
          onClick={() => onToggleFavorite(entry.item.id)}
        >
          <Heart aria-hidden="true" fill={favorite ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="energy-explore-feed__meta">
        <span>
          <MetaIcon aria-hidden="true" />
          {CATEGORY_LABELS[entry.item.category]}
        </span>
        <small>约 {entry.item.estimatedSeconds} 秒</small>
      </div>
      <h3>{entry.item.title}</h3>
      <p>{entry.item.summary}</p>
      <button
        type="button"
        aria-label={`打开${entry.item.title}`}
        title={`打开${entry.item.title}`}
        onClick={(event) => onOpen(entry.item, event.currentTarget)}
      >
        {opened ? '已打开，可以继续逛' : '打开这个内容'}
        <ArrowRight aria-hidden="true" />
      </button>
    </article>
  );
}
