import { ArrowRight } from 'lucide-react';
import { ASTROLOGY_PORTAL_ART } from './energy-magazine-visuals';

interface AstrologyPortalRowProps {
  rankingLoading: boolean;
  onOpenRanking: () => void;
  onToggleSignPicker: () => void;
  onOpenEnergyCard: (trigger: HTMLButtonElement) => void;
  onOpenLightTest: (trigger: HTMLButtonElement) => void;
}

const PORTALS = [
  {
    key: 'ranking',
    label: '查看十二星座排行',
    hint: '看看谁更有行动力',
    tone: 'lavender',
    imageSrc: ASTROLOGY_PORTAL_ART.ranking,
  },
  {
    key: 'sign',
    label: '换个星座看看',
    hint: '切换视角，不改资料',
    tone: 'sky',
    imageSrc: ASTROLOGY_PORTAL_ART.sign,
  },
  {
    key: 'tarot',
    label: '抽一张相关能量牌',
    hint: '给当下一个轻提示',
    tone: 'peach',
    imageSrc: ASTROLOGY_PORTAL_ART.tarot,
  },
  {
    key: 'test',
    label: '测个相关主题',
    hint: '一分钟看见状态',
    tone: 'mint',
    imageSrc: ASTROLOGY_PORTAL_ART.test,
  },
] as const;

export function AstrologyPortalRow({
  rankingLoading,
  onOpenRanking,
  onToggleSignPicker,
  onOpenEnergyCard,
  onOpenLightTest,
}: AstrologyPortalRowProps): JSX.Element {
  return (
    <div className="energy-astrology-portals">
      {PORTALS.map((portal) => (
        <button
          key={portal.key}
          type="button"
          aria-label={portal.label}
          title={portal.label}
          data-tone={portal.tone}
          disabled={portal.key === 'ranking' && rankingLoading}
          onClick={(event) => {
            if (portal.key === 'ranking') onOpenRanking();
            if (portal.key === 'sign') onToggleSignPicker();
            if (portal.key === 'tarot') onOpenEnergyCard(event.currentTarget);
            if (portal.key === 'test') onOpenLightTest(event.currentTarget);
          }}
        >
          <span className="energy-astrology-portals__art" aria-hidden="true">
            <img data-portal-art src={portal.imageSrc} alt="" loading="lazy" />
          </span>
          <span>
            <strong>{portal.label}</strong>
            <small>{portal.hint}</small>
          </span>
          <ArrowRight aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
