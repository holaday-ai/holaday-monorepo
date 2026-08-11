import { ArrowUpRight, FlaskConical, Gamepad2, type LucideIcon, MoonStar } from 'lucide-react';
import type { EnergyExperienceId } from './energy-types';
import type { EnergyExperienceRegistration } from './experience-registry';

interface EnergyExperienceDeckProps {
  experiences: EnergyExperienceRegistration[];
  onOpen: (experience: EnergyExperienceRegistration, trigger: HTMLButtonElement) => void;
}

const CARD_META: Partial<
  Record<EnergyExperienceId, { action: string; eyebrow: string; image: string; icon: LucideIcon }>
> = {
  tarot: {
    action: '抽一张能量卡',
    eyebrow: '今日卡 · 是 / 否卡',
    image: '/energy/tarot-cards.jpg',
    icon: MoonStar,
  },
  games: {
    action: '玩接住能量',
    eyebrow: '12 轮 · 键盘可玩',
    image: '/energy/mini-game.jpg',
    icon: Gamepad2,
  },
  'light-test': {
    action: '做一个轻测试',
    eyebrow: '心理 · 关系 · 今日数字',
    image: '/energy/quick-test.jpg',
    icon: FlaskConical,
  },
};

const CARD_ORDER: EnergyExperienceId[] = ['tarot', 'games', 'light-test'];

export function EnergyExperienceDeck({
  experiences,
  onOpen,
}: EnergyExperienceDeckProps): JSX.Element {
  const playable = CARD_ORDER.map((id) => experiences.find((experience) => experience.id === id))
    .filter((experience): experience is EnergyExperienceRegistration => Boolean(experience))
    .filter(
      (experience) =>
        experience.status === 'active' && experience.actionable && Boolean(experience.load),
    );

  return (
    <section className="energy-experience-deck" aria-label="选一个轻松玩法">
      <div className="energy-section-title">
        <div>
          <p className="energy-kicker">换一种补给方式</p>
          <h2>今天想玩点什么？</h2>
        </div>
        <span>都很短，随时可以退出</span>
      </div>
      <div className="energy-experience-cards">
        {playable.map((experience) => {
          const meta = CARD_META[experience.id];
          if (!meta) return null;
          const Icon = meta.icon;
          return (
            <button
              key={experience.id}
              type="button"
              className="energy-experience-card"
              data-kind={experience.id}
              aria-label={meta.action}
              title={meta.action}
              onClick={(event) => onOpen(experience, event.currentTarget)}
            >
              <span className="energy-experience-card__image" aria-hidden="true">
                <img src={meta.image} alt="" />
              </span>
              <span className="energy-experience-card__content">
                <span className="energy-experience-card__icon" aria-hidden="true">
                  <Icon />
                </span>
                <small>{meta.eyebrow}</small>
                <strong>{experience.title}</strong>
                <span>{experience.description}</span>
                <span className="energy-experience-card__action">
                  {meta.action}
                  <ArrowUpRight aria-hidden="true" />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
