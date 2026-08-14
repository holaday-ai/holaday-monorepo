import { ArrowUpRight, Clock3, Heart, Sparkles } from 'lucide-react';
import * as React from 'react';
import type { EnergyShelfItem, EnergyShelfModel } from './energy-shelf';

interface EnergyShelfProps {
  model: EnergyShelfModel;
  onOpen: (item: EnergyShelfItem, trigger: HTMLButtonElement) => void;
  onRemoveFavorite: (item: EnergyShelfItem) => void;
}

export function EnergyShelf({ model, onOpen, onRemoveFavorite }: EnergyShelfProps): JSX.Element {
  const [activeTab, setActiveTab] = React.useState<'recent' | 'favorites'>('recent');
  const recentTabRef = React.useRef<HTMLButtonElement>(null);
  const favoritesTabRef = React.useRef<HTMLButtonElement>(null);
  const id = React.useId();
  const activateTab = (tab: 'recent' | 'favorites'): void => {
    setActiveTab(tab);
    (tab === 'recent' ? recentTabRef : favoritesTabRef).current?.focus();
  };
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowRight' || event.key === 'End') {
      event.preventDefault();
      activateTab('favorites');
    } else if (event.key === 'ArrowLeft' || event.key === 'Home') {
      event.preventDefault();
      activateTab('recent');
    }
  };

  return (
    <section className="energy-shelf" aria-labelledby={`${id}-title`}>
      <header className="energy-shelf__header">
        <div>
          <p className="energy-kicker">
            <Sparkles aria-hidden="true" />
            只留在这台设备
          </p>
          <h2 id={`${id}-title`}>我的能量架</h2>
          <p>最近完成的补给和收藏，都可以从这里轻松找回来。</p>
        </div>
        <div className="energy-shelf__tabs" role="tablist" aria-label="能量架内容">
          <button
            ref={recentTabRef}
            id={`${id}-tab-recent`}
            type="button"
            role="tab"
            aria-selected={activeTab === 'recent'}
            aria-controls={`${id}-panel-recent`}
            tabIndex={activeTab === 'recent' ? 0 : -1}
            onClick={() => setActiveTab('recent')}
            onKeyDown={handleTabKeyDown}
          >
            最近玩过
            <span aria-hidden="true">{model.recent.length}</span>
          </button>
          <button
            ref={favoritesTabRef}
            id={`${id}-tab-favorites`}
            type="button"
            role="tab"
            aria-selected={activeTab === 'favorites'}
            aria-controls={`${id}-panel-favorites`}
            tabIndex={activeTab === 'favorites' ? 0 : -1}
            onClick={() => setActiveTab('favorites')}
            onKeyDown={handleTabKeyDown}
          >
            我的收藏
            <span aria-hidden="true">{model.favorites.length}</span>
          </button>
        </div>
      </header>

      <div
        id={`${id}-panel-recent`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-recent`}
        hidden={activeTab !== 'recent'}
      >
        {model.recent.length > 0 ? (
          <div className="energy-shelf__grid">
            {model.recent.map((item) => (
              <EnergyShelfCard
                key={item.id}
                item={item}
                onOpen={onOpen}
                onRemoveFavorite={onRemoveFavorite}
              />
            ))}
          </div>
        ) : (
          <EnergyShelfEmpty
            title="这里还在等你的第一束能量"
            body="完成一次抽卡、轻测试、补给或小游戏，最近记录就会出现在这里。"
            href="#energy-play"
            action="去玩一个轻体验"
          />
        )}
      </div>

      <div
        id={`${id}-panel-favorites`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-favorites`}
        hidden={activeTab !== 'favorites'}
      >
        {model.favorites.length > 0 ? (
          <div className="energy-shelf__grid">
            {model.favorites.map((item) => (
              <EnergyShelfCard
                key={item.id}
                item={item}
                onOpen={onOpen}
                onRemoveFavorite={onRemoveFavorite}
              />
            ))}
          </div>
        ) : (
          <EnergyShelfEmpty
            title="把喜欢的内容放到这里"
            body="收藏一张能量牌、一条测试行动或一篇能量专刊，下次不用重新寻找。"
            href="#energy-today-content"
            action="去逛能量专刊"
          />
        )}
      </div>
    </section>
  );
}

function EnergyShelfCard({
  item,
  onOpen,
  onRemoveFavorite,
}: {
  item: EnergyShelfItem;
  onOpen: EnergyShelfProps['onOpen'];
  onRemoveFavorite: EnergyShelfProps['onRemoveFavorite'];
}): JSX.Element {
  const removeLabel = `取消收藏${item.title}`;
  return (
    <article className="energy-shelf__card" data-source={item.source}>
      <div className="energy-shelf__image" aria-hidden="true">
        <img
          src={item.imageSrc}
          alt=""
          loading="lazy"
          style={{ objectPosition: item.imageObjectPosition }}
        />
      </div>
      {item.favoriteRef ? (
        <button
          type="button"
          className="energy-shelf__remove"
          aria-label={removeLabel}
          title={removeLabel}
          onClick={() => onRemoveFavorite(item)}
        >
          <Heart aria-hidden="true" fill="currentColor" />
        </button>
      ) : null}
      <div className="energy-shelf__content">
        <div className="energy-shelf__meta">
          <span>{item.eyebrow}</span>
          <small>
            <Clock3 aria-hidden="true" />
            {durationLabel(item.estimatedSeconds)}
          </small>
        </div>
        <h3>{item.title}</h3>
        <p>{item.summary}</p>
        {item.completedLabel ? <time>{item.completedLabel}</time> : null}
        <button
          type="button"
          className="energy-shelf__open"
          aria-label={`再体验${item.title}`}
          onClick={(event) => onOpen(item, event.currentTarget)}
        >
          再体验
          <ArrowUpRight aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function EnergyShelfEmpty({
  title,
  body,
  href,
  action,
}: {
  title: string;
  body: string;
  href: string;
  action: string;
}): JSX.Element {
  return (
    <div className="energy-shelf__empty">
      <span aria-hidden="true">
        <Sparkles />
      </span>
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      <a href={href}>
        {action}
        <ArrowUpRight aria-hidden="true" />
      </a>
    </div>
  );
}

function durationLabel(seconds: number): string {
  return seconds < 60 ? `约 ${seconds} 秒` : `约 ${Math.ceil(seconds / 60)} 分钟`;
}
