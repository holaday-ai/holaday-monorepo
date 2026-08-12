import {
  BookOpenText,
  Brain,
  BriefcaseBusiness,
  Clock3,
  Gamepad2,
  HeartHandshake,
  Palette,
  Shuffle,
  Sparkles,
  UserRound,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import * as React from 'react';
import { periodSections } from './astrology-content';
import { type EnergyVisualIcon, dimensionVisualFor } from './energy-visuals';
import type { EnergyPeriodReading } from './useEnergyAstrology';

interface AstrologyDimensionGridProps {
  reading: EnergyPeriodReading;
}

const ICON_COMPONENTS: Record<EnergyVisualIcon, LucideIcon> = {
  book: BookOpenText,
  brain: Brain,
  briefcase: BriefcaseBusiness,
  clock: Clock3,
  gamepad: Gamepad2,
  heart: HeartHandshake,
  palette: Palette,
  shuffle: Shuffle,
  sparkles: Sparkles,
  user: UserRound,
  wind: Wind,
};

export function AstrologyDimensionGrid({ reading }: AstrologyDimensionGridProps): JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  const sections = periodSections(reading);
  const visibleSections = expanded ? sections : sections.slice(0, 3);

  return (
    <section className="energy-astrology-dimensions" aria-label="六维星座提示">
      <div className="energy-astrology-dimensions__grid">
        {visibleSections.map((dimension) => {
          const visual = dimensionVisualFor(dimension.key);
          const Icon = ICON_COMPONENTS[visual.icon];
          return (
            <article key={dimension.key} data-dimension={dimension.key} data-tone={visual.tone}>
              <header>
                <span
                  className="energy-astrology-dimension__icon"
                  data-icon={visual.icon}
                  aria-hidden="true"
                >
                  <Icon />
                </span>
                <h4>{dimension.label}</h4>
                {dimension.score === null ? null : <span>{dimension.score}%</span>}
              </header>
              <p>{dimension.body}</p>
            </article>
          );
        })}
      </div>
      {sections.length > 3 ? (
        <button type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? '收起六项提示' : '展开全部六项'}
        </button>
      ) : null}
    </section>
  );
}
