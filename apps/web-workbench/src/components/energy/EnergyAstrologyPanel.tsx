import type { AstroProfile } from '@/lib/astrology';
import { ArrowRight, RefreshCw, Settings2 } from 'lucide-react';
import type { EnergyAstrologyState } from './useEnergyAstrology';
import { zodiacBadgeImage } from './zodiac-art';

interface EnergyAstrologyPanelProps {
  profile: AstroProfile;
  astrology: EnergyAstrologyState;
  canEditProfile: boolean;
  onOpen: (trigger: HTMLButtonElement) => void;
  onEditProfile: (trigger: HTMLButtonElement) => void;
}

export function EnergyAstrologyPanel({
  profile,
  astrology,
  canEditProfile,
  onOpen,
  onEditProfile,
}: EnergyAstrologyPanelProps): JSX.Element {
  const badgeImage = zodiacBadgeImage(profile.zodiacSign);
  return (
    <section className="energy-astrology-panel" aria-label="你的星座能量">
      <div className="energy-astrology-panel__badge" aria-hidden="true">
        <img src={badgeImage} alt="" />
      </div>
      <div className="energy-astrology-panel__main">
        <p className="energy-kicker">今日 + 本周星座提示</p>
        <h2>你的星座能量</h2>
        <div className="energy-astrology-panel__identity">
          <strong>{astrology.reading.zodiacLabel}</strong>
          <span>{astrology.reading.energyScore}% 今日能量</span>
          {astrology.source === 'local-fallback' ? <small>本地备用提示</small> : null}
        </div>
        <h3>{astrology.reading.headline}</h3>
        <p>{astrology.reading.workNote}</p>
        <div className="energy-astrology-panel__week">
          <span>
            <strong>本周工作</strong>
            {astrology.weekly.profession}
          </span>
          <span>
            <strong>本周好运</strong>
            {astrology.weekly.luck}
          </span>
        </div>
        <div className="energy-astrology-panel__actions">
          <button type="button" onClick={(event) => onOpen(event.currentTarget)}>
            进入星座深度补给
            <ArrowRight aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={!canEditProfile}
            onClick={(event) => onEditProfile(event.currentTarget)}
          >
            <Settings2 aria-hidden="true" />
            更新星座资料
          </button>
          <button
            type="button"
            className="energy-astrology-panel__refresh"
            disabled={astrology.loading}
            aria-label="刷新星座能量"
            title="刷新星座能量"
            onClick={() => void astrology.refresh()}
          >
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
